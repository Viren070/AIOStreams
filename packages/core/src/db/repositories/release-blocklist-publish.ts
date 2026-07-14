import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { sql, join, SqlFragment } from '../sql.js';
import type {
  PublishArtifactSpec,
  PublishTarget,
  PublishTargetState,
} from '../../release-blocklist/publish/types.js';

export const MIN_PUBLISH_INTERVAL_SECONDS = 900;
export const MAX_PUBLISH_INTERVAL_SECONDS = 30 * 24 * 3600;
export const DEFAULT_PUBLISH_INTERVAL_SECONDS = 21600;

export function clampPublishIntervalSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PUBLISH_INTERVAL_SECONDS;
  return Math.min(
    MAX_PUBLISH_INTERVAL_SECONDS,
    Math.max(MIN_PUBLISH_INTERVAL_SECONDS, Math.floor(value))
  );
}

type TargetRow = {
  id: string;
  provider: string;
  name: string;
  enabled: number | boolean;
  interval_seconds: number | string;
  config_enc: string;
  artifacts: string;
  state: string;
  last_pushed: number | string;
  last_checked: number | string;
  status: string | null;
  sort: number | string;
};

function num(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    const parsed = JSON.parse(text);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

function mapTarget(row: TargetRow): PublishTarget {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    enabled: row.enabled === true || row.enabled === 1,
    intervalSeconds: num(row.interval_seconds),
    configEnc: row.config_enc,
    artifacts: parseJson<PublishArtifactSpec[]>(row.artifacts, []),
    state: parseJson<PublishTargetState>(row.state, {}),
    lastPushed: num(row.last_pushed),
    lastChecked: num(row.last_checked),
    status: row.status,
    sort: num(row.sort),
  };
}

const TARGET_COLUMNS = sql`id, provider, name, enabled, interval_seconds, config_enc, artifacts, state, last_pushed, last_checked, status, sort`;

export class ReleaseBlocklistPublishRepository {
  static async getTargets(): Promise<PublishTarget[]> {
    const rows = await getDb().query<TargetRow>(
      sql`SELECT ${TARGET_COLUMNS} FROM release_blocklist_publish_targets
          ORDER BY sort, name`
    );
    return rows.map(mapTarget);
  }

  static async getTarget(id: string): Promise<PublishTarget | undefined> {
    const row = await getDb().maybeOne<TargetRow>(
      sql`SELECT ${TARGET_COLUMNS} FROM release_blocklist_publish_targets
          WHERE id = ${id}`
    );
    return row ? mapTarget(row) : undefined;
  }

  static async addTarget(input: {
    provider: string;
    name: string;
    configEnc: string;
    artifacts: PublishArtifactSpec[];
    intervalSeconds?: number;
    enabled?: boolean;
  }): Promise<PublishTarget> {
    const id = randomUUID();
    await getDb().exec(
      sql`INSERT INTO release_blocklist_publish_targets
            (id, provider, name, enabled, interval_seconds, config_enc, artifacts, state)
          VALUES (${id}, ${input.provider}, ${input.name},
                  ${input.enabled === false ? 0 : 1},
                  ${clampPublishIntervalSeconds(input.intervalSeconds ?? DEFAULT_PUBLISH_INTERVAL_SECONDS)},
                  ${input.configEnc}, ${JSON.stringify(input.artifacts)}, ${'{}'})`
    );
    const target = await this.getTarget(id);
    if (!target) throw new Error('publish target insert failed');
    return target;
  }

  static async updateTarget(
    id: string,
    fields: {
      name?: string;
      enabled?: boolean;
      intervalSeconds?: number;
      artifacts?: PublishArtifactSpec[];
      configEnc?: string;
      state?: PublishTargetState;
      status?: string | null;
    }
  ): Promise<void> {
    const sets: SqlFragment[] = [];
    if (fields.name !== undefined) sets.push(sql`name = ${fields.name}`);
    if (fields.enabled !== undefined) {
      sets.push(sql`enabled = ${fields.enabled ? 1 : 0}`);
    }
    if (fields.intervalSeconds !== undefined) {
      sets.push(
        sql`interval_seconds = ${clampPublishIntervalSeconds(fields.intervalSeconds)}`
      );
    }
    if (fields.artifacts !== undefined) {
      sets.push(sql`artifacts = ${JSON.stringify(fields.artifacts)}`);
    }
    if (fields.configEnc !== undefined) {
      sets.push(sql`config_enc = ${fields.configEnc}`);
    }
    if (fields.state !== undefined) {
      sets.push(sql`state = ${JSON.stringify(fields.state)}`);
    }
    if (fields.status !== undefined) sets.push(sql`status = ${fields.status}`);
    if (sets.length === 0) return;
    await getDb().exec(
      sql`UPDATE release_blocklist_publish_targets SET ${join(sets)}
          WHERE id = ${id}`
    );
  }

  static async removeTarget(id: string): Promise<void> {
    await getDb().exec(
      sql`DELETE FROM release_blocklist_publish_targets WHERE id = ${id}`
    );
  }

  static async setStatus(
    id: string,
    fields: {
      status?: string | null;
      lastChecked?: number;
      lastPushed?: number;
    }
  ): Promise<void> {
    const sets: SqlFragment[] = [];
    if (fields.status !== undefined) sets.push(sql`status = ${fields.status}`);
    if (fields.lastChecked !== undefined) {
      sets.push(sql`last_checked = ${fields.lastChecked}`);
    }
    if (fields.lastPushed !== undefined) {
      sets.push(sql`last_pushed = ${fields.lastPushed}`);
    }
    if (sets.length === 0) return;
    await getDb().exec(
      sql`UPDATE release_blocklist_publish_targets SET ${join(sets)}
          WHERE id = ${id}`
    );
  }

  static async setState(id: string, state: PublishTargetState): Promise<void> {
    await getDb().exec(
      sql`UPDATE release_blocklist_publish_targets
          SET state = ${JSON.stringify(state)} WHERE id = ${id}`
    );
  }

  static async getDue(now: number): Promise<PublishTarget[]> {
    const rows = await getDb().query<TargetRow>(
      sql`SELECT ${TARGET_COLUMNS} FROM release_blocklist_publish_targets
          WHERE enabled = 1 AND ${now} - last_checked >= interval_seconds
          ORDER BY sort, name`
    );
    return rows.map(mapTarget);
  }
}
