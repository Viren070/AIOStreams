import { EventEmitter } from 'events';
import { bootstrap } from '../config/bootstrap.js';

/**
 * One retained log record. `line` is the raw NDJSON string pino already
 * produced (already redacted — see `redact.ts`). `ts`/`level`/`module` are
 * pulled out once, in the ring writer, so the dashboard can filter without
 * re-parsing every line. `seq` is a monotonic cursor used for SSE resume.
 */
export interface LogRecord {
  seq: number;
  ts: number;
  level: string;
  module?: string;
  line: string;
}

export interface LogQuery {
  q?: string;
  regex?: boolean;
  levels?: string[];
  modules?: string[];
  since?: number;
  until?: number;
  limit?: number;
  order?: 'asc' | 'desc';
}

const LEVEL_NAMES = new Set([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]);

/**
 * Process-singleton in-memory ring of recent log lines. Backs the dashboard
 * Logs page. Byte-bounded so memory stays predictable regardless of how
 * chatty logging is; a hard entry cap is a secondary safety net.
 *
 * The hot path is `push()` — a single `JSON.parse` (to extract ts/level/
 * module) plus an array append and amortised batched eviction. This runs on
 * the pino stream, never on the request path.
 */
class LogRingBuffer {
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  private buf: LogRecord[] = [];
  private head = 0; // index of the oldest live record in `buf`
  private bytes = 0;
  private seq = 0;
  /** Emits `'line'` with a {@link LogRecord} for SSE subscribers. */
  readonly bus = new EventEmitter();

  constructor(maxBytes: number, maxEntries: number) {
    this.maxBytes = Math.max(1, maxBytes);
    this.maxEntries = Math.max(1, maxEntries);
    this.bus.setMaxListeners(0);
  }

  push(line: string): void {
    let ts = Date.now();
    let level = 'info';
    let module: string | undefined;
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      if (typeof o.level === 'string' && LEVEL_NAMES.has(o.level)) {
        level = o.level;
      }
      if (typeof o.module === 'string') module = o.module;
      if (typeof o.time === 'string') {
        const parsed = Date.parse(o.time);
        if (!Number.isNaN(parsed)) ts = parsed;
      } else if (typeof o.time === 'number') {
        ts = o.time;
      }
    } catch {
      // Non-JSON line (shouldn't happen — pino emits NDJSON). Keep it anyway.
    }

    const rec: LogRecord = {
      seq: ++this.seq,
      ts,
      level,
      module,
      line,
    };
    this.buf.push(rec);
    this.bytes += Buffer.byteLength(line, 'utf8');

    this.evict();
    this.bus.emit('line', rec);
  }

  private evict(): void {
    while (
      this.buf.length - this.head > this.maxEntries ||
      (this.bytes > this.maxBytes && this.buf.length - this.head > 1)
    ) {
      const dropped = this.buf[this.head];
      this.bytes -= Buffer.byteLength(dropped.line, 'utf8');
      this.head++;
    }
    // Compact the dead prefix in batches so eviction stays amortised O(1).
    if (this.head > 4096 && this.head * 2 > this.buf.length) {
      this.buf = this.buf.slice(this.head);
      this.head = 0;
    }
  }

  /**
   * Build a text-match predicate from `query.q` / `query.regex`. Called once
   * per query so regex compilation and string lowercasing happen only once
   * regardless of how many records are scanned.
   */
  private buildTextMatcher(
    query: LogQuery
  ): ((line: string) => boolean) | null {
    if (!query.q) return null;
    if (query.regex) {
      try {
        const re = new RegExp(query.q, 'i');
        return (line) => re.test(line);
      } catch {
        return () => false;
      }
    }
    const lower = query.q.toLowerCase();
    return (line) => line.toLowerCase().includes(lower);
  }

  private matches(
    rec: LogRecord,
    query: LogQuery,
    textMatcher: ((line: string) => boolean) | null
  ): boolean {
    if (
      query.levels &&
      query.levels.length &&
      !query.levels.includes(rec.level)
    )
      return false;
    if (
      query.modules &&
      query.modules.length &&
      (!rec.module || !query.modules.includes(rec.module))
    )
      return false;
    if (query.since !== undefined && rec.seq <= query.since) return false;
    if (query.until !== undefined && rec.ts > query.until) return false;
    if (textMatcher && !textMatcher(rec.line)) return false;
    return true;
  }

  /** Used by the SSE endpoint to apply the same filters as the page. */
  test(rec: LogRecord, query: LogQuery): boolean {
    return this.matches(rec, query, this.buildTextMatcher(query));
  }

  query(query: LogQuery): { records: LogRecord[]; nextSeq: number } {
    const limit = Math.min(Math.max(query.limit ?? 1000, 1), 5000);
    const order = query.order ?? 'desc';
    const out: LogRecord[] = [];
    const textMatcher = this.buildTextMatcher(query);

    // Walk newest → oldest so `limit` keeps the most recent matches.
    for (let i = this.buf.length - 1; i >= this.head; i--) {
      const rec = this.buf[i];
      if (this.matches(rec, query, textMatcher)) {
        out.push(rec);
        if (out.length >= limit) break;
      }
    }
    if (order === 'asc') out.reverse();
    return { records: out, nextSeq: this.seq };
  }

  /** Iterate matching records oldest → newest without building one big array (export). */
  *iterate(query: LogQuery): Generator<LogRecord> {
    const textMatcher = this.buildTextMatcher(query);
    for (let i = this.head; i < this.buf.length; i++) {
      const rec = this.buf[i];
      if (this.matches(rec, query, textMatcher)) yield rec;
    }
  }

  stats() {
    return {
      entries: this.buf.length - this.head,
      bytes: this.bytes,
      maxBytes: this.maxBytes,
      maxEntries: this.maxEntries,
      lastSeq: this.seq,
    };
  }
}

export const logRingBuffer = new LogRingBuffer(
  bootstrap.logBufferMaxBytes,
  bootstrap.logBufferMaxEntries
);
