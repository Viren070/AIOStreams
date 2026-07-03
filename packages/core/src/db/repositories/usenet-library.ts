import { EventEmitter } from 'node:events';
import { getDb } from '../db.js';
import { sql, join, raw, SqlFragment } from '../sql.js';

/**
 * In-process bus that fires `'change'` whenever a library row is created,
 * updated, or removed. The dashboard SSE endpoint subscribes to this to push
 * live updates to the UI. Single-process service, so a plain EventEmitter is
 * enough (no cross-instance fan-out needed).
 */
export const usenetLibraryBus: EventEmitter = new EventEmitter();
// Each open SSE connection adds a listener; lift the default cap so a handful of
// dashboard tabs don't trip the MaxListenersExceededWarning.
usenetLibraryBus.setMaxListeners(50);

/** Minimal file descriptor persisted with a library entry. */
export interface UsenetLibraryFile {
  name?: string;
  size: number;
  index?: number;
  /** Inner path when the file lives inside an archive (RAR/7z). */
  path?: string;
  /** File category (video/archive/par2/…) for the browse tree. */
  category?: string;
  /** Whether this file is directly streamable. */
  streamable?: boolean;
  /**
   * Opaque, JSON-serialised archive rebuild recipe (an engine `ArchiveStreamLayout`)
   * for inner files, so a cold stream open skips the archive header parse. Stored
   * as-is within the `files` JSON blob; only the usenet engine interprets it.
   */
  layout?: unknown;
  /**
   * Persisted hole map: segments confirmed missing on every provider, as
   * serialised `HoleRun` rows `[nzbFileIndex, startSegment, count]` (see
   * `usenet/holes.ts`). Written by the census shadow and by playback padding;
   * replays pre-pad these ranges instead of re-discovering them through a
   * failover round-trip. Engine-interpreted, like {@link layout}.
   */
  holes?: number[][];
}

export type UsenetLibraryStatus =
  | 'queued'
  | 'inspecting'
  | 'available'
  | 'degraded'
  | 'failed'
  | 'streaming';

export type UsenetLibrarySource = 'auto' | 'manual';

/** Status groups for dashboard filtering. */
export type UsenetLibraryStatusGroup = 'active' | 'history' | 'all';

/** Sortable fields for the dashboard list. */
export type UsenetLibrarySort = 'activity' | 'added' | 'name' | 'size';
export type UsenetLibrarySortDir = 'asc' | 'desc';

/** Whitelisted sort field → physical column (never interpolate user input). */
const SORT_COLUMNS: Record<UsenetLibrarySort, string> = {
  activity: 'last_used_at',
  added: 'added_at',
  name: 'name',
  size: 'size',
};

const ACTIVE_STATUSES: UsenetLibraryStatus[] = [
  'queued',
  'inspecting',
  'streaming',
];
const HISTORY_STATUSES: UsenetLibraryStatus[] = [
  'available',
  'degraded',
  'failed',
];

export interface UsenetLibraryEntry {
  nzbHash: string;
  name?: string;
  size?: number;
  /** Selected (best) file index, cached so resolve can skip re-inspection. */
  fileIndex?: number;
  files: UsenetLibraryFile[];
  status: UsenetLibraryStatus;
  /** Human-friendly failure message. */
  failReason?: string;
  /** Machine-readable failure code. */
  errorCode?: string;
  failCount: number;
  addedAt: string;
  lastUsedAt: string;
  /** Stable SABnzbd slot id (defaults to the nzb hash). */
  nzoId?: string;
  /** Stage-based progress 0..1 (no true % for native streaming). */
  progress: number;
  bytesDone: number;
  bytesTotal: number;
  /** AIOStreams auth username that added/triggered the entry. */
  owner?: string;
  source: UsenetLibrarySource;
  /** How long inspect/import took, in ms. */
  importMs?: number;
  /** Source NZB URL (manual adds); never the NZB body. */
  nzbUrl?: string;
  category?: string;
  /** NZB password (from `<meta>` or a `{{password}}` name token), if any. */
  password?: string;
}

interface UsenetLibraryRow {
  nzb_hash: string;
  name: string | null;
  size: number | string | null;
  file_index: number | null;
  files: string | null;
  status: string;
  fail_reason: string | null;
  error_code: string | null;
  fail_count: number | string | null;
  added_at: string | Date;
  last_used_at: string | Date;
  nzo_id: string | null;
  progress: number | string | null;
  bytes_done: number | string | null;
  bytes_total: number | string | null;
  owner: string | null;
  source: string | null;
  import_ms: number | string | null;
  nzb_url: string | null;
  category: string | null;
  password: string | null;
  [k: string]: unknown;
}

