import { appConfig } from '../utils/index.js';
import {
  GLOBAL_LIMIT_KEY,
  PER_USER_LIMIT_KEY,
} from '../config/schema/streams.js';
import { findStreamBan } from './bans.js';
import { globalBandwidthLimit, userBandwidthLimit } from './bandwidth.js';
import type { AdmissionVerdict } from './types.js';

/**
 * Everything admission needs, passed in rather than looked up: this must stay
 * synchronous so check-and-reserve cannot interleave with a competing open.
 */
export interface AdmissionInput {
  /**
   * Empty for callers we cannot identify (a stream token minted before owners
   * were recorded). Those skip the bans and per-user caps, but still count
   * against the instance-wide pools.
   */
  username: string;
  targetKey: string;
  /** Opened through the operator's own share tree: no connection caps. */
  share?: boolean;
  /** Sessions already serving bytes for this user, across all transports. */
  activeSessions: number;
  /** Sessions already serving bytes for everyone, across all transports. */
  globalActiveSessions: number;
  /** Period-to-date bytes for this user, flushed plus in-flight. */
  userBytes: number;
  /** Period-to-date bytes for everyone, flushed plus in-flight. */
  globalBytes: number;
}

const OK: AdmissionVerdict = { ok: true };

/** The cap for a user; 0 means unlimited. */
export function connectionLimitFor(username: string): number {
  const limits = appConfig.streams.connectionLimits;
  const limit = limits[username] ?? limits[PER_USER_LIMIT_KEY] ?? 0;
  return limit > 0 ? limit : 0;
}

/** The shared concurrent-stream cap; 0 means unlimited. */
export function globalConnectionLimit(): number {
  const limit = appConfig.streams.connectionLimits[GLOBAL_LIMIT_KEY] ?? 0;
  return limit > 0 ? limit : 0;
}

/**
 * Decide whether a new stream may start. Applied only on create or on resume
 * after a pause, never on the reads of a session already under way.
 */
export function checkAdmission(input: AdmissionInput): AdmissionVerdict {
  const identified = Boolean(input.username);

  const ban = identified
    ? findStreamBan(input.username, input.targetKey)
    : undefined;
  if (ban) {
    const until = ban.expiresAt
      ? ` until ${new Date(ban.expiresAt).toISOString()}`
      : '';
    return ban.scope === 'user'
      ? {
          ok: false,
          reason: 'banned',
          message: `streaming is blocked for this user${until}`,
        }
      : {
          ok: false,
          reason: 'blocked',
          message: `this stream is blocked for this user${until}`,
        };
  }

  if (!input.share) {
    const connectionLimit = identified ? connectionLimitFor(input.username) : 0;
    if (connectionLimit > 0 && input.activeSessions >= connectionLimit) {
      return {
        ok: false,
        reason: 'connection_user',
        message: `connection limit reached (${connectionLimit})`,
      };
    }

    const globalConnections = globalConnectionLimit();
    if (
      globalConnections > 0 &&
      input.globalActiveSessions >= globalConnections
    ) {
      return {
        ok: false,
        reason: 'connection_global',
        message: `the instance connection limit has been reached (${globalConnections})`,
      };
    }
  }

  const userLimit = identified ? userBandwidthLimit(input.username) : 0;
  if (userLimit > 0 && input.userBytes >= userLimit) {
    return {
      ok: false,
      reason: 'bandwidth_user',
      message: 'bandwidth limit reached for this user',
    };
  }

  const globalLimit = globalBandwidthLimit();
  if (globalLimit > 0 && input.globalBytes >= globalLimit) {
    return {
      ok: false,
      reason: 'bandwidth_global',
      message: 'the instance bandwidth limit has been reached',
    };
  }

  return OK;
}
