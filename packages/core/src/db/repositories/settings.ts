import { getDb } from '../db.js';
import { sql } from '../sql.js';

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string | Date;
  updated_by: string | null;
  [k: string]: unknown;
}

export class SettingsRepository {
  static async getAll(): Promise<SettingRow[]> {
    return getDb().query<SettingRow>(
      sql`SELECT key, value, updated_at, updated_by FROM settings`
    );
  }

  static async getVersion(): Promise<number> {
    const row = await getDb().maybeOne<{ version: number | string }>(
      sql`SELECT version FROM settings_version WHERE id = ${1}`
    );
    return Number(row?.version ?? 0);
  }

  static async set(
    key: string,
    value: unknown,
    updatedBy?: string
  ): Promise<void> {
    const encoded = JSON.stringify(value);
    const db = getDb();
    await db.tx(async (tx) => {
      if (tx.dialect === 'postgres') {
        await tx.exec(
          sql`INSERT INTO settings (key, value, updated_at, updated_by)
              VALUES (${key}, ${encoded}, CURRENT_TIMESTAMP, ${updatedBy ?? null})
              ON CONFLICT(key) DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = EXCLUDED.updated_by`
        );
      } else {
        await tx.exec(
          sql`INSERT INTO settings (key, value, updated_at, updated_by)
              VALUES (${key}, ${encoded}, CURRENT_TIMESTAMP, ${updatedBy ?? null})
              ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = excluded.updated_by`
        );
      }
      await tx.exec(
        sql`UPDATE settings_version SET version = version + 1 WHERE id = ${1}`
      );
    });
  }

  static async delete(key: string): Promise<void> {
    const db = getDb();
    await db.tx(async (tx) => {
      await tx.exec(sql`DELETE FROM settings WHERE key = ${key}`);
      await tx.exec(
        sql`UPDATE settings_version SET version = version + 1 WHERE id = ${1}`
      );
    });
  }
}
