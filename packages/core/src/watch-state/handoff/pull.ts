import { z } from 'zod';
import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import { makeRequest } from '../../utils/http.js';
import { readBodyCapped } from '../../utils/safe-fetch.js';
import { getDb } from '../../db/db.js';
import { TaskManager } from '../../tasks/index.js';
import { randomUUID } from 'node:crypto';
import { sinkProbeMs } from './deliver.js';
import type { DbDriver } from '../../db/driver/types.js';
import type { SqlFragment } from '../../db/sql.js';
import {
  PlaybackHandoffRepository,
  type SinkRow,
} from '../../db/repositories/playback-handoff.js';
import {
  WatchStateRepository,
  type WatchIdentity,
  type WatchStateRow,
} from '../../db/repositories/watch-state.js';
import {
  identityFor,
  itemKeyFor,
  scopeOf,
  seriesKeyOf,
  type WatchScope,
} from '../types.js';
import { matchKeysFor } from '../canonical.js';
import type { ContentRef } from '../types.js';

const logger = createLogger('playback-pull');

const REQUEST_TIMEOUT_MS = 20_000;

/** Nothing below this fraction is worth restoring as a resume point. */
const RESUME_MIN_FRACTION = 0.02;
/** At or past this fraction the addon is describing a finished item. */
const PLAYED_FRACTION = 0.9;

const StateItemSchema = z.looseObject({
  type: z.string().optional(),
  metaId: z.string().min(1),
  videoId: z.string().min(1),
  season: z.number().nullable().optional(),
  episode: z.number().nullable().optional(),
  positionMs: z.number().optional(),
  durationMs: z.number().optional(),
  progressPercent: z.number().optional(),
  played: z.boolean().optional(),
  at: z.number().optional(),
});

const StateNextUpSchema = z.looseObject({
  type: z.string().optional(),
  metaId: z.string().min(1),
  videoId: z.string().min(1),
  season: z.number().nullable().optional(),
  episode: z.number().nullable().optional(),
  at: z.number().optional(),
});

const StateWatchedSchema = z.looseObject({
  movies: z.array(z.string()).optional(),
  episodes: z.array(z.string()).optional(),
  counts: z.record(z.string(), z.unknown()).optional(),
  nextUp: z.array(StateNextUpSchema).optional(),
});

const StateWatchlistEntrySchema = z.looseObject({
  type: z.string().min(1),
  metaId: z.string().min(1),
  at: z.number().optional(),
});

const PlaybackStateSchema = z.looseObject({
  version: z.string().optional(),
  items: z.array(StateItemSchema).optional(),
  watched: StateWatchedSchema.optional(),
  watchlist: z.array(StateWatchlistEntrySchema).optional(),
});

export type PlaybackStatePayload = z.infer<typeof PlaybackStateSchema>;

export interface PullOutcome {
  /** The addon's version matched ours, so the watched half was not re-read. */
  unchanged: boolean;
  items: number;
  watched: number;
  watchlist: number;
  removed: number;
  skipped: number;
}

const EMPTY: PullOutcome = {
  unchanged: true,
  items: 0,
  watched: 0,
  watchlist: 0,
  removed: 0,
  skipped: 0,
};

/** Seconds or milliseconds; the contract says seconds but be forgiving. */
function atMs(at: number | undefined, fallback: number): number {
  if (!at || !Number.isFinite(at)) return fallback;
  return Math.round(at > 1e11 ? at : at * 1000);
}

function episodeKeyOf(videoId: string): string {
  return `e|${videoId}`;
}

/** Null when no duration is known: a percentage alone is not a position. */
function positionOf(
  item: z.infer<typeof StateItemSchema>,
  existing: WatchStateRow | undefined
): { positionMs: number; durationMs: number } | null {
  const durationMs =
    Math.round(item.durationMs && item.durationMs > 0 ? item.durationMs : 0) ||
    existing?.durationMs ||
    0;

  if (item.positionMs != null && item.positionMs > 0) {
    return { positionMs: Math.round(item.positionMs), durationMs };
  }
  if (item.progressPercent != null && item.progressPercent > 0) {
    if (durationMs <= 0) return null;
    return {
      positionMs: Math.round((durationMs * item.progressPercent) / 100),
      durationMs,
    };
  }
  return null;
}

