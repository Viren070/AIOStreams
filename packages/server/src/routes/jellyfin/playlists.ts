import { Router, type Request, type Response } from 'express';
import {
  decodeItemId,
  hyphenless,
  isUnairedEpisode,
  JellyfinPlaylistRepository,
  listResult,
  newPlaylistId,
  PLAYLIST_LIMITS,
  resolveByMediaSource,
  stripInternal,
  type JellyfinItem,
  type JellyfinPlaylist,
} from '@aiostreams/core';
import {
  bodyField,
  jf,
  param,
  qb,
  qi,
  qlist,
  qs,
  type JellyfinRequestContext,
} from './context.js';
import {
  attachUserData,
  boxSetChildren,
  decodeForRequest,
  episodesForSeries,
  itemFromDescriptor,
  playlistItem,
  playlistOwner,
} from './items.js';
import { mapLimited, ROW_CONCURRENCY } from './library.js';

/*
 * Jellyfin's playlists, kept per user. An entry's `PlaylistItemId` is its
 * item's id, as in Jellyfin, so a title is in a playlist once.
 */
const router: Router = Router({ mergeParams: true });

const NAME_LENGTH = 200;

function nameOf(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, NAME_LENGTH) : '';
}

/** Ids from the query, else from the body, which takes an array or a comma list. */
function idsOf(req: Request, name: string): string[] {
  const fromQuery = qlist(req, name);
  if (fromQuery.length) return fromQuery;
  const field = bodyField(req, name);
  const list = Array.isArray(field)
    ? field
    : typeof field === 'string'
      ? field.split(',')
      : [];
  return list.filter((id): id is string => typeof id === 'string' && !!id);
}

/**
 * The titles that play, in order. As in Jellyfin, a show or a season adds its
 * aired episodes and a collection its films.
 */
async function playableIds(
  ctx: JellyfinRequestContext,
  ids: string[]
): Promise<string[]> {
  const found = await mapLimited(
    ids.slice(0, PLAYLIST_LIMITS.items),
    ROW_CONCURRENCY,
    (raw) => titlesOf(ctx, raw).catch(() => [])
  );
  return found.flat().slice(0, PLAYLIST_LIMITS.items);
}

async function titlesOf(
  ctx: JellyfinRequestContext,
  raw: string
): Promise<string[]> {
  let itemId = hyphenless(raw);
  let decoded = await decodeForRequest(ctx, itemId);
  if (decoded?.kind === 'source') {
    const pointer = await resolveByMediaSource(decoded.msid);
    if (!pointer || pointer.uuid !== ctx.uuid) return [];
    itemId = pointer.itemId;
    decoded = await decodeForRequest(ctx, itemId);
  }
  if (decoded?.kind !== 'descriptor') return [];
  const d = decoded.descriptor;
  if (d.k === 'episode') return [itemId];
  if (d.k === 'movie' || d.k === 'boxset') {
    // A film whose meta lists several videos is a collection.
    const item =
      d.k === 'movie'
        ? await itemFromDescriptor(ctx, d, { bare: true }).catch(() => null)
        : null;
    if (d.k === 'movie' && item?.Type !== 'BoxSet') return [itemId];
    const r = await boxSetChildren(ctx, d);
    return (r?.children ?? [])
      .filter((child) => child.Type === 'Movie')
      .map((child) => child.Id);
  }
  if (d.k === 'series' || d.k === 'season') {
    const r = await episodesForSeries(
      ctx,
      d,
      d.k === 'season' ? d.s : undefined
    );
    return (r?.episodes ?? [])
      .filter((episode) => !isUnairedEpisode(episode))
      .map((episode) => episode.Id);
  }
  return [];
}

function withoutRepeats(ids: string[], taken: Iterable<string> = []) {
  const seen = new Set(taken);
  return ids.filter((id) => !seen.has(id) && !!seen.add(id));
}

const FULL = `A playlist holds up to ${PLAYLIST_LIMITS.items} titles`;

async function playlistFor(
  req: Request,
  res: Response,
  ctx: JellyfinRequestContext
): Promise<JellyfinPlaylist | null> {
  const playlist = await JellyfinPlaylistRepository.get(
    playlistOwner(ctx),
    hyphenless(param(req, 'playlistId'))
  );
  if (!playlist) res.status(404).json({ Message: 'Playlist not found' });
  return playlist;
}

/**
 * Its entries as list rows, each with `PlaylistItemId`, their user data read
 * together; one that no longer builds is left out.
 */
