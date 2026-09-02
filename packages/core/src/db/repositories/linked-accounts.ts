import { getDb } from '../db.js';
import type { DbDriver } from '../driver/types.js';
import { raw, sql } from '../sql.js';
import {
  decryptString,
  encryptString,
  generateUUID,
} from '../../utils/crypto.js';
import { APIError, ErrorCode } from '../../utils/constants.js';
import { createLogger } from '../../logging/logger.js';
import type {
  LinkedAccount,
  LinkedAccountConfig,
  LinkedAccountPlatformId,
  LinkedAccountStatus,
  ResolvedLinkedAccount,
} from '../../linked-accounts/types.js';

const logger = createLogger('linked-accounts');

export const MAX_LINKED_ACCOUNTS_PER_USER = 10;

const COLUMNS =
  'id, uuid, platform, label, identity, config, auto_push, last_synced_at, last_status, last_error, last_pushed_manifest_hash, created_at, updated_at';

interface LinkedAccountRow {
  id: string;
  uuid: string;
  platform: string;
  label: string;
  identity: string | null;
  credentials?: string;
  config: string;
  auto_push: number | string;
  last_synced_at: number | string | null;
  last_status: string | null;
  last_error: string | null;
  last_pushed_manifest_hash: string | null;
  created_at: number | string;
  updated_at: number | string;
  [k: string]: unknown;
}

function parseConfig(value: string): LinkedAccountConfig {
  try {
    const parsed = JSON.parse(value);
    return {
      instanceUrl: parsed.instanceUrl,
      mintedSession: parsed.mintedSession === true,
      manifestUrls: Array.isArray(parsed.manifestUrls)
        ? parsed.manifestUrls
        : [],
    };
  } catch {
    return { manifestUrls: [] };
  }
}