/**
 * A local row inside the echo window is never touched: a tracker stamps our own
 * report later than we wrote it, so "newer wins" alone reads it back as remote
 * activity.
 */
function mayImport(
  existing: WatchStateRow | undefined,
  incomingAt: number,
  now: number
): boolean {
  if (!existing) return true;

  if (existing.origin === 'local') {
    const echoWindowMs = appConfig.watchState.echoWindowSeconds * 1000;
    if (now - existing.updatedAt < echoWindowMs) return false;
    return incomingAt > (existing.lastPlayedAt ?? existing.updatedAt);
  }

  return incomingAt > (existing.externalAt ?? 0);
}

type MatchKeys = Map<string, string | null>;

function matchedIdentityFrom(
  videoId: string,
  opts: {
    kind: 'movie' | 'episode';
    type: string;
    metaId: string;
    season?: number | null;
    episode?: number | null;
  },
  matches: MatchKeys
): WatchIdentity {
  const identity = identityFrom(videoId, opts);
  return { ...identity, matchKey: matches.get(identity.itemKey) ?? null };
}

interface ImportResult {
  written: number;
  skipped: number;
  touched: string[];
  rekeyed: [string, string][];
}

/**
 * An unchanged row is only touched, so a match key found after it was stored
 * needs its own write.
 */
function staleMatchKeys(
  existing: Map<string, WatchStateRow>,
  matches: MatchKeys
): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, row] of existing) {
    const match = matches.get(key);
    if (match && match !== row.matchKey) out.push([key, match]);
  }
  return out;
}

/**
 * Must run before the import transaction opens: the anime database reads on its
 * own connection, which on SQLite is the one the transaction holds.
 */
async function matchKeysFrom(
  payload: PlaybackStatePayload,
  listed: Set<string>
): Promise<MatchKeys> {
  const refs: ContentRef[] = [];
  for (const item of payload.items ?? []) {
    const split = splitVideoId(item.videoId);
    const isEpisode = item.episode != null || split.episode != null;
    refs.push({
      kind: isEpisode ? 'episode' : 'movie',
      type: item.type || (isEpisode ? 'series' : 'movie'),
      baseId: item.metaId,
      season: item.season !== undefined ? item.season : split.season,
      episode: item.episode !== undefined ? item.episode : split.episode,
      videoId: item.videoId,
    });
  }
  for (const entry of payload.watchlist ?? []) {
    const ref = watchlistRef(entry);
    // Already imported, with its match key stored.
    if (!listed.has(itemKeyFor(ref))) refs.push(ref);
  }
  for (const id of payload.watched?.movies ?? []) {
    refs.push({ kind: 'movie', type: 'movie', baseId: id, videoId: id });
  }
  for (const videoId of payload.watched?.episodes ?? []) {
    const split = splitVideoId(videoId);
    refs.push({
      kind: 'episode',
      type: 'series',
      baseId: split.metaId,
      season: split.season,
      episode: split.episode,
      videoId,
    });
  }

  return matchKeysFor(refs);
}

function identityFrom(
  videoId: string,
  opts: {
    kind: 'movie' | 'episode';
    type: string;
    metaId: string;
    season?: number | null;
    episode?: number | null;
  }
): WatchIdentity {
  if (opts.kind === 'movie') {
    return {
      itemKey: `m|${opts.metaId}`,
      kind: 'movie',
      mediaType: opts.type,
      baseId: opts.metaId,
      season: null,
      episode: null,
      videoId,
      seriesKey: null,
    };
  }
  return {
    itemKey: episodeKeyOf(videoId),
    kind: 'episode',
    mediaType: opts.type,
    baseId: opts.metaId,
    season: opts.season ?? null,
    episode: opts.episode ?? null,
    videoId,
    seriesKey: seriesKeyOf(opts.metaId),
  };
}

/** `tt0903747:3:11` -> base `tt0903747`, season 3, episode 11. */
function splitVideoId(videoId: string): {
  metaId: string;
  season: number | null;
  episode: number | null;
} {
  const parts = videoId.split(':');
  const tail: number[] = [];
  while (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
    // A prefixed id keeps its own numeric segment: kitsu:42323 is the base.
    if (parts.length === 2 && !/^tt\d+$/.test(parts[0])) break;
    tail.unshift(Number(parts.pop()));
  }
  const metaId = parts.join(':');
  if (tail.length >= 2) {
    return { metaId, season: tail[0], episode: tail[1] };
  }
  if (tail.length === 1) return { metaId, season: null, episode: tail[0] };
  return { metaId, season: null, episode: null };
}

