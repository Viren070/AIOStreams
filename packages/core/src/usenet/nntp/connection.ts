import net from 'node:net';
import tls from 'node:tls';
import { createLogger } from '../../logging/logger.js';
import { ProviderConfig } from '../types.js';
import {
  NntpError,
  classifyNntpStatus,
  isConnectionLimitResponse,
} from './errors.js';
import {
  CRLF,
  DOT_TERMINATOR,
  NntpOnreadParser,
  parseStatusLine,
  statusClass,
} from './protocol.js';

const logger = createLogger('usenet/connection');

export interface ConnectionOptions {
  dialTimeoutMs: number;
  idleConnectionMs: number;
}

/**
 * One in-flight request on a (possibly pipelined) connection. Several may be
 * queued at once: their commands are written back-to-back and the responses are
 * matched to requests strictly FIFO, since NNTP delivers them in request order.
 *
 * A `body` request is a TWO-STAGE state machine: first a status line, then (on
 * a 2xx) the multiline payload. Unlike a sequential `command()`, the status of
 * request N+1 cannot be read until request N's body has fully drained.
 * `line` requests (STAT/DATE/GROUP/AUTH) are single-stage.
 */
interface PipelineRequest {
  /** `line` = status line only; `body` = status line then multiline payload. */
  kind: 'line' | 'body';
  /** Sub-state within a `body` request. */
  stage: 'status' | 'payload';
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  /** Per-command read budget (ms) for the rolling stall timer. */
  timeoutMs: number;
  onAbort?: () => void;
  signal?: AbortSignal;
  /**
   * Streaming payload: raw chunks are handed here as they arrive (nothing
   * accumulates) and the request resolves with the total payload byte count once
   * the dot terminator is seen. Absent = buffer the whole payload into a slot.
   */
  consumer?: (chunk: Buffer) => void;
}

let CONNECTION_SEQ = 0;

/** Upper bound (bytes) on a pooled article buffer; larger payloads are allocated fresh, not pooled. */
const RAW_POOL_CAP = 1 << 20;

/** Per-connection reused socket-read buffer for the `onread` path (Node fills it, consumed synchronously). */
const READ_BUF_SIZE = 256 * 1024;

/**
 * A single NNTP connection over TCP or TLS. Supports **pipelining**: multiple
 * `BODY`/`STAT` commands may be in flight at once (bounded by the caller), with
 * responses matched to requests FIFO. A rolling stall timer destroys the socket
 * if the peer stops making progress; any socket/timeout error rejects the whole
 * in-flight queue (the failover layer resubmits), so one hung stream can't wedge
 * the rest. A clean `430` rejects only its own request; the connection stays
 * healthy. GROUP/AUTH/greeting are issued sequentially (never pipelined).
 */
export class NntpConnection {
  readonly id: number;
  readonly label: string;
  private socket: net.Socket | tls.TLSSocket;
  /** Zero-alloc streaming parser, fed the reused read buffer synchronously. */
  private readonly parser = new NntpOnreadParser();
  /** Reused per-connection socket read buffer (Node fills it, no per-read alloc). */
  private readBuf: Buffer;
  /** FIFO queue of in-flight requests; head is the one currently being read. */
  private queue: PipelineRequest[] = [];
  /** Rolling "no progress" timer, (re)armed while the queue is non-empty. */
  private stallTimer: NodeJS.Timeout | null = null;
  private destroyed = false;
  private fatalError: Error | null = null;
  /** Set when a protocol desync is detected: the connection must not be reused. */
  private pipeliningUnsafe = false;

  currentGroup: string | null = null;
  /** Epoch ms after which this idle connection is considered stale. */
  staleAt = 0;

  /**
   * Reusable destination buffers for buffered article payloads, recycled in a
   * ring so each segment doesn't allocate a fresh buffer. The ring grows to
   * `inFlight + 1` so a slot is never reused while an earlier resolved-but-not-
   * yet-decoded body still views it (bodies resolve synchronously during an
   * `onRead` pass; their decode runs in later microtasks). Buffers larger than
   * {@link RAW_POOL_CAP} are allocated fresh to bound retained memory.
   */
  private rawSlots: Buffer[] = [];
  private rawNext = 0;

  private constructor(
    socket: net.Socket | tls.TLSSocket,
    label: string,
    private opts: ConnectionOptions,
    readBuf: Buffer
  ) {
    this.id = ++CONNECTION_SEQ;
    this.label = label;
    this.socket = socket;
    this.readBuf = readBuf;
    this.attach();
  }

