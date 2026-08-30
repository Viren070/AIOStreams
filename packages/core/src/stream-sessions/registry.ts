import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  StreamSessionRepository,
  type StreamBandwidthDelta,
  type StreamSessionUpsert,
} from '../db/repositories/stream-sessions.js';
import { appConfig } from '../utils/index.js';
import { createLogger } from '../logging/logger.js';
import { findStreamBan, refreshStreamBans } from './bans.js';
import {
  bandwidthSnapshot,
  globalBandwidthLimit,
  refreshBandwidthUsage,
  userBandwidthLimit,
} from './bandwidth.js';
import { checkAdmission } from './limits.js';
import { recordedClientIp } from './client-ip.js';
import { instanceId } from './instance-id.js';
import type {
  LiveStreamSession,
  StreamEndReason,
  StreamHandle,
  StreamOpenInput,
  StreamOpenResult,
  StreamTransport,
} from './types.js';

const logger = createLogger('streams');

/**
 * Window in which a new read rejoins the previous session without an admission
 * check. Longer than any seek, far shorter than a real pause, so it cannot be
 * used to dodge a limit.
 */
const REJOIN_GRACE_MS = 10_000;

/** Time constant for the per-session rate EMA. */
const RATE_TAU_MS = 3_000;

/**
 * Silence after which a session stops reading as "streaming". Display only; it
 * does not affect limits or when a watch ends.
 */
const ACTIVITY_WINDOW_MS = 5_000;

/**
 * Age at which an active row is assumed to have no live owner. Generous: a
 * paused stream stays quiet until the engine reaps its reader an hour in, and
 * a live owner rewrites its rows every flush.
 */
export const STALE_SESSION_MS = 24 * 60 * 60_000;

/**
 * How long a session may hold an open read without serving a byte before its
 * reader is assumed dead: a viewer that vanishes without a FIN leaves a socket
 * nothing will ever close. Far longer than any real pause.
 */
const STUCK_READ_MS = 6 * 60 * 60_000;

/**
 * How often the caches admission reads are refreshed while nothing is
 * streaming. The flush itself runs far more often to keep live sessions
 * current, which with none of them is pure query load.
 */
const IDLE_REFRESH_MS = 60_000;

/** Raised on a reader whose session was force-stopped. */
export class StreamStoppedError extends Error {
  readonly code = 'STREAM_STOPPED';
  constructor(readonly reason: StreamEndReason) {
    super(`stream stopped (${reason})`);
  }
}

interface LiveRead {
  id: number;
  start: number;
  bytes: number;
  stream?: Readable;
  kill?: () => void;
}

interface Session {
  id: string;
  transport: StreamTransport;
  username: string;
  clientIp?: string;
  targetKey: string;
  filename?: string;
  displayUrl?: string;
  size: number;
  bytesServed: number;
  /** Bytes not yet folded into the hourly rollup. */
  pendingBytes: number;
  requests: number;
  startedAt: number;
  lastSeenAt: number;
  reads: Map<number, LiveRead>;
  /** Read the progress bar tracks; players hold one at a time. */
  newestReadId: number;
  emaBytesPerSec: number;
  /** Bytes seen since the rate last advanced. */
  unratedBytes: number;
  lastChunkAt: number;
  /** Needs writing on the next flush. */
  dirty: boolean;
  ended?: { at: number; reason: StreamEndReason };
}

/**
 * What makes two reads the same watch. JSON-encoded, not concatenated: the
 * parts are user-controlled, so a plain separator could be forged to collide
 * with another user's session.
 */
function identityKey(
  username: string,
  clientIp: string | undefined,
  targetKey: string
): string {
  return JSON.stringify([username, clientIp ?? '', targetKey]);
}

function idleTimeoutMs(): number {
  return Math.max(1, appConfig.streams.sessionIdleTimeout) * 1000;
}