type ImportRow = { identity: WatchIdentity; values: SqlFragment };

async function importItems(
  scope: WatchScope,
  sink: SinkRow,
  items: z.infer<typeof StateItemSchema>[],
  now: number,
  db: DbDriver,
  matches: MatchKeys
): Promise<ImportResult> {
  if (!items.length)
    return { written: 0, skipped: 0, touched: [], rekeyed: [] };

  const keys = items.map((i) =>
    i.episode != null || splitVideoId(i.videoId).episode != null
      ? episodeKeyOf(i.videoId)
      : `m|${i.metaId}`
  );
  const existingRows = await WatchStateRepository.getMany(scope, keys, db);

  const rows: ImportRow[] = [];
  /* Unchanged but still listed; marked seen so the sweep leaves them. */
  const touched: string[] = [];
  let skipped = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = keys[i];
    const existing = existingRows.get(key);
    const at = atMs(item.at, now);

    if (!mayImport(existing, at, now)) {
      skipped++;
      if (existing) touched.push(key);
      continue;
    }

    const isEpisode = key.startsWith('e|');
    const split = splitVideoId(item.videoId);
    const identity = matchedIdentityFrom(
      item.videoId,
      {
        kind: isEpisode ? 'episode' : 'movie',
        // The addon's own type where it gave one, otherwise what we already had.
        type:
          item.type || existing?.mediaType || (isEpisode ? 'series' : 'movie'),
        metaId: item.metaId,
        season: item.season !== undefined ? item.season : split.season,
        episode: item.episode !== undefined ? item.episode : split.episode,
      },
      matches
    );

    const position = positionOf(item, existing);
    const played =
      item.played === true ||
      (!!position &&
        position.durationMs > 0 &&
        position.positionMs >= position.durationMs * PLAYED_FRACTION);

    if (!played && !position) {
      skipped++;
      if (existing) touched.push(key);
      continue;
    }

    const tooEarly =
      !!position &&
      position.durationMs > 0 &&
      position.positionMs < position.durationMs * RESUME_MIN_FRACTION;

    rows.push({
      identity,
      values: WatchStateRepository.importValues(scope, identity, {
        positionMs: played || tooEarly ? 0 : (position?.positionMs ?? 0),
        durationMs: position?.durationMs ?? 0,
        played,
        lastPlayedAt: at,
        externalAt: at,
        sinkId: sink.id,
        now,
      }),
    });
  }
  await WatchStateRepository.upsertImports(scope, rows, db);
  return {
    written: rows.length,
    skipped,
    touched,
    rekeyed: staleMatchKeys(existingRows, matches),
  };
}