async function entries(
  req: Request,
  ctx: JellyfinRequestContext,
  playlist: JellyfinPlaylist
): Promise<{ items: JellyfinItem[]; total: number; startIndex: number }> {
  const startIndex = Math.max(0, qi(req, 'StartIndex', 0));
  const limit = qs(req, 'Limit')
    ? Math.max(0, qi(req, 'Limit', 0))
    : playlist.items.length;
  const ids = playlist.items.slice(startIndex, startIndex + limit);
  const built = await mapLimited(ids, ROW_CONCURRENCY, async (id) => {
    const decoded = await decodeForRequest(ctx, id);
    return decoded?.kind === 'descriptor'
      ? itemFromDescriptor(ctx, decoded.descriptor, { bare: true }).catch(
          () => null
        )
      : null;
  });
  await attachUserData(
    ctx,
    built.filter((item): item is JellyfinItem => !!item)
  );
  const items = built.flatMap((item, i) =>
    item ? [{ ...stripInternal(item), PlaylistItemId: ids[i] }] : []
  );
  return { items, total: playlist.items.length, startIndex };
}

router.post(
  '/Playlists',
  jf(async (req, res, ctx) => {
    const name = nameOf(qs(req, 'Name') ?? bodyField(req, 'Name'));
    if (!name) {
      res.status(400).json({ Message: 'A playlist needs a name' });
      return;
    }
    const items = withoutRepeats(await playableIds(ctx, idsOf(req, 'Ids')));
    const playlist = await JellyfinPlaylistRepository.create(
      playlistOwner(ctx),
      { id: newPlaylistId(), name, items }
    );
    if (!playlist) {
      res.status(400).json({
        Message: `You can have up to ${PLAYLIST_LIMITS.perUser} playlists`,
      });
      return;
    }
    res.json({ Id: playlist.id });
  })
);

router.get(
  '/Playlists/:playlistId',
  jf(async (req, res, ctx) => {
    const playlist = await playlistFor(req, res, ctx);
    if (!playlist) return;
    res.json({ OpenAccess: false, Shares: [], ItemIds: playlist.items });
  })
);

router.post(
  '/Playlists/:playlistId',
  jf(async (req, res, ctx) => {
    const name = nameOf(bodyField(req, 'Name'));
    const replacing = bodyField(req, 'Ids') != null;
    const items = replacing
      ? withoutRepeats(await playableIds(ctx, idsOf(req, 'Ids')))
      : null;
    const updated = await JellyfinPlaylistRepository.update(
      playlistOwner(ctx),
      hyphenless(param(req, 'playlistId')),
      () => ({ ...(name && { name }), ...(items && { items }) })
    );
    if (!updated) {
      res.status(404).json({ Message: 'Playlist not found' });
      return;
    }
    res.status(204).end();
  })
);

router.get(
  '/Playlists/:playlistId/Items',
  jf(async (req, res, ctx) => {
    const playlist = await playlistFor(req, res, ctx);
    if (!playlist) return;
    const { items, total, startIndex } = await entries(req, ctx, playlist);
    res.json(listResult(items, total, startIndex));
  })
);

router.post(
  '/Playlists/:playlistId/Items',
  jf(async (req, res, ctx) => {
    const added = await playableIds(ctx, idsOf(req, 'Ids'));
    const position = qs(req, 'Position') ? qi(req, 'Position', 0) : null;
    let full = false;
    const updated = await JellyfinPlaylistRepository.update(
      playlistOwner(ctx),
      hyphenless(param(req, 'playlistId')),
      (playlist) => {
        const fresh = withoutRepeats(added, playlist.items);
        if (!fresh.length) return null;
        if (playlist.items.length + fresh.length > PLAYLIST_LIMITS.items) {
          full = true;
          return null;
        }
        const at =
          position === null
            ? playlist.items.length
            : Math.min(Math.max(0, position), playlist.items.length);
        const items = [...playlist.items];
        items.splice(at, 0, ...fresh);
        return { items };
      }
    );
    if (!updated) res.status(404).json({ Message: 'Playlist not found' });
    else if (full) res.status(400).json({ Message: FULL });
    else res.status(204).end();
  })
);

router.delete(
  '/Playlists/:playlistId/Items',
  jf(async (req, res, ctx) => {
    const removed = new Set(idsOf(req, 'EntryIds').map(hyphenless));
    const updated = await JellyfinPlaylistRepository.update(
      playlistOwner(ctx),
      hyphenless(param(req, 'playlistId')),
      (playlist) => {
        const items = playlist.items.filter((id) => !removed.has(id));
        return items.length === playlist.items.length ? null : { items };
      }
    );
    if (!updated) res.status(404).json({ Message: 'Playlist not found' });
    else res.status(204).end();
  })
);

router.post(
  '/Playlists/:playlistId/Items/:entryId/Move/:newIndex',
  jf(async (req, res, ctx) => {
    const entry = hyphenless(param(req, 'entryId'));
    const to = Number(param(req, 'newIndex'));
    const updated = await JellyfinPlaylistRepository.update(
      playlistOwner(ctx),
      hyphenless(param(req, 'playlistId')),
      (playlist) => {
        const from = playlist.items.indexOf(entry);
        if (from < 0 || !Number.isInteger(to)) return null;
        const items = playlist.items.filter((id) => id !== entry);
        items.splice(Math.min(Math.max(0, to), items.length), 0, entry);
        return { items };
      }
    );
    if (!updated) res.status(404).json({ Message: 'Playlist not found' });
    else res.status(204).end();
  })
);