  get isUsable(): boolean {
    return (
      !this.destroyed &&
      !this.fatalError &&
      !this.pipeliningUnsafe &&
      !this.socket.destroyed
    );
  }

  /** Number of requests currently in flight (written, awaiting a response). */
  get inFlight(): number {
    return this.queue.length;
  }

  /**
   * Whether another request can be pipelined onto this connection right now: it
   * must be usable and have fewer than `depth` requests already in flight.
   */
  canAccept(depth: number): boolean {
    return this.isUsable && this.queue.length < Math.max(1, depth);
  }

  private attach(): void {
    // The socket is consumed via the reused read-buffer callback wired at
    // construction (no `'data'` events fire); we only handle error/close here.
    const fail = (err: Error) => {
      this.fatalError =
        err instanceof NntpError
          ? err
          : new NntpError('connection', err.message, {
              provider: this.label,
              cause: err,
            });
      this.rejectAll(this.fatalError);
      this.destroy();
    };
    this.socket.on('error', fail);
    this.socket.on('close', () => {
      if (!this.destroyed) {
        fail(
          new NntpError('connection', 'socket closed by peer', {
            provider: this.label,
          })
        );
      }
    });
  }

  /** Open a connection and consume the server greeting. */
  static async connect(
    config: ProviderConfig,
    opts: ConnectionOptions
  ): Promise<NntpConnection> {
    const label = config.name ?? config.id;
    // The socket is created WITH a reused read buffer whose callback routes to the
    // (not-yet-constructed) instance. `conn` is assigned in the microtask after
    // connect resolves, before the first onread IO tick fires, so the closure always
    // sees a live instance (the `conn?.` guard is belt-and-braces).
    const readBuf = Buffer.allocUnsafe(READ_BUF_SIZE);
    let conn: NntpConnection | undefined;
    // `onread` is valid on both net and tls sockets at runtime but is missing from
    // @types/node's tls.ConnectionOptions; spread it in (via a variable) to skip the
    // excess-property check.
    const onreadOpt = {
      onread: {
        buffer: readBuf,
        callback: (bytesRead: number, buf: Buffer): boolean => {
          conn?.onRead(bytesRead, buf);
          return true;
        },
      },
    };
    const socket = await new Promise<net.Socket | tls.TLSSocket>(
      (resolve, reject) => {
        const onError = (err: Error) =>
          reject(
            new NntpError('connection', `dial failed: ${err.message}`, {
              provider: label,
              cause: err,
            })
          );
        let s: net.Socket | tls.TLSSocket;
        const timer = setTimeout(() => {
          s?.destroy();
          reject(new NntpError('timeout', 'dial timeout', { provider: label }));
        }, opts.dialTimeoutMs);
        const onConnect = () => {
          clearTimeout(timer);
          s.setNoDelay(true);
          s.setKeepAlive(true, 30_000);
          resolve(s);
        };
        if (config.tls) {
          s = tls.connect({
            host: config.host,
            port: config.port,
            rejectUnauthorized: !config.tlsSkipVerify,
            servername: config.host,
            ...onreadOpt,
          });
          s.once('secureConnect', onConnect);
        } else {
          s = net.connect({
            host: config.host,
            port: config.port,
            ...onreadOpt,
          });
          s.once('connect', onConnect);
        }
        s.once('error', onError);
      }
    );

    conn = new NntpConnection(socket, label, opts, readBuf);
    // Greeting: 200 (posting allowed) or 201 (no posting). Unsolicited: the
    // server sends it on connect, so read a line without writing a command.
    const greeting = await conn.readGreeting(opts.dialTimeoutMs);
    const status = parseStatusLine(greeting);
    if (status.code !== 200 && status.code !== 201) {
      conn.destroy();
      // Some providers refuse the connection at greeting time when the account
      // ceiling is hit (502/400/"too many connections"). Treat that as transient
      // capacity backpressure, not a hard protocol error, so the pool throttles.
      const limited = isConnectionLimitResponse(status.code, greeting);
      if (!limited) {
        logger.warn(
          {
            provider: config.name ?? config.id,
            host: config.host,
            code: status.code,
          },
          'unexpected nntp greeting'
        );
      }
      throw new NntpError(
        limited ? 'connection_limit' : 'protocol',
        limited
          ? `connection limit at greeting: ${greeting}`
          : `unexpected greeting: ${greeting}`,
        { code: status.code, provider: config.name ?? config.id }
      );
    }

    if (config.username) {
      await conn.authenticate(config.username, config.password ?? '');
    }

    conn.touch();
    logger.debug(
      {
        provider: config.name ?? config.id,
        host: config.host,
        port: config.port,
        tls: config.tls,
        connId: conn.id,
      },
      'nntp connection established'
    );
    return conn;
  }