async function importWatched(
  scope: WatchScope,
  sink: SinkRow,
  watched: z.infer<typeof StateWatchedSchema>,
  now: number,
  db: DbDriver,
  matches: MatchKeys
): Promise<ImportResult> {
  const movies = watched.movies ?? [];
  const episodes = watched.episodes ?? [];
  const nextUp = watched.nextUp ?? [];

  // Next-up rows name their show's type, which the bare id lists cannot.
  const typeByMeta = new Map<string, string>();
  for (const row of nextUp) {
    if (row.type) typeByMeta.set(row.metaId, row.type);
  }

  // No time per title, only a last watch per show; a row without one sorts as old.
  const watchedAt = new Map<string, number>();
  const noteWatch = (metaId: string, at: unknown) => {
    if (typeof at !== 'number' || !(at > 0)) return;
    const ms = atMs(at, 0);
    if (ms > (watchedAt.get(metaId) ?? 0)) watchedAt.set(metaId, ms);
  };
  for (const [metaId, count] of Object.entries(watched.counts ?? {})) {
    noteWatch(metaId, (count as { at?: unknown } | null)?.at);
  }
  for (const row of nextUp) noteWatch(row.metaId, row.at);

  const keys = [
    ...movies.map((id) => `m|${id}`),
    ...episodes.map(episodeKeyOf),
  ];
  const existingRows = await WatchStateRepository.getMany(scope, keys, db);

  const rows: ImportRow[] = [];
  const touched: string[] = [];
  let skipped = 0;

  const write = (
    key: string,
    identity: WatchIdentity,
    existing?: WatchStateRow
  ) => {
    const showAt = watchedAt.get(identity.baseId) ?? 0;
    /* Already imported and already played; marking it seen is enough. */
    if (
      existing &&
      existing.played &&
      existing.origin === 'import' &&
      existing.sinkId === sink.id
    ) {
      touched.push(key);
      return;
    }
    if (!mayImport(existing, now, now)) {
      skipped++;
      if (existing) touched.push(key);
      return;
    }
    rows.push({
      identity,
      values: WatchStateRepository.importValues(scope, identity, {
        positionMs: 0,
        durationMs: existing?.durationMs ?? 0,
        played: true,
        lastPlayedAt: existing?.lastPlayedAt ?? null,
        sortAt: Math.max(existing?.sortAt ?? 0, showAt),
        externalAt: now,
        sinkId: sink.id,
        now,
      }),
    });
  };

  for (const id of movies) {
    const key = `m|${id}`;
    const existing = existingRows.get(key);
    write(
      key,
      matchedIdentityFrom(
        id,
        {
          kind: 'movie',
          type: typeByMeta.get(id) || existing?.mediaType || 'movie',
          metaId: id,
        },
        matches
      ),
      existing
    );
  }

  for (const videoId of episodes) {
    const key = episodeKeyOf(videoId);
    const existing = existingRows.get(key);
    const split = splitVideoId(videoId);
    write(
      key,
      matchedIdentityFrom(
        videoId,
        {
          kind: 'episode',
          type: typeByMeta.get(split.metaId) || existing?.mediaType || 'series',
          metaId: split.metaId,
          season: split.season,
          episode: split.episode,
        },
        matches
      ),
      existing
    );
  }

  await WatchStateRepository.upsertImports(scope, rows, db);
  return {
    written: rows.length,
    skipped,
    touched,
    rekeyed: staleMatchKeys(existingRows, matches),
  };
}

/** Every non-movie type is a show, as when browsed. */
function watchlistRef(
  entry: z.infer<typeof StateWatchlistEntrySchema>
): ContentRef {
  return entry.type === 'movie'
    ? {
        kind: 'movie',
        type: entry.type,
        baseId: entry.metaId,
        videoId: entry.metaId,
      }
    : { kind: 'series', type: entry.type, baseId: entry.metaId };
}

/** A favourite toggled here inside the echo window, or set by another addon's watchlist, is left alone. */
async function importWatchlist(
  scope: WatchScope,
  sink: SinkRow,
  entries: z.infer<typeof StateWatchlistEntrySchema>[],
  now: number,
  db: DbDriver,
  matches: MatchKeys
): Promise<{ written: number; touched: string[] }> {
  const identities = entries.map((entry) => {
    const identity = identityFor(watchlistRef(entry));
    return {
      identity: {
        ...identity,
        matchKey: matches.get(identity.itemKey) ?? null,
      },
      at: atMs(entry.at, now),
    };
  });
  const existing = await WatchStateRepository.getMany(
    scope,
    identities.map((i) => i.identity.itemKey),
    db
  );
  const echoWindowMs = appConfig.watchState.echoWindowSeconds * 1000;
  const rows: typeof identities = [];
  const touched: string[] = [];
  for (const row of identities) {
    const held = existing.get(row.identity.itemKey);
    if (held?.favoriteSinkId === sink.id && held.favorite) {
      touched.push(row.identity.itemKey);
      continue;
    }
    if (held?.favorite && held.favoriteSinkId) continue;
    const toggledHere = held && !held.favoriteSinkId && held.favoriteAt != null;
    if (toggledHere && now - held.favoriteAt! < echoWindowMs) continue;
    rows.push(row);
  }
  await WatchStateRepository.upsertWatchlist(scope, sink.id, rows, now, db);
  return { written: rows.length, touched };
}