/**
 * Normalise a DB timestamp to an ISO-8601 UTC string. pg returns `Date`
 * objects; SQLite returns the bare `YYYY-MM-DD HH:MM:SS` UTC text stored by
 * CURRENT_TIMESTAMP.
 */
function toIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  // Leave already-zoned strings (Z suffix or ±HH:MM offset) untouched.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) return s;
  return s.replace(' ', 'T') + 'Z';
}

function parseFiles(raw: string | null): UsenetLibraryFile[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UsenetLibraryFile[]) : [];
  } catch {
    return [];
  }
}

const VALID_STATUSES = new Set<UsenetLibraryStatus>([
  'queued',
  'inspecting',
  'available',
  'degraded',
  'failed',
  'streaming',
]);

function mapRow(row: UsenetLibraryRow): UsenetLibraryEntry {
  const status = VALID_STATUSES.has(row.status as UsenetLibraryStatus)
    ? (row.status as UsenetLibraryStatus)
    : 'available';
  return {
    nzbHash: row.nzb_hash,
    name: row.name ?? undefined,
    size: row.size == null ? undefined : Number(row.size),
    fileIndex: row.file_index ?? undefined,
    files: parseFiles(row.files),
    status,
    failReason: row.fail_reason ?? undefined,
    errorCode: row.error_code ?? undefined,
    failCount: Number(row.fail_count ?? 0),
    addedAt: toIso(row.added_at),
    lastUsedAt: toIso(row.last_used_at),
    nzoId: row.nzo_id ?? row.nzb_hash,
    progress: row.progress == null ? 0 : Number(row.progress),
    bytesDone: Number(row.bytes_done ?? 0),
    bytesTotal: Number(row.bytes_total ?? 0),
    owner: row.owner ?? undefined,
    source: row.source === 'manual' ? 'manual' : 'auto',
    importMs: row.import_ms == null ? undefined : Number(row.import_ms),
    nzbUrl: row.nzb_url ?? undefined,
    category: row.category ?? undefined,
    password: row.password ?? undefined,
  };
}

const COLUMNS = sql`nzb_hash, name, size, file_index, files, status, fail_reason, error_code, fail_count, added_at, last_used_at, nzo_id, progress, bytes_done, bytes_total, owner, source, import_ms, nzb_url, category, password`;

/**
 * Persistence for the native usenet library/history (one row per NZB content
 * hash). Backs the service's `library`/file-list/failed reporting, the
 * dashboard (live imports, history, manual add, browse, deletion) and the
 * SABnzbd-compatible API (`usenet/integration/sabnzbd.ts`), which projects
 * these rows onto queue/history slots.
 */
export class UsenetLibraryRepository {
  static async get(nzbHash: string): Promise<UsenetLibraryEntry | undefined> {
    const row = await getDb().maybeOne<UsenetLibraryRow>(
      sql`SELECT ${COLUMNS} FROM usenet_library WHERE nzb_hash = ${nzbHash}`
    );
    return row ? mapRow(row) : undefined;
  }

  static async getMany(
    nzbHashes: string[]
  ): Promise<Map<string, UsenetLibraryEntry>> {
    const result = new Map<string, UsenetLibraryEntry>();
    const unique = [...new Set(nzbHashes.filter(Boolean))];
    if (unique.length === 0) return result;
    const placeholders = join(unique.map((h) => sql`${h}`));
    const rows = await getDb().query<UsenetLibraryRow>(
      sql`SELECT ${COLUMNS} FROM usenet_library WHERE nzb_hash IN (${placeholders})`
    );
    for (const row of rows) {
      const entry = mapRow(row);
      result.set(entry.nzbHash, entry);
    }
    return result;
  }