function toAccount(row: LinkedAccountRow): LinkedAccount {
  return {
    id: row.id,
    uuid: row.uuid,
    platform: row.platform as LinkedAccountPlatformId,
    label: row.label,
    identity: row.identity,
    config: parseConfig(row.config),
    autoPush: Number(row.auto_push) === 1,
    lastSyncedAt:
      row.last_synced_at == null ? undefined : Number(row.last_synced_at),
    lastStatus: (row.last_status as LinkedAccountStatus) ?? undefined,
    lastError: row.last_error ?? undefined,
    lastPushedManifestHash: row.last_pushed_manifest_hash ?? undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class LinkedAccountRepository {
  static async list(uuid: string): Promise<LinkedAccount[]> {
    const rows = await getDb().query<LinkedAccountRow>(
      sql`SELECT ${raw(COLUMNS)} FROM linked_accounts
           WHERE uuid = ${uuid}
           ORDER BY created_at ASC`
    );
    return rows.map(toAccount);
  }

  static async get(uuid: string, id: string): Promise<LinkedAccount | null> {
    const row = await getDb().maybeOne<LinkedAccountRow>(
      sql`SELECT ${raw(COLUMNS)} FROM linked_accounts
           WHERE uuid = ${uuid} AND id = ${id}`
    );
    return row ? toAccount(row) : null;
  }

  /** Only the push path needs this; the result must never reach a client. */
  static async resolve(
    uuid: string,
    id: string
  ): Promise<ResolvedLinkedAccount | null> {
    const row = await getDb().maybeOne<LinkedAccountRow>(
      sql`SELECT ${raw(COLUMNS)}, credentials FROM linked_accounts
           WHERE uuid = ${uuid} AND id = ${id}`
    );
    if (!row) return null;

    const decrypted = decryptString(row.credentials!);
    if (!decrypted.success) {
      throw new APIError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        500,
        'The stored credentials for this linked account could not be read. Unlink it and link it again.'
      );
    }
    return { ...toAccount(row), credentials: JSON.parse(decrypted.data) };
  }

  static async countForUser(uuid: string): Promise<number> {
    return getDb().count(
      sql`SELECT COUNT(*) FROM linked_accounts WHERE uuid = ${uuid}`
    );
  }

  static async create(input: {
    uuid: string;
    platform: LinkedAccountPlatformId;
    label: string;
    identity: string;
    credentials: Record<string, string>;
    config: LinkedAccountConfig;
  }): Promise<LinkedAccount> {
    const encrypted = encryptString(JSON.stringify(input.credentials));
    if (!encrypted.success) {
      throw new APIError(ErrorCode.ENCRYPTION_ERROR);
    }

    const id = generateUUID();
    const now = Date.now();
    await getDb().exec(
      sql`INSERT INTO linked_accounts
            (id, uuid, platform, label, identity, credentials, config,
             auto_push, created_at, updated_at)
          VALUES
            (${id}, ${input.uuid}, ${input.platform}, ${input.label},
             ${input.identity}, ${encrypted.data},
             ${JSON.stringify(input.config)}, 1, ${now}, ${now})`
    );
    logger.info(
      { platform: input.platform, uuid: input.uuid },
      'linked a new account'
    );

    const created = await this.get(input.uuid, id);
    if (!created) throw new APIError(ErrorCode.DATABASE_ERROR);
    return created;
  }

  static async update(
    uuid: string,
    id: string,
    patch: {
      label?: string;
      autoPush?: boolean;
      config?: LinkedAccountConfig;
      credentials?: Record<string, string>;
    }
  ): Promise<LinkedAccount | null> {
    const sets = [sql`updated_at = ${Date.now()}`];
    if (patch.label !== undefined) sets.push(sql`label = ${patch.label}`);
    if (patch.autoPush !== undefined) {
      sets.push(sql`auto_push = ${patch.autoPush ? 1 : 0}`);
    }
    if (patch.config !== undefined) {
      sets.push(sql`config = ${JSON.stringify(patch.config)}`);
    }
    if (patch.credentials !== undefined) {
      const encrypted = encryptString(JSON.stringify(patch.credentials));
      if (!encrypted.success) throw new APIError(ErrorCode.ENCRYPTION_ERROR);
      sets.push(sql`credentials = ${encrypted.data}`);
    }

    let assignments = sets[0];
    for (const fragment of sets.slice(1)) {
      assignments = sql`${assignments}, ${fragment}`;
    }

    await getDb().exec(
      sql`UPDATE linked_accounts SET ${assignments}
           WHERE uuid = ${uuid} AND id = ${id}`
    );
    return this.get(uuid, id);
  }

  static async recordPush(
    uuid: string,
    id: string,
    result: {
      status: LinkedAccountStatus;
      error?: string;
      manifestHash?: string;
    }
  ): Promise<void> {
    // A failure leaves last_synced_at and the hash alone: both record the last
    // push that actually landed, which is what the card shows.
    const synced =
      result.status === 'ok'
        ? sql`, last_synced_at = ${Date.now()}, last_pushed_manifest_hash = ${result.manifestHash ?? null}`
        : sql``;
    await getDb().exec(
      sql`UPDATE linked_accounts
           SET last_status = ${result.status},
               last_error = ${result.error ?? null},
               updated_at = ${Date.now()}${synced}
           WHERE uuid = ${uuid} AND id = ${id}`
    );
  }

  /**
   * A password change mints a new encrypted-password token, which every stored
   * manifest URL carries. Rewriting them here keeps linked accounts working
   * instead of silently pushing a URL that no longer resolves. Takes the
   * caller's transaction so it commits with the password itself.
   */
  static async rewriteManifestUrlsForUuid(
    tx: DbDriver,
    uuid: string,
    encryptedPassword: string
  ): Promise<number> {
    const rows = await tx.query<LinkedAccountRow>(
      sql`SELECT id, config FROM linked_accounts WHERE uuid = ${uuid}`
    );
    let updated = 0;
    for (const row of rows) {
      const config = parseConfig(row.config);
      const urls = config.manifestUrls.map((url) =>
        url.replace(
          new RegExp(`(/stremio/${uuid}/)[^/]+`, 'i'),
          `$1${encryptedPassword}`
        )
      );
      if (urls.join('|') === config.manifestUrls.join('|')) continue;
      await tx.exec(
        sql`UPDATE linked_accounts
               SET config = ${JSON.stringify({ ...config, manifestUrls: urls })},
                   updated_at = ${Date.now()}
             WHERE id = ${row.id}`
      );
      updated++;
    }
    return updated;
  }

  static async remove(uuid: string, id: string): Promise<boolean> {
    if (!(await this.get(uuid, id))) return false;
    await getDb().exec(
      sql`DELETE FROM linked_accounts WHERE uuid = ${uuid} AND id = ${id}`
    );
    return true;
  }
}