async function fetchState(sink: SinkRow): Promise<PlaybackStatePayload | null> {
  if (!sink.pullUrl) return null;
  const url = new URL(sink.pullUrl);
  if (sink.pullVersion) url.searchParams.set('since', sink.pullVersion);

  const res = await makeRequest(url.toString(), {
    method: 'GET',
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Accept: 'application/json' },
    // Server-initiated and repeated by design.
    ignoreRecursion: true,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  /*
   * Oversized answers fail the whole read and must never be truncated instead:
   * `watched` is a complete set, so a partial one sweeps everything missing.
   */
  const body = await readBodyCapped(
    res,
    appConfig.watchState.pullMaxResponseBytes
  );
  const parsed = PlaybackStateSchema.safeParse(
    JSON.parse(body.toString('utf8'))
  );
  if (!parsed.success) throw new Error('unreadable state payload');

  const cfg = appConfig.watchState;
  const watched = parsed.data.watched;
  const counts: [string, number, number][] = [
    ['items', parsed.data.items?.length ?? 0, cfg.pullMaxItems],
    ['movies', watched?.movies?.length ?? 0, cfg.pullMaxWatched],
    ['episodes', watched?.episodes?.length ?? 0, cfg.pullMaxWatched],
    ['watchlist', parsed.data.watchlist?.length ?? 0, cfg.pullMaxWatched],
  ];
  for (const [what, got, max] of counts) {
    if (got > max) throw new Error(`${what} list of ${got} exceeds ${max}`);
  }
  return parsed.data;
}

/** How long a claimed read is held before another instance may take it over. */
function pullLeaseMs(): number {
  return REQUEST_TIMEOUT_MS + 60_000;
}

/** Spreads retries out without pushing a sink beyond reach of a recovery. */
function pullBackoffMs(failures: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, failures - 1), 6 * 3_600_000);
}

/**
 * `watched` is a complete set when present, so an absent block and an empty one
 * mean different things: absent changes nothing, empty clears every imported row.
 */
export async function pullSink(
  sink: SinkRow,
  token: string | null = null
): Promise<PullOutcome> {
  if (!appConfig.watchState.pullEnabled || !sink.pullUrl) return EMPTY;

  const cfg = appConfig.watchState;
  const now = Date.now();
  let payload: PlaybackStatePayload | null;
  try {
    payload = await fetchState(sink);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reauth = /HTTP 40[13]/.test(message);
    const failures = sink.pullFailures + 1;
    const disable = !reauth && failures >= cfg.deliveryFailuresBeforeDisable;
    /* Delivery never touches a read-only addon, so health is set here alone. */
    await PlaybackHandoffRepository.finishPull(sink.id, token, {
      at: now,
      nextPullAt:
        now + (reauth || disable ? sinkProbeMs() : pullBackoffMs(failures)),
      error: message,
      failures,
      status: reauth ? 'auth_expired' : disable ? 'error' : undefined,
    });
    logger.warn(
      { addon: sink.addonName, err: message, failures },
      'failed to read watch state from addon'
    );
    return EMPTY;
  }
  if (!payload) return EMPTY;

  const scope = scopeOf(sink);
  let items: ImportResult = {
    written: 0,
    skipped: 0,
    touched: [],
    rekeyed: [],
  };
  let watchedWritten = 0;
  let watchedSkipped = 0;
  let watchlistWritten = 0;
  let removed = 0;
  const unchanged = !payload.watched;

  /*
   * One transaction, so a concurrent read cannot sweep rows this one has
   * written but not yet marked seen. The fetch stays outside it: on SQLite a
   * transaction holds the single connection.
   */
  const watchlistKeys = (payload.watchlist ?? []).map((entry) =>
    itemKeyFor(watchlistRef(entry))
  );
  const held = watchlistKeys.length
    ? await WatchStateRepository.getMany(scope, watchlistKeys)
    : new Map<string, WatchStateRow>();
  const listed = new Set(
    [...held.values()]
      .filter((row) => row.favorite && row.favoriteSinkId === sink.id)
      .map((row) => row.itemKey)
  );
  const matches = await matchKeysFrom(payload, listed);

  await getDb().tx(async (tx) => {
    items = await importItems(
      scope,
      sink,
      payload.items ?? [],
      now,
      tx,
      matches
    );
    await WatchStateRepository.touchImports(
      scope,
      sink.id,
      items.touched,
      now,
      tx
    );
    await WatchStateRepository.setMatchKeys(scope, items.rekeyed, tx);

    // Always complete, so anything it stopped reporting goes now.
    removed = await WatchStateRepository.deleteStaleImports(
      scope,
      sink.id,
      now,
      'resume',
      tx
    );

    if (payload.watched) {
      const res = await importWatched(
        scope,
        sink,
        payload.watched,
        now,
        tx,
        matches
      );
      watchedWritten = res.written;
      watchedSkipped = res.skipped;
      await WatchStateRepository.touchImports(
        scope,
        sink.id,
        res.touched,
        now,
        tx
      );
      await WatchStateRepository.setMatchKeys(scope, res.rekeyed, tx);
      removed += await WatchStateRepository.deleteStaleImports(
        scope,
        sink.id,
        now,
        'watched',
        tx
      );
    }

    // Complete when present, like `watched`.
    if (payload.watchlist) {
      const res = await importWatchlist(
        scope,
        sink,
        payload.watchlist,
        now,
        tx,
        matches
      );
      watchlistWritten = res.written;
      await WatchStateRepository.touchWatchlist(
        scope,
        sink.id,
        res.touched,
        now,
        tx
      );
      removed += await WatchStateRepository.clearStaleWatchlist(
        scope,
        sink.id,
        now,
        tx
      );
    }
  });

  await PlaybackHandoffRepository.finishPull(sink.id, token, {
    at: now,
    nextPullAt: Date.now() + cfg.pullIntervalSeconds * 1000,
    version: payload.version ?? null,
    failures: 0,
    status: sink.status === 'connected' ? undefined : 'connected',
  });

  const outcome: PullOutcome = {
    unchanged,
    items: items.written,
    watched: watchedWritten,
    watchlist: watchlistWritten,
    removed,
    skipped: items.skipped + watchedSkipped,
  };
  if (
    outcome.items ||
    outcome.watched ||
    outcome.watchlist ||
    outcome.removed
  ) {
    logger.debug({ addon: sink.addonName, ...outcome }, 'imported watch state');
  }
  return outcome;
}