/**
 * Process-local registry of in-flight streams, shared by every transport. It
 * is the source of truth for what is live; `stream_sessions` is its durable
 * mirror, written by {@link StreamRegistry.flush} rather than per request.
 *
 * A row is one watch, not one HTTP request: reads sharing
 * `username | ip | target` join one session. See `sweep` for where a watch ends.
 */
export class StreamRegistry {
  private byKey = new Map<string, Session>();
  private byId = new Map<string, Session>();
  /** Ended sessions still to be written out. */
  private finalised: Session[] = [];
  private readSeq = 0;
  private lastRefreshAt = 0;

  readonly instanceId = instanceId();

  /**
   * Start (or join) a session. Admission runs only on create, or on resume
   * after {@link REJOIN_GRACE_MS}, so seeking is never refused.
   *
   * Check and insert must stay synchronous: an `await` between them would let
   * two concurrent opens pass the same limit.
   */
  open(input: StreamOpenInput, now = Date.now()): StreamOpenResult {
    const key = identityKey(input.username, input.clientIp, input.targetKey);
    const existing = this.byKey.get(key);

    if (existing) {
      const resuming =
        existing.reads.size === 0 &&
        now - existing.lastSeenAt > REJOIN_GRACE_MS;
      if (resuming) {
        const verdict = this.admit(input, now);
        if (!verdict.ok) {
          this.finalise(
            existing,
            verdict.reason === 'banned' || verdict.reason === 'blocked'
              ? 'banned'
              : 'limit',
            now
          );
          return { ok: false, verdict };
        }
      }
      return { ok: true, handle: this.addRead(existing, input, now) };
    }

    const verdict = this.admit(input, now);
    if (!verdict.ok) return { ok: false, verdict };

    const session: Session = {
      id: randomUUID(),
      transport: input.transport,
      username: input.username,
      clientIp: input.clientIp,
      targetKey: input.targetKey,
      filename: input.filename,
      displayUrl: input.displayUrl,
      size: input.size ?? 0,
      bytesServed: 0,
      pendingBytes: 0,
      requests: 0,
      startedAt: now,
      lastSeenAt: now,
      reads: new Map(),
      newestReadId: 0,
      emaBytesPerSec: 0,
      unratedBytes: 0,
      lastChunkAt: now,
      dirty: true,
    };
    this.byKey.set(key, session);
    this.byId.set(session.id, session);
    return { ok: true, handle: this.addRead(session, input, now) };
  }

  private admit(input: StreamOpenInput, now: number) {
    const usage = bandwidthSnapshot(now);
    let liveUser = 0;
    let liveGlobal = 0;
    let activeSessions = 0;
    let globalActiveSessions = 0;
    for (const s of this.byKey.values()) {
      liveGlobal += s.pendingBytes;
      // An idle session holds no connection slot; resuming it re-enters this
      // check anyway.
      if (s.reads.size > 0) globalActiveSessions++;
      if (s.username !== input.username) continue;
      liveUser += s.pendingBytes;
      if (s.reads.size > 0) activeSessions++;
    }
    return checkAdmission({
      username: input.username,
      targetKey: input.targetKey,
      activeSessions,
      globalActiveSessions,
      userBytes: (usage.byUser.get(input.username) ?? 0) + liveUser,
      globalBytes: usage.global + liveGlobal,
    });
  }

