import { createHash, randomBytes } from 'crypto';
import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import { decryptString, encryptString } from '../../utils/crypto.js';
import { APIError, constants } from '../../utils/index.js';
import { getDb } from '../db.js';
import type { DbDriver } from '../driver/types.js';
import { sql } from '../sql.js';

const logger = createLogger('database');

const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface ConfigSessionCredentials {
  uuid: string;
  password: string;
  renewedUntil?: number;
}

export interface IssuedConfigSession {
  token: string;
  expiresAt: number;
  remembered: boolean;
}

interface ConfigSessionRow {
  uuid: string;
  encrypted_password: string;
  password_hash: string;
  current_hash: string;
  remembered: number | string;
  created_at: number | string;
  last_used_at: number | string | null;
  expires_at: number | string;
  [k: string]: unknown;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function ttlMs(): { sliding: number; max: number; unremembered: number } {
  return {
    sliding: appConfig.api.configSessionTtlSeconds * 1000,
    max: appConfig.api.configSessionMaxTtlSeconds * 1000,
    unremembered: appConfig.api.sessionTtlSeconds * 1000,
  };
}

// The cap is never extended by use, so a copied cookie still dies on a known date.
function nextExpiry(createdAt: number, now: number): number {
  const { sliding, max } = ttlMs();
  return Math.min(now + sliding, createdAt + max);
}

export class ConfigSessionRepository {
  static enabled(): boolean {
    return appConfig.api.configSessionsEnabled !== false;
  }

  /** The caller must verify the password first; this does not. */
  static async create(
    uuid: string,
    password: string,
    remembered: boolean
  ): Promise<IssuedConfigSession> {
    const db = getDb();
    const row = await db.maybeOne<{ password_hash: string }>(
      sql`SELECT password_hash FROM users WHERE uuid = ${uuid}`
    );
    if (!row) {
      throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
    }

    const { success, data: encryptedPassword } = encryptString(password);
    if (!success || !encryptedPassword) {
      throw new APIError(constants.ErrorCode.ENCRYPTION_ERROR);
    }

    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const { unremembered } = ttlMs();
    const expiresAt = remembered ? nextExpiry(now, now) : now + unremembered;

    await db.exec(
      sql`INSERT INTO config_sessions
            (id, uuid, encrypted_password, password_hash, remembered,
             created_at, last_used_at, expires_at)
          VALUES (${hashToken(token)}, ${uuid}, ${encryptedPassword},
                  ${row.password_hash}, ${remembered ? 1 : 0},
                  ${now}, ${now}, ${expiresAt})`
    );

    logger.debug({ uuid, remembered }, 'Issued config session');
    return { token, expiresAt, remembered };
  }

  static async resolve(
    token: string
  ): Promise<ConfigSessionCredentials | null> {
    const id = hashToken(token);
    const db = getDb();
    const row = await db.maybeOne<ConfigSessionRow>(
      sql`SELECT s.uuid, s.encrypted_password, s.password_hash, s.remembered,
                 s.created_at, s.last_used_at, s.expires_at,
                 u.password_hash AS current_hash
            FROM config_sessions s
            JOIN users u ON u.uuid = s.uuid
           WHERE s.id = ${id}`
    );
    if (!row) return null;

    const now = Date.now();
    const drop = async () => {
      await db.exec(sql`DELETE FROM config_sessions WHERE id = ${id}`);
      return null;
    };

    if (Number(row.expires_at) <= now) return drop();
    if (row.password_hash !== row.current_hash) return drop();

    const { success, data: password } = decryptString(row.encrypted_password);
    if (!success || !password) return drop();

    const remembered = Boolean(Number(row.remembered));
    const lastUsed = row.last_used_at == null ? 0 : Number(row.last_used_at);
    let renewedUntil: number | undefined;
    if (now - lastUsed > TOUCH_INTERVAL_MS) {
      const expiresAt = remembered
        ? nextExpiry(Number(row.created_at), now)
        : Number(row.expires_at);
      await db.exec(
        sql`UPDATE config_sessions
               SET last_used_at = ${now}, expires_at = ${expiresAt}
             WHERE id = ${id}`
      );
      // An unremembered cookie has no expiry to push out.
      if (remembered) renewedUntil = expiresAt;
    }

    return { uuid: row.uuid, password, renewedUntil };
  }

  static async deleteByToken(token: string): Promise<void> {
    await getDb().exec(
      sql`DELETE FROM config_sessions WHERE id = ${hashToken(token)}`
    );
  }

  static async deleteAllForUuid(
    uuid: string,
    executor?: DbDriver
  ): Promise<number> {
    const res = await (executor ?? getDb()).exec(
      sql`DELETE FROM config_sessions WHERE uuid = ${uuid}`
    );
    return res.rowCount ?? 0;
  }

  static async prune(): Promise<number> {
    const res = await getDb().exec(
      sql`DELETE FROM config_sessions WHERE expires_at < ${Date.now()}`
    );
    return res.rowCount ?? 0;
  }
}