/** The scheduled read. Sinks are created by a request, never by this. */
export async function pullPlaybackState(): Promise<{
  sinks: number;
  items: number;
  watched: number;
  removed: number;
}> {
  const totals = { sinks: 0, items: 0, watched: 0, removed: 0 };
  if (!appConfig.watchState.pullEnabled) return totals;

  const cfg = appConfig.watchState;
  const now = Date.now();
  const token = `${TaskManager.instanceId}:${randomUUID()}`;

  const activeSince = cfg.pullActiveWithinHours
    ? now - cfg.pullActiveWithinHours * 3_600_000
    : 0;
  const sinks = await PlaybackHandoffRepository.claimPullSinks(
    token,
    now,
    pullLeaseMs(),
    cfg.pullMaxSinksPerRun,
    activeSince
  );
  if (!sinks.length) return totals;

  const deadline = now + cfg.pullBudgetSeconds * 1000;
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(cfg.pullConcurrency, sinks.length) },
      async () => {
        for (let i = next++; i < sinks.length; i = next++) {
          const sink = sinks[i];
          if (Date.now() >= deadline) {
            // Released as still due, rather than left for the lease to expire.
            await PlaybackHandoffRepository.finishPull(sink.id, token, {
              at: sink.lastPullAt ?? 0,
              nextPullAt: 0,
            }).catch(() => undefined);
            continue;
          }
          const outcome = await pullSink(sink, token).catch((error) => {
            logger.warn(
              {
                addon: sink.addonName,
                err: error instanceof Error ? error.message : String(error),
              },
              'watch state read failed'
            );
            return EMPTY;
          });
          totals.sinks++;
          totals.items += outcome.items;
          totals.watched += outcome.watched;
          totals.removed += outcome.removed;
        }
      }
    )
  );
  return totals;
}

/**
 * Never awaited by a shelf: a slow addon must not delay one.
 *
 * The claim is the staleness check; see {@link PlaybackHandoffRepository.claimPullSink}.
 */
export function refreshSinkIfStale(sink: SinkRow): void {
  if (!appConfig.watchState.pullEnabled || !sink.pullUrl) return;
  const token = `${TaskManager.instanceId}:${randomUUID()}`;
  const now = Date.now();
  const staleBefore = now - appConfig.watchState.pullTtlSeconds * 1000;
  void (async () => {
    const claimed = await PlaybackHandoffRepository.claimPullSink(
      sink.id,
      token,
      now,
      pullLeaseMs(),
      staleBefore
    );
    if (!claimed) return;
    await pullSink(sink, token);
  })().catch(() => undefined);
}