// Playlists aren't shared between users here, so the owner is the only one.
router.get(
  '/Playlists/:playlistId/Users',
  jf(async (req, res, ctx) => {
    if (await playlistFor(req, res, ctx)) res.json([]);
  })
);
router.get(
  '/Playlists/:playlistId/Users/:userId',
  jf(async (req, res, ctx) => {
    if (!(await playlistFor(req, res, ctx))) return;
    if (hyphenless(param(req, 'userId')) !== ctx.userId)
      res.status(404).json({ Message: 'User permissions not found' });
    else res.json({ UserId: ctx.userId, CanEdit: true });
  })
);
router.all(
  '/Playlists/:playlistId/Users/:userId',
  jf((_req, res) => {
    res.status(403).json({ Message: 'Playlists are not shared here' });
  })
);

async function removePlaylists(
  res: Response,
  ctx: JellyfinRequestContext,
  ids: string[]
) {
  let removed = 0;
  for (const id of ids)
    if (await JellyfinPlaylistRepository.remove(playlistOwner(ctx), id))
      removed++;
  if (removed) res.status(204).end();
  else res.status(404).json({ Message: 'Item not found' });
}

// Only playlists can be deleted; anything else carries on to a 404.
router.delete('/Items/:itemId', async (req, res, next) => {
  const id = hyphenless(param(req, 'itemId'));
  if ((await decodeItemId(id))?.kind !== 'playlist') return next();
  return jf((_req, res, ctx) => removePlaylists(res, ctx, [id]))(
    req,
    res,
    next
  );
});
router.delete('/Items', async (req, res, next) => {
  const ids = qlist(req, 'Ids').map(hyphenless);
  const kinds = await Promise.all(ids.map((id) => decodeItemId(id)));
  if (!ids.length || kinds.some((k) => k?.kind !== 'playlist')) return next();
  return jf((_req, res, ctx) => removePlaylists(res, ctx, ids))(req, res, next);
});

/** Sorted by name or date added when asked, else in the order they were made. */
function sortPlaylists(req: Request, items: JellyfinItem[]): JellyfinItem[] {
  const by = qlist(req, 'SortBy')[0]?.toLowerCase();
  const key =
    by === 'sortname' || by === 'name'
      ? (i: JellyfinItem) => String(i.SortName)
      : by === 'datecreated'
        ? (i: JellyfinItem) => String(i.DateCreated)
        : by === 'datelastcontentadded'
          ? (i: JellyfinItem) => String(i.DateLastMediaAdded)
          : null;
  if (!key) return items;
  const sorted = [...items].sort((a, b) => key(a).localeCompare(key(b)));
  return qs(req, 'SortOrder')?.toLowerCase().startsWith('desc')
    ? sorted.reverse()
    : sorted;
}

/*
 * `/Items` asking for playlists, or for what one holds. Anything else goes
 * on to the library.
 */
async function playlistParent(req: Request) {
  const parentId = qs(req, 'ParentId');
  if (parentId) {
    const parent = await decodeItemId(parentId);
    return parent?.kind === 'playlist' || parent?.kind === 'playlists'
      ? parent
      : null;
  }
  const types = qlist(req, 'IncludeItemTypes').map((t) => t.toLowerCase());
  return types.length === 1 &&
    types[0] === 'playlist' &&
    !qlist(req, 'Ids').length &&
    !qs(req, 'SearchTerm')
    ? ({ kind: 'playlists' } as const)
    : null;
}

router.get(['/Items', '/Users/:userId/Items'], async (req, res, next) => {
  const parent = await playlistParent(req).catch(() => null);
  if (!parent) return next();
  return jf(async (req, res, ctx) => {
    if (parent.kind === 'playlist') {
      const playlist = await JellyfinPlaylistRepository.get(
        playlistOwner(ctx),
        parent.id
      );
      if (!playlist) {
        res.json(listResult([], 0));
        return;
      }
      const { items, total, startIndex } = await entries(req, ctx, playlist);
      res.json(listResult(items, total, startIndex));
      return;
    }
    const playlists = await JellyfinPlaylistRepository.list(playlistOwner(ctx));
    const built = await mapLimited(playlists, ROW_CONCURRENCY, (p) =>
      playlistItem(ctx, p)
    );
    const sorted = sortPlaylists(req, built).map(stripInternal);
    const startIndex = Math.max(0, qi(req, 'StartIndex', 0));
    const end = qs(req, 'Limit')
      ? startIndex + Math.max(0, qi(req, 'Limit', 0))
      : sorted.length;
    const page = sorted.slice(startIndex, end);
    res.json(
      listResult(
        page,
        qb(req, 'EnableTotalRecordCount') === false
          ? page.length
          : sorted.length,
        startIndex
      )
    );
  })(req, res, next);
});

export default router;