  private addRead(
    session: Session,
    input: StreamOpenInput,
    now: number
  ): StreamHandle {
    const read: LiveRead = {
      id: ++this.readSeq,
      start: Math.max(0, input.start ?? 0),
      bytes: 0,
    };
    session.reads.set(read.id, read);
    session.newestReadId = read.id;
    session.requests++;
    // A quiet stretch is a pause, not a slow transfer, so the rate resumes from
    // this read rather than averaging the gap in and reading near zero.
    if (now - session.lastChunkAt > ACTIVITY_WINDOW_MS) {
      session.lastChunkAt = now;
      session.unratedBytes = 0;
    }
    session.lastSeenAt = now;
    session.dirty = true;
    if (input.size && !session.size) session.size = input.size;
    if (input.filename && !session.filename) session.filename = input.filename;
    if (input.displayUrl && !session.displayUrl) {
      session.displayUrl = input.displayUrl;
    }

    let closed = false;
    return {
      sessionId: session.id,
      addBytes: (bytes: number) => {
        if (bytes <= 0) return;
        const at = Date.now();
        const dtMs = at - session.lastChunkAt;
        session.bytesServed += bytes;
        session.pendingBytes += bytes;
        session.lastSeenAt = at;
        session.dirty = true;
        read.bytes += bytes;
        session.unratedBytes += bytes;
        if (dtMs > 0) {
          const w = Math.exp(-dtMs / RATE_TAU_MS);
          session.emaBytesPerSec =
            session.emaBytesPerSec * w +
            (session.unratedBytes / dtMs) * 1000 * (1 - w);
          session.unratedBytes = 0;
          session.lastChunkAt = at;
        }
      },
      setInfo: (info) => {
        if (info.size && info.size > 0) session.size = info.size;
        if (info.filename) session.filename = info.filename;
        if (info.start !== undefined) read.start = Math.max(0, info.start);
        session.dirty = true;
      },
      attach: (stream: Readable) => {
        read.stream = stream;
      },
      onKill: (fn: () => void) => {
        read.kill = fn;
      },
      close: () => {
        if (closed) return;
        closed = true;
        session.reads.delete(read.id);
        session.lastSeenAt = Date.now();
        session.dirty = true;
      },
    };
  }

  /** Tear down a session's reads and move it to history. */
  private finalise(
    session: Session,
    reason: StreamEndReason,
    now = Date.now()
  ): void {
    if (session.ended) return;
    session.ended = { at: now, reason };
    session.dirty = true;
    for (const read of session.reads.values()) {
      try {
        read.kill?.();
      } catch {
        /* teardown is best-effort */
      }
      if (read.stream && !read.stream.destroyed) {
        read.stream.destroy(new StreamStoppedError(reason));
      }
    }
    session.reads.clear();
    this.byKey.delete(
      identityKey(session.username, session.clientIp, session.targetKey)
    );
    this.byId.delete(session.id);
    this.finalised.push(session);
  }

  /** Force-stop one session. Returns whether it was live here. */
  kill(id: string, reason: StreamEndReason = 'stopped'): boolean {
    const session = this.byId.get(id);
    if (!session) return false;
    logger.info(
      { id, username: session.username, transport: session.transport, reason },
      'stream stopped'
    );
    this.finalise(session, reason);
    return true;
  }

  /**
   * Force-stop a user's sessions, optionally narrowed to a single target.
   * Returns how many died.
   */
  killUser(
    username: string,
    reason: StreamEndReason = 'stopped',
    targetKey?: string
  ): number {
    const victims = [...this.byId.values()].filter(
      (s) =>
        s.username === username &&
        (targetKey === undefined || s.targetKey === targetKey)
    );
    for (const s of victims) this.finalise(s, reason);
    if (victims.length > 0) {
      logger.info(
        { username, count: victims.length, reason },
        'stopped all streams for user'
      );
    }
    return victims.length;
  }