  private async authenticate(
    username: string,
    password: string
  ): Promise<void> {
    const userResp = await this.command(
      `AUTHINFO USER ${username}`,
      undefined,
      this.opts.dialTimeoutMs
    );
    const userStatus = parseStatusLine(userResp);
    if (userStatus.code === 281) return; // accepted without password
    if (userStatus.code !== 381) {
      // A "too many connections" rejection (TorBox uses 482 here) is capacity
      // backpressure, not bad credentials; classify it as transient so the pool
      // throttles instead of latching the provider dead.
      const limited = isConnectionLimitResponse(userStatus.code, userResp);
      throw new NntpError(
        limited ? 'connection_limit' : 'auth_failed',
        `auth user rejected: ${userResp}`,
        { code: userStatus.code, provider: this.label }
      );
    }
    const passResp = await this.command(
      `AUTHINFO PASS ${password}`,
      undefined,
      this.opts.dialTimeoutMs
    );
    const passStatus = parseStatusLine(passResp);
    if (passStatus.code !== 281) {
      // 482/502/"too many connections" at AUTHINFO PASS is the account
      // connection ceiling, not a credential failure (this is where TorBox's
      // `482 too many connections for your user` lands). Surface it as transient.
      const limited = isConnectionLimitResponse(passStatus.code, passResp);
      if (!limited) {
        logger.warn(
          { provider: this.label, code: passStatus.code },
          'nntp authentication rejected'
        );
      }
      throw new NntpError(
        limited ? 'connection_limit' : 'auth_failed',
        limited
          ? `connection limit reached: ${passResp}`
          : `auth pass rejected: ${passStatus.code}`,
        { code: passStatus.code, provider: this.label }
      );
    }
  }

  /** Select a newsgroup. */
  async group(
    name: string,
    signal?: AbortSignal,
    timeoutMs = 30_000
  ): Promise<void> {
    const resp = await this.command(`GROUP ${name}`, signal, timeoutMs);
    const status = parseStatusLine(resp);
    if (status.code !== 211) {
      throw new NntpError(
        classifyNntpStatus(status.code),
        `GROUP failed: ${resp}`,
        {
          code: status.code,
          provider: this.label,
        }
      );
    }
    this.currentGroup = name;
  }

  /**
   * Fetch a raw article body (still dot-stuffed). messageId without <>. May be
   * pipelined: the command is written immediately and the response matched FIFO,
   * so several concurrent `body()` calls share one connection.
   */
  body(
    messageId: string,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ): Promise<Buffer> {
    return this.submit<Buffer>(
      'body',
      `BODY <${messageId}>`,
      signal,
      timeoutMs
    );
  }

  /**
   * Fetch an article body, streaming the raw (dot-stuffed) payload to
   * `onChunk` instead of buffering it: the wire still carries the whole
   * article, but the process never holds it. Resolves with the total payload
   * byte count. Used by import probes that only need the leading bytes.
   */
  bodyStreaming(
    messageId: string,
    onChunk: (chunk: Buffer) => void,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ): Promise<number> {
    return this.submit<number>(
      'body',
      `BODY <${messageId}>`,
      signal,
      timeoutMs,
      onChunk
    );
  }

  /** STAT returns true if the article exists, false on 430. May be pipelined. */
  async stat(
    messageId: string,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ): Promise<boolean> {
    const resp = await this.command(`STAT <${messageId}>`, signal, timeoutMs);
    const status = parseStatusLine(resp);
    if (status.code === 223) return true;
    if (status.code === 430 || status.code === 423) return false;
    throw new NntpError(
      classifyNntpStatus(status.code),
      `STAT failed: ${resp}`,
      {
        code: status.code,
        provider: this.label,
      }
    );
  }

  /** DATE: cheap health check / keepalive. */
  async date(signal?: AbortSignal, timeoutMs = 15_000): Promise<void> {
    const resp = await this.command('DATE', signal, timeoutMs);
    const status = parseStatusLine(resp);
    if (status.code !== 111) {
      throw new NntpError('protocol', `DATE failed: ${resp}`, {
        code: status.code,
        provider: this.label,
      });
    }
  }

