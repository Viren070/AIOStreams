import { getDb } from '../db.js';
import { sql } from '../sql.js';

export const TORRENTCLAW_NZB_MONTHLY_LIMIT_BYTES = 200 * 1024 ** 3;

function period(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

function reservationAmount(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new Error('TorrentClaw NZB reservation bytes must be positive');
  }
  const amount = Math.floor(bytes);
  if (amount <= 0) {
    throw new Error('TorrentClaw NZB reservation bytes must be positive');
  }
  return amount;
}

export async function getTorrentClawNzbQuotaStatus(
  now = Date.now(),
  limit = TORRENTCLAW_NZB_MONTHLY_LIMIT_BYTES
): Promise<{
  period: string;
  reservedBytes: number;
  remainingBytes: number;
  limitBytes: number;
}> {
  const key = period(now);
  const existing = await getDb().maybeOne<{ reserved_bytes: number | string }>(
    sql`SELECT reserved_bytes FROM torrentclaw_nzb_quota WHERE period = ${key}`
  );
  const reservedBytes = Number(existing?.reserved_bytes ?? 0);
  return {
    period: key,
    reservedBytes,
    remainingBytes: Math.max(0, limit - reservedBytes),
    limitBytes: limit,
  };
}

/** Atomically reserve a whole selected file before minting a playback URL. */
export async function reserveTorrentClawNzbBytes(
  bytes: number,
  now = Date.now(),
  limit = TORRENTCLAW_NZB_MONTHLY_LIMIT_BYTES
): Promise<{ period: string; reservedBytes: number; limitBytes: number }> {
  const amount = reservationAmount(bytes);
  const key = period(now);
  const db = getDb();
  const result = await db.tx(async (tx) => {
    await tx.exec(
      sql`INSERT INTO torrentclaw_nzb_quota (period, reserved_bytes, updated_at_ms)
          VALUES (${key}, 0, ${now}) ON CONFLICT(period) DO NOTHING`
    );
    const update = await tx.exec(
      sql`UPDATE torrentclaw_nzb_quota
          SET reserved_bytes = reserved_bytes + ${amount}, updated_at_ms = ${now}
          WHERE period = ${key} AND reserved_bytes + ${amount} <= ${limit}`
    );
    if (update.rowCount === 0) return undefined;
    const aggregate = await tx.one<{ reserved_bytes: number | string }>(
      sql`SELECT reserved_bytes FROM torrentclaw_nzb_quota WHERE period = ${key}`
    );
    return Number(aggregate.reserved_bytes);
  });
  if (result === undefined) {
    throw new Error('TorrentClaw monthly NZB quota exceeded (200 GB)');
  }
  return { period: key, reservedBytes: result, limitBytes: limit };
}

/**
 * Reserve an NZB once per UTC month. Repeated playback attempts and failover
 * across Usenet services reuse the original reservation instead of charging it
 * again.
 */
export async function reserveTorrentClawNzbBytesOnce(
  reservationKey: string,
  bytes: number,
  now = Date.now(),
  limit = TORRENTCLAW_NZB_MONTHLY_LIMIT_BYTES
): Promise<{
  period: string;
  reservedBytes: number;
  limitBytes: number;
  alreadyReserved: boolean;
}> {
  const key = period(now);
  const stableKey = reservationKey.trim();
  if (!stableKey) {
    throw new Error('TorrentClaw NZB reservation key is required');
  }
  const amount = reservationAmount(bytes);
  const db = getDb();
  const result = await db.tx(async (tx) => {
    await tx.exec(
      sql`INSERT INTO torrentclaw_nzb_quota (period, reserved_bytes, updated_at_ms)
          VALUES (${key}, 0, ${now}) ON CONFLICT(period) DO NOTHING`
    );
    const claim = await tx.exec(
      sql`INSERT INTO torrentclaw_nzb_reservations
          (period, reservation_key, reserved_bytes, updated_at_ms)
          VALUES (${key}, ${stableKey}, ${amount}, ${now})
          ON CONFLICT(period, reservation_key) DO NOTHING`
    );
    if (claim.rowCount === 0) {
      const aggregate = await tx.one<{ reserved_bytes: number | string }>(
        sql`SELECT reserved_bytes FROM torrentclaw_nzb_quota WHERE period = ${key}`
      );
      return {
        reservedBytes: Number(aggregate.reserved_bytes),
        alreadyReserved: true,
      };
    }
    const update = await tx.exec(
      sql`UPDATE torrentclaw_nzb_quota
          SET reserved_bytes = reserved_bytes + ${amount}, updated_at_ms = ${now}
          WHERE period = ${key} AND reserved_bytes + ${amount} <= ${limit}`
    );
    if (update.rowCount === 0) {
      await tx.exec(
        sql`DELETE FROM torrentclaw_nzb_reservations
            WHERE period = ${key} AND reservation_key = ${stableKey}`
      );
      return undefined;
    }
    const aggregate = await tx.one<{ reserved_bytes: number | string }>(
      sql`SELECT reserved_bytes FROM torrentclaw_nzb_quota WHERE period = ${key}`
    );
    return {
      reservedBytes: Number(aggregate.reserved_bytes),
      alreadyReserved: false,
    };
  });
  if (result === undefined) {
    throw new Error('TorrentClaw monthly NZB quota exceeded (200 GB)');
  }
  return { period: key, limitBytes: limit, ...result };
}