  /** Sessions this process is serving, newest first. */
  snapshot(now = Date.now()): LiveStreamSession[] {
    const out: LiveStreamSession[] = [];
    for (const s of this.byKey.values()) {
      const newest = s.reads.get(s.newestReadId);
      // Decay toward zero so a paused stream doesn't show its last burst.
      const idle = Math.max(0, now - s.lastChunkAt);
      // A paused player keeps its request open, so byte movement is the
      // signal, not whether a read exists.
      const activity =
        idle < ACTIVITY_WINDOW_MS
          ? 'streaming'
          : s.reads.size > 0
            ? 'paused'
            : 'idle';
      out.push({
        id: s.id,
        transport: s.transport,
        username: s.username,
        clientIp: recordedClientIp(s.clientIp),
        targetKey: s.targetKey,
        filename: s.filename,
        displayUrl: s.displayUrl,
        size: s.size,
        bytesServed: s.bytesServed,
        requests: s.requests,
        startedAt: s.startedAt,
        lastSeenAt: s.lastSeenAt,
        activeReads: s.reads.size,
        activity,
        idleMs: idle,
        start: newest?.start ?? 0,
        currentBytes: newest?.bytes ?? 0,
        bytesPerSec:
          activity === 'streaming'
            ? Math.round(s.emaBytesPerSec * Math.exp(-idle / RATE_TAU_MS))
            : 0,
        instanceId: this.instanceId,
      });
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Live sessions currently serving bytes for a user. */
  activeCount(username: string): number {
    let n = 0;
    for (const s of this.byKey.values()) {
      if (s.username === username && s.reads.size > 0) n++;
    }
    return n;
  }

  /**
   * Finish sessions quiet for longer than the idle timeout. One with an open
   * read is normally just buffered, so it gets {@link STUCK_READ_MS} instead.
   */
  sweep(now = Date.now()): number {
    let ended = 0;
    for (const session of [...this.byKey.values()]) {
      const open = session.reads.size > 0;
      const cutoff = open ? STUCK_READ_MS : idleTimeoutMs();
      if (now - session.lastSeenAt > cutoff) {
        this.finalise(session, open ? 'stale' : 'idle', now);
        ended++;
      }
    }
    return ended;
  }

  /**
   * Persist state, refresh the caches admission reads, then apply what needs
   * the fresh numbers: bandwidth caps and cross-replica stops. Bytes are
   * written before usage is re-read, so in-flight totals restart at zero.
   */
  async flush(now = Date.now()): Promise<{ written: number; ended: number }> {
    const ended = this.sweep(now);

    const upserts: StreamSessionUpsert[] = [];
    const bandwidth = new Map<string, StreamBandwidthDelta>();
    // What this pass takes out of the live state, so a failed write can put
    // it back.
    const claimedBytes: Array<[Session, number]> = [];
    const claimedDirty: Session[] = [];
    const collect = (s: Session) => {
      if (s.pendingBytes > 0) {
        const key = JSON.stringify([s.username, s.transport]);
        const delta = bandwidth.get(key) ?? {
          username: s.username,
          transport: s.transport,
          bytes: 0,
          atMs: now,
        };
        delta.bytes += s.pendingBytes;
        bandwidth.set(key, delta);
        claimedBytes.push([s, s.pendingBytes]);
        s.pendingBytes = 0;
      }
      // Live rows are rewritten every flush, not just dirty ones: the row is
      // how another replica knows the session still has an owner.
      if (!s.dirty && s.ended !== undefined) return;
      s.dirty = false;
      claimedDirty.push(s);
      upserts.push({
        id: s.id,
        transport: s.transport,
        username: s.username,
        clientIp: recordedClientIp(s.clientIp),
        targetKey: s.targetKey,
        filename: s.filename,
        displayUrl: s.displayUrl,
        size: s.size,
        bytesServed: s.bytesServed,
        requests: s.requests,
        startedAt: s.startedAt,
        // Doubles as a heartbeat while live, separating a quiet-but-owned
        // session from an abandoned one. Ended rows keep the real activity
        // time for history.
        lastSeenAt: s.ended ? s.lastSeenAt : now,
        endedAt: s.ended?.at,
        endReason: s.ended?.reason,
        instanceId: this.instanceId,
      });
    };

    for (const s of this.byKey.values()) collect(s);
    const closing = this.finalised;
    this.finalised = [];
    for (const s of closing) collect(s);

    let bandwidthWritten = false;
    let written = upserts.length;
    try {
      await StreamSessionRepository.addBandwidth([...bandwidth.values()]);
      bandwidthWritten = true;
      await StreamSessionRepository.upsertMany(upserts);
    } catch (err) {
      // The bytes are what the caps measure, and a finished session with no
      // `endedAt` leaves an active row nothing will ever close.
      if (!bandwidthWritten) {
        for (const [s, bytes] of claimedBytes) s.pendingBytes += bytes;
      }
      for (const s of claimedDirty) s.dirty = true;
      this.finalised = closing.concat(this.finalised);
      written = 0;
      logger.warn(
        { err, sessions: upserts.length },
        'failed to persist stream sessions; retrying on the next flush'
      );
    }

    const idle = this.byKey.size === 0 && upserts.length === 0;
    if (idle && now - this.lastRefreshAt < IDLE_REFRESH_MS) {
      return { written, ended };
    }
    this.lastRefreshAt = now;

    await Promise.all([refreshStreamBans(), refreshBandwidthUsage(now)]);
    this.enforceBans();
    this.enforceBandwidth(now);
    await this.applyRemoteStops();

    return { written, ended };
  }

  /** Kill anything belonging to a user who has since been banned or blocked. */
  private enforceBans(): void {
    for (const s of [...this.byKey.values()]) {
      if (s.username && findStreamBan(s.username, s.targetKey)) {
        this.finalise(s, 'banned');
      }
    }
  }

  /**
   * A cap that only refused new streams could be blown by one long-running
   * stream, so a breach also stops what is already running.
   */
  private enforceBandwidth(now: number): void {
    const usage = bandwidthSnapshot(now);
    const globalLimit = globalBandwidthLimit();
    if (globalLimit > 0 && usage.global >= globalLimit) {
      const live = [...this.byKey.values()];
      if (live.length > 0) {
        logger.warn(
          { used: usage.global, limit: globalLimit, streams: live.length },
          'global bandwidth limit reached; stopping active streams'
        );
        for (const s of live) this.finalise(s, 'limit', now);
      }
      return;
    }
    const seen = new Set<string>();
    for (const s of [...this.byKey.values()]) {
      if (!s.username || seen.has(s.username)) continue;
      seen.add(s.username);
      const limit = userBandwidthLimit(s.username);
      const used = usage.byUser.get(s.username) ?? 0;
      if (limit > 0 && used >= limit) {
        logger.warn(
          { username: s.username, used, limit },
          'user bandwidth limit reached; stopping their active streams'
        );
        this.killUser(s.username, 'limit');
      }
    }
  }

  /** Honour stop requests raised on another replica. */
  private async applyRemoteStops(): Promise<void> {
    if (this.byId.size === 0) return;
    try {
      for (const id of await StreamSessionRepository.pendingStops(
        this.instanceId
      )) {
        this.kill(id, 'stopped');
      }
    } catch (err) {
      logger.debug({ err }, 'failed to read pending stream stops');
    }
  }

  /**
   * Close out rows left by a dead process: this replica's own, matched on its
   * persisted id, plus any untouched for {@link STALE_SESSION_MS}. Without it
   * phantom active rows survive every restart and can never be stopped, since
   * no live process owns them.
   */
  async recoverOrphans(now = Date.now()): Promise<number> {
    const [mine, stale] = await Promise.all([
      StreamSessionRepository.endOrphans(this.instanceId, now),
      StreamSessionRepository.endStale(now - STALE_SESSION_MS, now),
    ]);
    if (mine + stale > 0) {
      logger.info(
        { reclaimed: mine, stale },
        'closed out stream sessions left by a previous run'
      );
    }
    return mine + stale;
  }

  /** Stop everything (process shutdown). */
  closeAll(reason: StreamEndReason = 'stale'): void {
    for (const s of [...this.byId.values()]) this.finalise(s, reason);
  }
}

export const streamRegistry = new StreamRegistry();
