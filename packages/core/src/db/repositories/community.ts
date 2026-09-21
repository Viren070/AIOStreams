import { getDb } from '../db.js';
import { sql, raw, join, type SqlFragment } from '../sql.js';
import type {
  CommunityBlock,
  CommunityBlockKind,
  CommunityDraft,
  CommunityItem,
  CommunityKind,
  CommunityListQuery,
  CommunityStatus,
} from '../../community/types.js';

interface ItemDbRow {
  id: string;
  kind: string;
  status: string;
  owner_hash: string;
  ip_hash: string;
  name: string;
  description: string;
  author: string;
  version: string;
  tags: string;
  payload: string;
  review_summary: string | null;
  draft: string | null;
  draft_rejection_reason: string | null;
  trusted: number | string;
  likes: number | string;
  rejection_reason: string | null;
  created_at: number | string;
  updated_at: number | string;
  reviewed_at: number | string | null;
  [k: string]: unknown;
}

interface LikeDbRow {
  item_id: string;
  owner_hash: string;
  ip_hash: string;
  created_at: number | string;
  [k: string]: unknown;
}

interface BlockDbRow {
  hash: string;
  kind: string;
  reason: string | null;
  created_at: number | string;
  [k: string]: unknown;
}

const ITEM_COLUMNS = `id, kind, status, owner_hash, ip_hash, name, description, author,
       version, tags, payload, review_summary, draft, draft_rejection_reason, trusted,
       likes, rejection_reason, created_at, updated_at, reviewed_at`;