  /** Create (or reset) a row at the start of an import lifecycle. */
  static async create(entry: {
    nzbHash: string;
    name?: string;
    owner?: string;
    source?: UsenetLibrarySource;
    nzbUrl?: string;
    bytesTotal?: number;
    category?: string;
  }): Promise<void> {
    await getDb().exec(
      sql`INSERT INTO usenet_library
            (nzb_hash, name, files, status, fail_count, last_used_at,
             nzo_id, progress, bytes_done, bytes_total, owner, source, nzb_url, category)
          VALUES
            (${entry.nzbHash}, ${entry.name ?? null}, '[]', 'queued', 0, CURRENT_TIMESTAMP,
             ${entry.nzbHash}, 0, 0, ${entry.bytesTotal ?? 0}, ${entry.owner ?? null}, ${entry.source ?? 'auto'}, ${entry.nzbUrl ?? null}, ${entry.category ?? null})
          ON CONFLICT(nzb_hash) DO UPDATE SET
            name = COALESCE(EXCLUDED.name, usenet_library.name),
            status = 'queued',
            progress = 0,
            owner = COALESCE(EXCLUDED.owner, usenet_library.owner),
            source = EXCLUDED.source,
            nzb_url = COALESCE(EXCLUDED.nzb_url, usenet_library.nzb_url),
            category = COALESCE(EXCLUDED.category, usenet_library.category),
            last_used_at = CURRENT_TIMESTAMP`
    );
    usenetLibraryBus.emit('change');
  }

  /**
   * Update the lifecycle status (+ optional progress) of an entry.
   * `guard.notIn` skips the update when the row is currently in one of those
   * statuses (e.g. a census-shadow verdict must never resurrect `failed`).
   */
  static async setStatus(
    nzbHash: string,
    status: UsenetLibraryStatus,
    patch: { progress?: number; guard?: { notIn: UsenetLibraryStatus[] } } = {}
  ): Promise<void> {
    const progress =
      patch.progress ??
      (status === 'available' || status === 'degraded' || status === 'failed'
        ? 1
        : status === 'inspecting'
          ? 0.5
          : 0);
    const guard = patch.guard?.notIn?.length
      ? sql` AND status NOT IN (${join(patch.guard.notIn.map((s) => sql`${s}`))})`
      : sql``;
    await getDb().exec(
      sql`UPDATE usenet_library
          SET status = ${status}, progress = ${progress}, last_used_at = CURRENT_TIMESTAMP
          WHERE nzb_hash = ${nzbHash}${guard}`
    );
    usenetLibraryBus.emit('change');
  }

  /**
   * Record a successfully-inspected NZB and its streamable file list.
   * `status` may be `degraded` when the import's census confirmed small
   * damage (the files carry the hole map; playback zero-fills).
   */
  static async upsertAvailable(entry: {
    nzbHash: string;
    name?: string;
    size?: number;
    fileIndex?: number;
    files: UsenetLibraryFile[];
    owner?: string;
    source?: UsenetLibrarySource;
    importMs?: number;
    nzbUrl?: string;
    password?: string;
    status?: 'available' | 'degraded';
  }): Promise<void> {
    const filesJson = JSON.stringify(entry.files ?? []);
    const status = entry.status ?? 'available';
    await getDb().exec(
      sql`INSERT INTO usenet_library
            (nzb_hash, name, size, file_index, files, status, fail_reason, error_code, fail_count, last_used_at,
             nzo_id, progress, bytes_done, bytes_total, owner, source, import_ms, nzb_url, password)
          VALUES
            (${entry.nzbHash}, ${entry.name ?? null}, ${entry.size ?? null}, ${entry.fileIndex ?? null}, ${filesJson}, ${status}, NULL, NULL, 0, CURRENT_TIMESTAMP,
             ${entry.nzbHash}, 1, ${entry.size ?? 0}, ${entry.size ?? 0}, ${entry.owner ?? null}, ${entry.source ?? 'auto'}, ${entry.importMs ?? null}, ${entry.nzbUrl ?? null}, ${entry.password ?? null})
          ON CONFLICT(nzb_hash) DO UPDATE SET
            name = EXCLUDED.name,
            size = EXCLUDED.size,
            file_index = EXCLUDED.file_index,
            files = EXCLUDED.files,
            status = EXCLUDED.status,
            fail_reason = NULL,
            error_code = NULL,
            progress = 1,
            bytes_done = EXCLUDED.bytes_done,
            bytes_total = EXCLUDED.bytes_total,
            owner = COALESCE(EXCLUDED.owner, usenet_library.owner),
            source = EXCLUDED.source,
            import_ms = COALESCE(EXCLUDED.import_ms, usenet_library.import_ms),
            nzb_url = COALESCE(EXCLUDED.nzb_url, usenet_library.nzb_url),
            password = COALESCE(EXCLUDED.password, usenet_library.password),
            last_used_at = CURRENT_TIMESTAMP`
    );
    usenetLibraryBus.emit('change');
  }

