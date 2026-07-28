import { getDb } from '../db.js';
import { sql } from '../sql.js';

export const TORRENTCLAW_NZB_MONTHLY_LIMIT_BYTES = 200 * 1024 ** 3;

function period(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** Atomically reserve a whole selected file before minting a playback URL. */
export async function reserveTorrentClawNzbBytes(
  bytes: number,
  now = Date.now(),
  limit = TORRENTCLAW_NZB_MONTHLY_LIMIT_BYTES
): Promise<{ period: string; reservedBytes: number; limitBytes: number }> {
  const amount = Math.max(0, Math.floor(bytes));
  const key = period(now);
  const db = getDb();
  const result = await db.tx(async (tx) => {
    const existing = await tx.maybeOne<{ reserved_bytes: number | string }>(
      sql`SELECT reserved_bytes FROM torrentclaw_nzb_quota WHERE period = ${key}`
    );
    const used = Number(existing?.reserved_bytes ?? 0);
    if (used + amount > limit) return undefined;
    await tx.exec(
      sql`INSERT INTO torrentclaw_nzb_quota (period, reserved_bytes, updated_at_ms)
          VALUES (${key}, ${amount}, ${now})
          ON CONFLICT(period) DO UPDATE SET reserved_bytes = torrentclaw_nzb_quota.reserved_bytes + ${amount}, updated_at_ms = ${now}`
    );
    return used + amount;
  });
  if (result === undefined) {
    throw new Error('TorrentClaw monthly NZB quota exceeded (200 GB)');
  }
  return { period: key, reservedBytes: result, limitBytes: limit };
}