function parseJson<T>(text: string | null): T | undefined {
  if (text == null) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function optionalNumber(v: number | string | null): number | undefined {
  return v == null ? undefined : Number(v);
}

function toItem(r: ItemDbRow): CommunityItem {
  return {
    id: r.id,
    kind: r.kind as CommunityKind,
    status: r.status as CommunityStatus,
    ownerHash: r.owner_hash,
    ipHash: r.ip_hash,
    name: r.name,
    description: r.description,
    author: r.author,
    version: r.version,
    tags: parseJson<string[]>(r.tags) ?? [],
    payload: parseJson(r.payload),
    reviewSummary: parseJson(r.review_summary),
    draft: parseJson<CommunityDraft>(r.draft),
    draftRejectionReason: r.draft_rejection_reason ?? undefined,
    trusted: Number(r.trusted) === 1,
    likes: Number(r.likes ?? 0),
    rejectionReason: r.rejection_reason ?? undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    reviewedAt: optionalNumber(r.reviewed_at),
  };
}

function toBlock(r: BlockDbRow): CommunityBlock {
  return {
    hash: r.hash,
    kind: r.kind as CommunityBlockKind,
    reason: r.reason ?? undefined,
    createdAt: Number(r.created_at),
  };
}

export interface CommunityItemInsert {
  id: string;
  kind: CommunityKind;
  status: CommunityStatus;
  ownerHash: string;
  ipHash: string;
  name: string;
  description: string;
  author: string;
  version: string;
  tags: string[];
  payload: unknown;
  reviewSummary?: unknown;
  createdAt: number;
}

export interface CommunityLiveUpdate {
  name: string;
  description: string;
  author: string;
  version: string;
  tags: string[];
  payload: unknown;
  reviewSummary?: unknown;
  status: CommunityStatus;
  updatedAt: number;
}

export class CommunityRepository {
  static async insert(item: CommunityItemInsert): Promise<void> {
    await getDb().exec(
      sql`INSERT INTO community_items
            (id, kind, status, owner_hash, ip_hash, name, description, author,
             version, tags, payload, review_summary, created_at, updated_at)
          VALUES
            (${item.id}, ${item.kind}, ${item.status}, ${item.ownerHash}, ${item.ipHash},
             ${item.name}, ${item.description}, ${item.author}, ${item.version},
             ${JSON.stringify(item.tags)}, ${JSON.stringify(item.payload)},
             ${item.reviewSummary === undefined ? null : JSON.stringify(item.reviewSummary)},
             ${item.createdAt}, ${item.createdAt})`
    );
  }

  static async get(id: string): Promise<CommunityItem | undefined> {
    const row = await getDb().maybeOne<ItemDbRow>(
      sql`SELECT ${raw(ITEM_COLUMNS)} FROM community_items WHERE id = ${id}`
    );
    return row ? toItem(row) : undefined;
  }

  static async list(
    q: CommunityListQuery = {}
  ): Promise<{ entries: CommunityItem[]; total: number }> {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
    const offset = Math.max(q.offset ?? 0, 0);
    const filters: SqlFragment[] = [];
    if (q.kind) filters.push(sql`kind = ${q.kind}`);
    if (q.status) filters.push(sql`status = ${q.status}`);
    if (q.pending) {
      filters.push(sql`(status = 'pending' OR draft IS NOT NULL)`);
    }
    if (q.search) {
      const like = `%${q.search.toLowerCase()}%`;
      filters.push(
        sql`(LOWER(name) LIKE ${like} OR LOWER(description) LIKE ${like} OR LOWER(author) LIKE ${like})`
      );
    }
    const where =
      filters.length > 0 ? sql`WHERE ${join(filters, ' AND ')}` : sql``;
    const [rows, total] = await Promise.all([
      getDb().query<ItemDbRow>(
        sql`SELECT ${raw(ITEM_COLUMNS)}
              FROM community_items
              ${where}
             ORDER BY updated_at DESC
             LIMIT ${limit} OFFSET ${offset}`
      ),
      getDb().count(sql`SELECT COUNT(*) FROM community_items ${where}`),
    ]);
    return { entries: rows.map(toItem), total };
  }

  /** Approved items of one kind, most liked first. */
  static async listApproved(kind: CommunityKind): Promise<CommunityItem[]> {
    const rows = await getDb().query<ItemDbRow>(
      sql`SELECT ${raw(ITEM_COLUMNS)}
            FROM community_items
           WHERE kind = ${kind} AND status = 'approved'
           ORDER BY likes DESC, updated_at DESC`
    );
    return rows.map(toItem);
  }

  static async listTrusted(kind: CommunityKind): Promise<CommunityItem[]> {
    const rows = await getDb().query<ItemDbRow>(
      sql`SELECT ${raw(ITEM_COLUMNS)}
            FROM community_items
           WHERE kind = ${kind} AND status = 'approved' AND trusted = 1`
    );
    return rows.map(toItem);
  }

  static async listByOwner(ownerHash: string): Promise<CommunityItem[]> {
    const rows = await getDb().query<ItemDbRow>(
      sql`SELECT ${raw(ITEM_COLUMNS)}
            FROM community_items
           WHERE owner_hash = ${ownerHash}
           ORDER BY updated_at DESC`
    );
    return rows.map(toItem);
  }

  /** Creates or updates by this owner since `sinceMs`, the per-day submission budget. */
  static async countByOwnerSince(
    ownerHash: string,
    sinceMs: number
  ): Promise<number> {
    return getDb().count(
      sql`SELECT COUNT(*) FROM community_items
           WHERE owner_hash = ${ownerHash}
             AND (created_at >= ${sinceMs} OR updated_at >= ${sinceMs})`
    );
  }

  static async updateLive(id: string, u: CommunityLiveUpdate): Promise<void> {
    await getDb().exec(
      sql`UPDATE community_items
             SET name = ${u.name},
                 description = ${u.description},
                 author = ${u.author},
                 version = ${u.version},
                 tags = ${JSON.stringify(u.tags)},
                 payload = ${JSON.stringify(u.payload)},
                 review_summary = ${u.reviewSummary === undefined ? null : JSON.stringify(u.reviewSummary)},
                 status = ${u.status},
                 rejection_reason = NULL,
                 draft = NULL,
                 draft_rejection_reason = NULL,
                 updated_at = ${u.updatedAt}
           WHERE id = ${id}`
    );
  }

  static async setDraft(
    id: string,
    draft: CommunityDraft | null,
    rejectionReason: string | null = null
  ): Promise<void> {
    await getDb().exec(
      sql`UPDATE community_items
             SET draft = ${draft ? JSON.stringify(draft) : null},
                 draft_rejection_reason = ${rejectionReason},
                 updated_at = ${Date.now()}
           WHERE id = ${id}`
    );
  }

  /** Copies the draft over the live columns and clears it. */
  static async promoteDraft(id: string): Promise<CommunityItem | undefined> {
    const item = await this.get(id);
    if (!item?.draft) return item;
    await this.updateLive(id, {
      name: item.draft.name,
      description: item.draft.description,
      author: item.draft.author,
      version: item.draft.version,
      tags: item.draft.tags ?? [],
      payload: item.draft.payload,
      reviewSummary: item.draft.reviewSummary,
      status: 'approved',
      updatedAt: Date.now(),
    });
    await getDb().exec(
      sql`UPDATE community_items SET reviewed_at = ${Date.now()} WHERE id = ${id}`
    );
    return this.get(id);
  }

  static async setStatus(
    id: string,
    status: CommunityStatus,
    rejectionReason: string | null = null
  ): Promise<void> {
    await getDb().exec(
      sql`UPDATE community_items
             SET status = ${status},
                 rejection_reason = ${rejectionReason},
                 reviewed_at = ${Date.now()},
                 updated_at = ${Date.now()}
           WHERE id = ${id}`
    );
  }

  static async setTrusted(id: string, trusted: boolean): Promise<void> {
    await getDb().exec(
      sql`UPDATE community_items SET trusted = ${trusted ? 1 : 0} WHERE id = ${id}`
    );
  }

  static async remove(id: string): Promise<boolean> {
    const res = await getDb().exec(
      sql`DELETE FROM community_items WHERE id = ${id}`
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Changes whenever a public listing would: approved rows, their edits, and
   * likes (which never touch `updated_at`, so they are counted separately).
   */
  static async getExportRevision(): Promise<string> {
    const db = getDb();
    const [items, likes] = await Promise.all([
      db.maybeOne<{
        n: number | string;
        latest: number | string | null;
        [k: string]: unknown;
      }>(
        sql`SELECT COUNT(*) AS n, MAX(updated_at) AS latest
              FROM community_items WHERE status = 'approved'`
      ),
      db.maybeOne<{
        n: number | string;
        latest: number | string | null;
        [k: string]: unknown;
      }>(
        sql`SELECT COUNT(*) AS n, MAX(created_at) AS latest FROM community_likes`
      ),
    ]);
    return [
      Number(items?.n ?? 0),
      Number(items?.latest ?? 0),
      Number(likes?.n ?? 0),
      Number(likes?.latest ?? 0),
    ].join(':');
  }

  // --- likes ------------------------------------------------------------

  static async findLike(
    itemId: string,
    ownerHash: string,
    ipHash: string
  ): Promise<{ ownerHash: string; ipHash: string } | undefined> {
    const row = await getDb().maybeOne<LikeDbRow>(
      sql`SELECT item_id, owner_hash, ip_hash, created_at
            FROM community_likes
           WHERE item_id = ${itemId}
             AND (owner_hash = ${ownerHash} OR ip_hash = ${ipHash})
           LIMIT 1`
    );
    return row ? { ownerHash: row.owner_hash, ipHash: row.ip_hash } : undefined;
  }

  static async addLike(
    itemId: string,
    ownerHash: string,
    ipHash: string
  ): Promise<void> {
    await getDb().exec(
      sql`INSERT INTO community_likes (item_id, owner_hash, ip_hash, created_at)
          VALUES (${itemId}, ${ownerHash}, ${ipHash}, ${Date.now()})`
    );
  }

  static async removeLike(itemId: string, ownerHash: string): Promise<void> {
    await getDb().exec(
      sql`DELETE FROM community_likes
           WHERE item_id = ${itemId} AND owner_hash = ${ownerHash}`
    );
  }

  static async recountLikes(itemId: string): Promise<number> {
    const db = getDb();
    const n = await db.count(
      sql`SELECT COUNT(*) FROM community_likes WHERE item_id = ${itemId}`
    );
    await db.exec(
      sql`UPDATE community_items SET likes = ${n} WHERE id = ${itemId}`
    );
    return n;
  }

  static async resetLikes(itemId: string): Promise<void> {
    const db = getDb();
    await db.exec(sql`DELETE FROM community_likes WHERE item_id = ${itemId}`);
    await db.exec(
      sql`UPDATE community_items SET likes = 0 WHERE id = ${itemId}`
    );
  }

  // --- blocks -----------------------------------------------------------

  static async listBlocks(): Promise<CommunityBlock[]> {
    const rows = await getDb().query<BlockDbRow>(
      sql`SELECT hash, kind, reason, created_at
            FROM community_blocks
           ORDER BY created_at DESC`
    );
    return rows.map(toBlock);
  }

  static async addBlock(
    hash: string,
    kind: CommunityBlockKind,
    reason?: string
  ): Promise<void> {
    await getDb().exec(
      sql`INSERT INTO community_blocks (hash, kind, reason, created_at)
          VALUES (${hash}, ${kind}, ${reason ?? null}, ${Date.now()})
          ON CONFLICT(hash) DO UPDATE SET reason = EXCLUDED.reason`
    );
  }

  static async removeBlock(hash: string): Promise<boolean> {
    const res = await getDb().exec(
      sql`DELETE FROM community_blocks WHERE hash = ${hash}`
    );
    return (res.rowCount ?? 0) > 0;
  }

  static async isBlocked(ownerHash: string, ipHash: string): Promise<boolean> {
    const n = await getDb().count(
      sql`SELECT COUNT(*) FROM community_blocks
           WHERE hash = ${ownerHash} OR hash = ${ipHash}`
    );
    return n > 0;
  }
}