  /** Mark an NZB as failed with a friendly message + machine code. */
  static async markFailed(
    nzbHash: string,
    reason: string,
    name?: string,
    errorCode?: string
  ): Promise<void> {
    await getDb().exec(
      sql`INSERT INTO usenet_library
            (nzb_hash, name, files, status, fail_reason, error_code, fail_count, last_used_at, nzo_id, progress)
          VALUES
            (${nzbHash}, ${name ?? null}, '[]', 'failed', ${reason}, ${errorCode ?? null}, 1, CURRENT_TIMESTAMP, ${nzbHash}, 1)
          ON CONFLICT(nzb_hash) DO UPDATE SET
            status = 'failed',
            fail_reason = EXCLUDED.fail_reason,
            error_code = EXCLUDED.error_code,
            progress = 1,
            fail_count = usenet_library.fail_count + 1,
            last_used_at = CURRENT_TIMESTAMP`
    );
    usenetLibraryBus.emit('change');
  }

  /** Bump the activity timestamp for an entry (best-effort). */
  static async touch(nzbHash: string): Promise<void> {
    await getDb().exec(
      sql`UPDATE usenet_library SET last_used_at = CURRENT_TIMESTAMP WHERE nzb_hash = ${nzbHash}`
    );
  }

  /** In-process per-hash patch chains (see {@link patchFiles}). */
  private static filesPatchChains = new Map<string, Promise<void>>();

  /**
   * Read-modify-write the `files` JSON blob, serialized per hash via an
   * in-process promise chain (single-process service; two episodes of the
   * same NZB streaming concurrently would otherwise last-writer-wins each
   * other's patch). `mutate` returns false to skip the write. Deliberately
   * does NOT emit a library change event: these fields are invisible to the
   * dashboard list and patches recur during playback.
   */
  private static patchFiles(
    nzbHash: string,
    mutate: (files: UsenetLibraryFile[]) => boolean
  ): Promise<void> {
    const prev = this.filesPatchChains.get(nzbHash) ?? Promise.resolve();
    const run = prev.then(async () => {
      const entry = await this.get(nzbHash);
      if (!entry) return;
      if (!mutate(entry.files)) return;
      await getDb().exec(
        sql`UPDATE usenet_library SET files = ${JSON.stringify(entry.files)} WHERE nzb_hash = ${nzbHash}`
      );
    });
    // The chain tail swallows rejections so one failed patch neither wedges
    // later patches nor leaks an unhandled rejection; callers still see the
    // original promise.
    const tail = run.catch(() => {});
    this.filesPatchChains.set(nzbHash, tail);
    void tail.then(() => {
      if (this.filesPatchChains.get(nzbHash) === tail) {
        this.filesPatchChains.delete(nzbHash);
      }
    });
    return run;
  }

  /**
   * Patch ONE file's archive layout inside the `files` JSON blob. Lazy RAR
   * fragment resolution persists its progress through this so later opens
   * skip re-resolving; `layout: null` clears a poisoned layout so the next
   * open takes the full-parse path.
   */
  static updateFileLayout(
    nzbHash: string,
    path: string,
    layout: unknown
  ): Promise<void> {
    return this.patchFiles(nzbHash, (files) => {
      const file = files.find((f) => f.path === path);
      if (!file) return false;
      file.layout = layout ?? undefined;
      return true;
    });
  }

  /** Select a library file by inner path (preferred) or NZB file index. */
  private static findFile(
    files: UsenetLibraryFile[],
    selector: { path?: string; index?: number }
  ): UsenetLibraryFile | undefined {
    if (selector.path !== undefined) {
      return files.find((f) => f.path === selector.path);
    }
    if (selector.index !== undefined) {
      return files.find((f) => f.index === selector.index);
    }
    return undefined;
  }

  /**
   * Replace ONE file's persisted hole map (serialised `HoleRun` rows; see
   * `usenet/holes.ts`). Written by the census shadow and by playback padding
   * (debounced by callers); `null` clears it.
   */
  static updateFileHoles(
    nzbHash: string,
    selector: { path?: string; index?: number },
    holes: number[][] | null
  ): Promise<void> {
    return this.patchFiles(nzbHash, (files) => {
      const file = this.findFile(files, selector);
      if (!file) return false;
      file.holes = holes && holes.length > 0 ? holes : undefined;
      return true;
    });
  }

