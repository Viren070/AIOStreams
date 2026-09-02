import type { Readable } from 'node:stream';
import type {
  StreamEndReason,
  StreamTransport,
} from '../db/repositories/stream-sessions.js';

export type { StreamTransport, StreamEndReason };

/** Why a stream was not admitted. Maps to the transport's refusal response. */
export type AdmissionRefusal =
  | 'banned'
  | 'blocked'
  | 'connection_user'
  | 'connection_global'
  | 'bandwidth_user'
  | 'bandwidth_global';

export interface AdmissionVerdict {
  ok: boolean;
  reason?: AdmissionRefusal;
  /** Human-readable detail for the log line / error body. */
  message?: string;
}

/** What a caller must supply to open (or join) a session. */
export interface StreamOpenInput {
  transport: StreamTransport;
  /** Empty when the caller could not be identified; exempt from limits. */
  username: string;
  /**
   * Opened through the operator's own share tree (FUSE/NFS/WebDAV). Exempt
   * from connection caps: those exist to stop one user hogging providers, and
   * a media-server scan or season-pack import legitimately opens many files
   * at once. Bans and bandwidth caps still apply.
   */
  share?: boolean;
  clientIp?: string;
  /** Stable identity of what is being streamed; also the block/ban subject. */
  targetKey: string;
  filename?: string;
  /** Log-safe URL for display. Never the raw upstream URL. */
  displayUrl?: string;
  /** Total size of the target in bytes; 0 when unknown at open time. */
  size?: number;
  /** Byte offset this particular read starts at. */
  start?: number;
}

/**
 * A single read within a session (one HTTP Range request). Closing it does not
 * end the session, which lives on until it idles out or is stopped.
 */
export interface StreamHandle {
  readonly sessionId: string;
  /** Report bytes pushed to the client. */
  addBytes(bytes: number): void;
  /** Fill in details only known after the upstream responded. */
  setInfo(info: { size?: number; filename?: string; start?: number }): void;
  /** Register a readable to destroy when the session is killed. */
  attach(stream: Readable): void;
  /** Register arbitrary teardown to run when the session is killed. */
  onKill(fn: () => void): void;
  /** Mark this read finished. */
  close(): void;
}

export type StreamOpenResult =
  | { ok: true; handle: StreamHandle }
  | { ok: false; verdict: AdmissionVerdict };

/**
 * What a session is doing. `paused` and `idle` both mean no bytes are moving,
 * split by whether the client still holds its request open.
 */
export type StreamActivity = 'streaming' | 'paused' | 'idle';

/** A live session as surfaced to the dashboard. */
export interface LiveStreamSession {
  id: string;
  transport: StreamTransport;
  username: string;
  clientIp?: string;
  targetKey: string;
  filename?: string;
  displayUrl?: string;
  size: number;
  bytesServed: number;
  requests: number;
  startedAt: number;
  lastSeenAt: number;
  /** Open reads right now. A paused player still holds one. */
  activeReads: number;
  /** Whether bytes are actually moving, and if not, why. */
  activity: StreamActivity;
  /** Time since the last byte was pushed to the client. */
  idleMs: number;
  /** Byte offset of the newest read, for the progress bar. */
  start: number;
  /** Bytes served by the newest read. */
  currentBytes: number;
  /** Smoothed rate across the session's reads, bytes/second. */
  bytesPerSec: number;
  /** Which replica owns the live reader. */
  instanceId: string;
}
