import { getDb } from '../db.js';
import { raw, sql } from '../sql.js';

export interface JellyfinPlaylist {
  id: string;
  uuid: string;
  /** Empty for the account's own user. */
  persona: string;
  name: string;
  items: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistOwner {
  uuid: string;
  persona: string;
}

/** Past these, creating a playlist or adding to one is refused. */
export const PLAYLIST_LIMITS = { perUser: 200, items: 1000 } as const;

interface PlaylistRow {
  id: string;
  uuid: string;
  persona: string;
  name: string;
  items: string;
  created_at: number | string;
  updated_at: number | string;
  [k: string]: unknown;
}

function parseItems(text: string): string[] {
  try {
    const items: unknown = JSON.parse(text);
    return Array.isArray(items)
      ? items.filter((i): i is string => typeof i === 'string')
      : [];
  } catch {
    return [];
  }
}

function fromRow(row: PlaylistRow): JellyfinPlaylist {
  return {
    id: row.id,
    uuid: row.uuid,
    persona: row.persona,
    name: row.name,
    items: parseItems(row.items),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

const COLUMNS = raw('id, uuid, persona, name, items, created_at, updated_at');

export class JellyfinPlaylistRepository {
  static async list(owner: PlaylistOwner): Promise<JellyfinPlaylist[]> {
    const rows = await getDb().query<PlaylistRow>(
      sql`SELECT ${COLUMNS} FROM jellyfin_playlists
           WHERE uuid = ${owner.uuid} AND persona = ${owner.persona}
           ORDER BY created_at`
    );
    return rows.map(fromRow);
  }

  static async any(owner: PlaylistOwner): Promise<boolean> {
    const row = await getDb().maybeOne(
      sql`SELECT 1 AS found FROM jellyfin_playlists
           WHERE uuid = ${owner.uuid} AND persona = ${owner.persona}
           LIMIT 1`
    );
    return !!row;
  }

  /** Someone else's playlist is null, as one that doesn't exist is. */
  static async get(
    owner: PlaylistOwner,
    id: string
  ): Promise<JellyfinPlaylist | null> {
    const row = await getDb().maybeOne<PlaylistRow>(
      sql`SELECT ${COLUMNS} FROM jellyfin_playlists
           WHERE id = ${id} AND uuid = ${owner.uuid} AND persona = ${owner.persona}`
    );
    return row ? fromRow(row) : null;
  }

  /** Null once the user has as many as the limit allows. */
  static async create(
    owner: PlaylistOwner,
    playlist: Pick<JellyfinPlaylist, 'id' | 'name' | 'items'>
  ): Promise<JellyfinPlaylist | null> {
    return getDb().tx(async (tx) => {
      const count = await tx.count(
        sql`SELECT COUNT(*) FROM jellyfin_playlists
             WHERE uuid = ${owner.uuid} AND persona = ${owner.persona}`
      );
      if (count >= PLAYLIST_LIMITS.perUser) return null;
      const now = Date.now();
      await tx.exec(
        sql`INSERT INTO jellyfin_playlists (id, uuid, persona, name, items, created_at, updated_at)
            VALUES (${playlist.id}, ${owner.uuid}, ${owner.persona}, ${playlist.name},
                    ${JSON.stringify(playlist.items)}, ${now}, ${now})`
      );
      return {
        ...playlist,
        ...owner,
        createdAt: now,
        updatedAt: now,
      };
    });
  }

  /**
   * Applies `change` to the stored playlist, so edits from two devices never
   * overwrite each other. `change` returns null to leave it as it is.
   */
  static async update(
    owner: PlaylistOwner,
    id: string,
    change: (
      playlist: JellyfinPlaylist
    ) => Partial<Pick<JellyfinPlaylist, 'name' | 'items'>> | null
  ): Promise<JellyfinPlaylist | null> {
    return getDb().tx(async (tx) => {
      const lock = tx.dialect === 'postgres' ? raw('FOR UPDATE') : raw('');
      const row = await tx.maybeOne<PlaylistRow>(
        sql`SELECT ${COLUMNS} FROM jellyfin_playlists
             WHERE id = ${id} AND uuid = ${owner.uuid} AND persona = ${owner.persona}
             ${lock}`
      );
      if (!row) return null;
      const current = fromRow(row);
      const patch = change(current);
      if (!patch) return current;
      const next = { ...current, ...patch, updatedAt: Date.now() };
      await tx.exec(
        sql`UPDATE jellyfin_playlists
               SET name = ${next.name}, items = ${JSON.stringify(next.items)},
                   updated_at = ${next.updatedAt}
             WHERE id = ${id}`
      );
      return next;
    });
  }

  static async remove(owner: PlaylistOwner, id: string): Promise<boolean> {
    const { rowCount } = await getDb().exec(
      sql`DELETE FROM jellyfin_playlists
           WHERE id = ${id} AND uuid = ${owner.uuid} AND persona = ${owner.persona}`
    );
    return rowCount > 0;
  }
}
