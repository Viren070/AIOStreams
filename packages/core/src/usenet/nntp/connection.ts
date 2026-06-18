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
  NntpResponseReader,
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
  /** Multiline scan watermark (avoids rescanning already-scanned bytes). */
  scanned: number;
  /**
   * Streaming payload: raw chunks are handed here as they arrive (nothing
   * accumulates) and the request resolves with the total payload byte count once
   * the dot terminator is seen. Absent = buffer the whole payload into a Buffer.
   */
  consumer?: (chunk: Buffer) => void;
  streamed: number;
}

let CONNECTION_SEQ = 0;

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
  readonly providerId: string;
  private socket: net.Socket | tls.TLSSocket;
  private reader = new NntpResponseReader();
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

  private constructor(
    socket: net.Socket | tls.TLSSocket,
    providerId: string,
    private opts: ConnectionOptions
  ) {
    this.id = ++CONNECTION_SEQ;
    this.providerId = providerId;
    this.socket = socket;
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
    this.socket.on('data', (chunk: Buffer) => {
      // Any byte from the peer is progress, so push the rolling stall deadline out.
      this.armStallTimer();
      this.reader.push(chunk);
      this.tryResolve();
    });
    const fail = (err: Error) => {
      this.fatalError =
        err instanceof NntpError
          ? err
          : new NntpError('connection', err.message, {
              providerId: this.providerId,
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
            providerId: this.providerId,
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
    const socket = await new Promise<net.Socket | tls.TLSSocket>(
      (resolve, reject) => {
        const onError = (err: Error) =>
          reject(
            new NntpError('connection', `dial failed: ${err.message}`, {
              providerId: config.id,
              cause: err,
            })
          );
        let s: net.Socket | tls.TLSSocket;
        const timer = setTimeout(() => {
          s?.destroy();
          reject(
            new NntpError('timeout', 'dial timeout', { providerId: config.id })
          );
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
          });
          s.once('secureConnect', onConnect);
        } else {
          s = net.connect({ host: config.host, port: config.port });
          s.once('connect', onConnect);
        }
        s.once('error', onError);
      }
    );

    const conn = new NntpConnection(socket, config.id, opts);
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
          { providerId: config.id, host: config.host, code: status.code },
          'unexpected nntp greeting'
        );
      }
      throw new NntpError(
        limited ? 'connection_limit' : 'protocol',
        limited
          ? `connection limit at greeting: ${greeting}`
          : `unexpected greeting: ${greeting}`,
        { code: status.code, providerId: config.id }
      );
    }

    if (config.username) {
      await conn.authenticate(config.username, config.password ?? '');
    }

    conn.touch();
    logger.debug(
      {
        providerId: config.id,
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
        { code: userStatus.code, providerId: this.providerId }
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
          { providerId: this.providerId, code: passStatus.code },
          'nntp authentication rejected'
        );
      }
      throw new NntpError(
        limited ? 'connection_limit' : 'auth_failed',
        limited
          ? `connection limit reached: ${passResp}`
          : `auth pass rejected: ${passStatus.code}`,
        { code: passStatus.code, providerId: this.providerId }
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
          providerId: this.providerId,
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
        providerId: this.providerId,
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
        providerId: this.providerId,
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
            providerId: this.providerId,
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
            providerId: this.providerId,
          })
      );
    }
    if (signal?.aborted) {
      this.destroy();
      return Promise.reject(
        new NntpError('connection', 'aborted', { providerId: this.providerId })
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
        scanned: 0,
        consumer,
        streamed: 0,
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
      // Bytes for this response may already be buffered (pipelined ahead).
      this.tryResolve();
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
          providerId: this.providerId,
          connId: this.id,
          timeoutMs,
          inFlight: this.queue.length,
        },
        'nntp connection stalled; destroying'
      );
      this.fatalError = new NntpError(
        'timeout',
        `no response progress for ${timeoutMs}ms`,
        { providerId: this.providerId }
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

  /**
   * Drive the FIFO state machine over buffered bytes, completing as many queued
   * requests as the buffer allows. Re-entrancy (a `resolve` synchronously
   * submitting another command) is guarded so the reader is never re-driven
   * mid-pass.
   */
  private processing = false;
  private tryResolve(): void {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const head = this.queue[0];
        if (head.stage === 'status') {
          const line = this.reader.takeLine();
          if (line === null) return; // need more bytes
          const status = parseStatusLine(line);
          if (status.code === 0) {
            // Garbage where a status line was expected: pipeline desync. Mark the
            // connection unsafe to reuse and fail everything in flight.
            this.pipeliningUnsafe = true;
            this.fatalError = new NntpError(
              'protocol',
              `protocol desync: ${line}`,
              { providerId: this.providerId }
            );
            this.destroy();
            return;
          }
          if (head.kind === 'line') {
            this.finishHead(() => head.resolve(line));
            continue;
          }
          // body request: 2xx → read the payload; ≥4xx (e.g. 430) → reject ONLY
          // this request with no body to consume; the connection stays healthy.
          if (statusClass(status.code) >= 4) {
            const err = new NntpError(
              classifyNntpStatus(status.code),
              `command failed: ${status.code} ${status.message}`,
              { code: status.code, providerId: this.providerId }
            );
            this.finishHead(() => head.reject(err));
            continue;
          }
          head.stage = 'payload';
          head.scanned = 0;
          continue;
        }
        // payload stage
        if (head.consumer) {
          const consumer = head.consumer;
          const done = this.reader.takeMultilineStreaming((chunk) => {
            head.streamed += chunk.length;
            consumer(chunk);
          });
          if (!done) return;
          this.finishHead(() => head.resolve(head.streamed));
          continue;
        }
        const result = this.reader.takeMultiline(head.scanned);
        if (result === null) {
          head.scanned = this.reader.scanWatermark();
          return;
        }
        this.finishHead(() => head.resolve(result.body));
      }
    } finally {
      this.processing = false;
    }
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