  quit(): void {
    if (this.isUsable) {
      try {
        this.socket.write(Buffer.concat([Buffer.from('QUIT'), CRLF]));
      } catch {
        /* ignore */
      }
    }
    this.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearStallTimer();
    // Fail any still-queued requests so callers never hang on a dead socket.
    if (this.queue.length > 0) {
      this.rejectAll(
        this.fatalError ??
          new NntpError('connection', 'connection destroyed', {
            provider: this.label,
          })
      );
    }
    try {
      this.socket.destroy();
    } catch {
      /* ignore */
    }
  }

  /** Refresh the idle stale deadline (called on release). */
  touch(): void {
    this.staleAt = Date.now() + this.opts.idleConnectionMs;
  }

  isStale(): boolean {
    return this.staleAt > 0 && Date.now() > this.staleAt;
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Issue a single-line-response command (STAT/GROUP/DATE/AUTHINFO) and resolve
   * with the raw status line. Does NOT throw on protocol error codes; the
   * caller classifies them (so e.g. "too many connections" can be told apart
   * from a credential failure). May be pipelined, though in practice these are
   * only issued during sequential setup / health checks.
   */
  private command(
    line: string,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ): Promise<string> {
    return this.submit<string>('line', line, signal, timeoutMs);
  }

  /**
   * Write a command immediately and queue a request for its response, matched to
   * the response stream strictly FIFO. Concurrent calls pipeline onto the one
   * connection (the caller bounds depth via {@link canAccept}).
   */
  private submit<T>(
    kind: 'line' | 'body',
    line: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    consumer?: (chunk: Buffer) => void
  ): Promise<T> {
    if (!this.isUsable) {
      return Promise.reject(
        this.fatalError ??
          new NntpError('connection', 'connection not usable', {
            provider: this.label,
          })
      );
    }
    if (signal?.aborted) {
      this.destroy();
      return Promise.reject(
        new NntpError('connection', 'aborted', { provider: this.label })
      );
    }
    this.write(line);
    return this.queueRequest<T>(kind, signal, timeoutMs, consumer);
  }

  /**
   * Read the unsolicited server greeting (sent on connect, with no command
   * written first). Single-line, never pipelined.
   */
  private readGreeting(timeoutMs: number): Promise<string> {
    return this.queueRequest<string>('line', undefined, timeoutMs);
  }

  /** Push a response request and resolve when the FIFO machine completes it. */
  private queueRequest<T>(
    kind: 'line' | 'body',
    signal: AbortSignal | undefined,
    timeoutMs: number,
    consumer?: (chunk: Buffer) => void
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const req: PipelineRequest = {
        kind,
        stage: 'status',
        resolve,
        reject,
        timeoutMs,
        signal,
        consumer,
      };
      if (signal) {
        // Aborting one request mid-pipeline can't un-send its command, so the
        // safe response is to tear the whole connection down (the failover layer
        // resubmits). In practice the pipelined fetch path runs signal-free.
        req.onAbort = () => {
          this.destroy();
        };
        signal.addEventListener('abort', req.onAbort, { once: true });
      }
      this.queue.push(req);
      this.armStallTimer();
      // Response bytes only exist during a read callback; the next onRead picks
      // this request up.
    });
  }

  private write(line: string): void {
    this.socket.write(Buffer.concat([Buffer.from(line, 'utf8'), CRLF]));
  }

  /**
   * (Re)arm the rolling "no progress" timer based on the head request's budget.
   * Reset on every inbound byte (see {@link attach}) and whenever the head
   * advances, so it fires only after a full `timeoutMs` of silence with work
   * still in flight.
   */
  private armStallTimer(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    const head = this.queue[0];
    if (!head) {
      this.stallTimer = null;
      return;
    }
    const timeoutMs = head.timeoutMs;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      logger.warn(
        {
          provider: this.label,
          connId: this.id,
          timeoutMs,
          inFlight: this.queue.length,
        },
        'nntp connection stalled; destroying'
      );
      this.fatalError = new NntpError(
        'timeout',
        `no response progress for ${timeoutMs}ms`,
        { provider: this.label }
      );
      this.destroy();
    }, timeoutMs);
    this.stallTimer.unref?.();
  }

  private clearStallTimer(): void {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  /** Re-entrancy guard for {@link onRead} (a synchronous `resolve` may enqueue). */
  private processing = false;

  /**
   * onread read path: drive the FIFO machine over the reused socket buffer
   * `buf[0..nread]` synchronously. Reads from the live window via
   * {@link NntpOnreadParser}; the window is only valid during this call, so
   * buffered bodies are copied into a pooled slot before resolving.
   */
  private onRead(nread: number, buf: Buffer): void {
    const parser = this.parser;
    if (!parser || this.destroyed || this.processing) return;
    // Any byte from the peer is progress; push the rolling stall deadline out.
    this.armStallTimer();
    this.processing = true;
    try {
      let off = 0;
      while (off < nread && this.queue.length > 0) {
        const head = this.queue[0];
        if (head.stage === 'status') {
          const step = parser.feedLine(buf, off, nread);
          if (step.status === 'need-more') return;
          if (step.status === 'desync') {
            this.onDesync('non-line where a status line was expected');
            return;
          }
          off = step.off;
          if (!this.onStatusLine(head, step.text)) return; // desync handled inside
          continue;
        }
        // payload stage
        const step = parser.feedBody(buf, off, nread);
        off = step.off;
        if (!step.ended) return; // window exhausted; the carry is retained
        if (head.consumer) {
          const streamed = parser.streamed;
          this.finishHead(() => head.resolve(streamed));
        } else {
          // A view of the pooled slot, valid until the ring recycles it (after
          // `inFlight` more bodies); long enough for the synchronous decode that
          // follows the resolve in the next microtask.
          const body = parser.dest!.subarray(0, parser.bodyLen);
          this.finishHead(() => head.resolve(body));
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Act on a completed status line for the current head (onread mode): resolve a
   * line request, reject a body 4xx (consuming no payload, so the connection
   * stays healthy), or arm the parser for the 2xx payload. Returns false (after
   * tearing the connection down) on a desync.
   */
  private onStatusLine(head: PipelineRequest, line: string): boolean {
    const parser = this.parser!;
    const status = parseStatusLine(line);
    if (status.code === 0) {
      this.onDesync(line);
      return false;
    }
    if (head.kind === 'line') {
      this.finishHead(() => head.resolve(line));
      return true;
    }
    // body request: ≥4xx (e.g. 430) → reject ONLY this request, no body to read.
    if (statusClass(status.code) >= 4) {
      const err = new NntpError(
        classifyNntpStatus(status.code),
        `command failed: ${status.code} ${status.message}`,
        { code: status.code, provider: this.label }
      );
      this.finishHead(() => head.reject(err));
      return true;
    }
    head.stage = 'payload';
    if (head.consumer) {
      parser.beginStreamingBody(head.consumer);
    } else {
      // Fixed-cap pooled slot: size is unknown until the terminator, so the body
      // streams in and the slot's own tail is the terminator carry.
      parser.beginBufferedBody(this.acquireRaw(RAW_POOL_CAP));
    }
    return true;
  }

  /** Pipeline desync: mark unusable, latch the error, destroy. */
  private onDesync(line: string): void {
    this.pipeliningUnsafe = true;
    this.fatalError = new NntpError('protocol', `protocol desync: ${line}`, {
      provider: this.label,
    });
    this.destroy();
  }

  /** Shift the completed head, re-arm the stall timer, then deliver its result. */
  private finishHead(deliver: () => void): void {
    const head = this.queue.shift();
    if (!head) return;
    if (head.signal && head.onAbort) {
      head.signal.removeEventListener('abort', head.onAbort);
    }
    this.armStallTimer();
    deliver();
  }

  /**
   * Return a recycled destination buffer of at least `size` bytes for the next
   * buffered article payload. The ring holds one slot per concurrently in-flight
   * request (+1 margin) so a slot is never overwritten while an earlier body it
   * backs is still awaiting decode. Oversized articles bypass the pool.
   */
  private acquireRaw(size: number): Buffer {
    if (size > RAW_POOL_CAP) return Buffer.allocUnsafe(size);
    const want = Math.max(2, this.queue.length + 1);
    while (this.rawSlots.length < want) {
      this.rawSlots.push(Buffer.allocUnsafe(size));
    }
    if (this.rawNext >= this.rawSlots.length) this.rawNext = 0;
    let buf = this.rawSlots[this.rawNext];
    if (buf.length < size) {
      buf = Buffer.allocUnsafe(size);
      this.rawSlots[this.rawNext] = buf;
    }
    this.rawNext = (this.rawNext + 1) % this.rawSlots.length;
    return buf;
  }

  /** Reject every in-flight request (socket error / timeout / destroy). */
  private rejectAll(err: Error): void {
    const pending = this.queue;
    this.queue = [];
    this.clearStallTimer();
    for (const req of pending) {
      if (req.signal && req.onAbort) {
        req.signal.removeEventListener('abort', req.onAbort);
      }
      req.reject(err);
    }
  }
}

export { DOT_TERMINATOR };