  /**
   * Flip ONE file's streamable flag (census shadow marking a pack member
   * whose backing volumes are dead). Emits a change event: this is visible
   * in the dashboard browse tree.
   */
  static async updateFileStreamable(
    nzbHash: string,
    selector: { path?: string; index?: number },
    streamable: boolean
  ): Promise<void> {
    await this.patchFiles(nzbHash, (files) => {
      const file = this.findFile(files, selector);
      if (!file || file.streamable === streamable) return false;
      file.streamable = streamable;
      return true;
    });
    usenetLibraryBus.emit('change');
  }

  static async delete(nzbHash: string): Promise<void> {
    await getDb().exec(
      sql`DELETE FROM usenet_library WHERE nzb_hash = ${nzbHash}`
    );
    usenetLibraryBus.emit('change');
  }

  /** Remove every entry from the library. */
  static async clear(): Promise<void> {
    await getDb().exec(sql`DELETE FROM usenet_library`);
    usenetLibraryBus.emit('change');
  }

  /** The streamable file list for an entry. */
  static async getFiles(nzbHash: string): Promise<UsenetLibraryFile[]> {
    const entry = await this.get(nzbHash);
    return entry?.files ?? [];
  }

  /** Every category that has been assigned to an entry (SABnzbd `get_cats`). */
  static async distinctCategories(): Promise<string[]> {
    const rows = await getDb().query<{ category: string }>(
      sql`SELECT DISTINCT category FROM usenet_library WHERE category IS NOT NULL`
    );
    return rows.map((r) => r.category).filter(Boolean);
  }

  /**
   * Paginated list for the dashboard, newest activity first. `group` selects
   * active imports (queued/inspecting/streaming), history (available/failed),
   * or all.
   */
  static async list(
    opts: {
      limit?: number;
      offset?: number;
      group?: UsenetLibraryStatusGroup;
      /**
       * Explicit status filter. When non-empty it takes precedence over
       * `group`, letting the dashboard isolate e.g. all failed entries. Unknown
       * statuses are ignored.
       */
      statuses?: UsenetLibraryStatus[];
      /** Case-insensitive substring match against the entry name. */
      search?: string;
      /** Sort field (defaults to recent activity). */
      sort?: UsenetLibrarySort;
      /** Sort direction (defaults to desc). */
      dir?: UsenetLibrarySortDir;
    } = {}
  ): Promise<{ entries: UsenetLibraryEntry[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const group = opts.group ?? 'all';
    const explicit = (opts.statuses ?? []).filter((s) => VALID_STATUSES.has(s));
    const statuses =
      explicit.length > 0
        ? explicit
        : group === 'active'
          ? ACTIVE_STATUSES
          : group === 'history'
            ? HISTORY_STATUSES
            : null;
    const conditions: SqlFragment[] = [];
    if (statuses) {
      conditions.push(sql`status IN (${join(statuses.map((s) => sql`${s}`))})`);
    }
    const search = opts.search?.trim();
    if (search) {
      conditions.push(
        sql`LOWER(name) LIKE ${'%' + search.toLowerCase() + '%'}`
      );
    }
    const where = conditions.length
      ? sql`WHERE ${join(conditions, ' AND ')}`
      : sql``;
    // Column + direction come from hardcoded allow-lists, so `raw` is safe here.
    const sortCol =
      SORT_COLUMNS[opts.sort ?? 'activity'] ?? SORT_COLUMNS.activity;
    const sortDir = opts.dir === 'asc' ? 'ASC' : 'DESC';
    const orderBy = raw(`ORDER BY ${sortCol} ${sortDir}, nzb_hash ASC`);
    const rows = await getDb().query<UsenetLibraryRow>(
      sql`SELECT ${COLUMNS} FROM usenet_library ${where}
          ${orderBy} LIMIT ${limit} OFFSET ${offset}`
    );
    const countRow = await getDb().maybeOne<{ count: number | string }>(
      sql`SELECT COUNT(*) AS count FROM usenet_library ${where}`
    );
    return {
      entries: rows.map(mapRow),
      total: Number(countRow?.count ?? 0),
    };
  }
}
