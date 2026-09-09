import { z } from 'zod';
import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import { makeRequest } from '../../utils/http.js';
import {
  PlaybackHandoffRepository,
  type SinkRow,
} from '../../db/repositories/playback-handoff.js';
import {
  WatchStateRepository,
  type WatchIdentity,
  type WatchStateRow,
} from '../../db/repositories/watch-state.js';
import { scopeOf, seriesKeyOf, type WatchScope } from '../types.js';

const logger = createLogger('playback-pull');

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_SINKS_PER_RUN = 50;

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

const PlaybackStateSchema = z.looseObject({
  version: z.string().optional(),
  items: z.array(StateItemSchema).optional(),
  watched: StateWatchedSchema.optional(),
});

export type PlaybackStatePayload = z.infer<typeof PlaybackStateSchema>;

export interface PullOutcome {
  /** The addon's version matched ours, so the watched half was not re-read. */
  unchanged: boolean;
  items: number;
  watched: number;
  removed: number;
  skipped: number;
}

const EMPTY: PullOutcome = {
  unchanged: true,
  items: 0,
  watched: 0,
  removed: 0,
  skipped: 0,
};

/** Seconds or milliseconds; the contract says seconds but be forgiving. */
function atMs(at: number | undefined, fallback: number): number {
  if (!at || !Number.isFinite(at)) return fallback;
  return at > 1e11 ? at : at * 1000;
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
    (item.durationMs && item.durationMs > 0 ? item.durationMs : 0) ||
    existing?.durationMs ||
    0;

  if (item.positionMs != null && item.positionMs > 0) {
    return { positionMs: item.positionMs, durationMs };
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

async function importItems(
  scope: WatchScope,
  sink: SinkRow,
  items: z.infer<typeof StateItemSchema>[],
  now: number
): Promise<{ written: number; skipped: number }> {
  if (!items.length) return { written: 0, skipped: 0 };

  const keys = items.map((i) =>
    i.episode != null || splitVideoId(i.videoId).episode != null
      ? episodeKeyOf(i.videoId)
      : `m|${i.metaId}`
  );
  const existingRows = await WatchStateRepository.getMany(scope, keys);

  let written = 0;
  let skipped = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = keys[i];
    const existing = existingRows.get(key);
    const at = atMs(item.at, now);

    if (!mayImport(existing, at, now)) {
      skipped++;
      continue;
    }

    const isEpisode = key.startsWith('e|');
    const split = splitVideoId(item.videoId);
    const identity = identityFrom(item.videoId, {
      kind: isEpisode ? 'episode' : 'movie',
      // The addon's own type where it gave one, otherwise what we already had.
      type:
        item.type || existing?.mediaType || (isEpisode ? 'series' : 'movie'),
      metaId: item.metaId,
      season: item.season !== undefined ? item.season : split.season,
      episode: item.episode !== undefined ? item.episode : split.episode,
    });

    const position = positionOf(item, existing);
    const played =
      item.played === true ||
      (!!position &&
        position.durationMs > 0 &&
        position.positionMs >= position.durationMs * PLAYED_FRACTION);

    if (!played && !position) {
      skipped++;
      continue;
    }

    const tooEarly =
      !!position &&
      position.durationMs > 0 &&
      position.positionMs < position.durationMs * RESUME_MIN_FRACTION;

    await WatchStateRepository.upsert(scope, identity, {
      positionMs: played || tooEarly ? 0 : position?.positionMs,
      durationMs: position?.durationMs || undefined,
      played,
      lastPlayedAt: at,
      origin: 'import',
      sinkId: sink.id,
      externalAt: at,
    });
    written++;
  }
  return { written, skipped };
}

async function importWatched(
  scope: WatchScope,
  sink: SinkRow,
  watched: z.infer<typeof StateWatchedSchema>,
  now: number
): Promise<{ written: number; skipped: number }> {
  const movies = watched.movies ?? [];
  const episodes = watched.episodes ?? [];
  const nextUp = watched.nextUp ?? [];

  // Next-up rows name their show's type, which the bare id lists cannot.
  const typeByMeta = new Map<string, string>();
  for (const row of nextUp) {
    if (row.type) typeByMeta.set(row.metaId, row.type);
  }

  const keys = [
    ...movies.map((id) => `m|${id}`),
    ...episodes.map(episodeKeyOf),
  ];
  const existingRows = await WatchStateRepository.getMany(scope, keys);

  let written = 0;
  let skipped = 0;

  const write = async (identity: WatchIdentity, existing?: WatchStateRow) => {
    if (!mayImport(existing, now, now)) {
      skipped++;
      return;
    }
    await WatchStateRepository.upsert(scope, identity, {
      positionMs: 0,
      played: true,
      incrementPlayCount: 'if-unplayed',
      // No per-title timestamp here, so an existing one is kept.
      lastPlayedAt: existing?.lastPlayedAt ?? now,
      origin: 'import',
      sinkId: sink.id,
      externalAt: now,
    });
    written++;
  };

  for (const id of movies) {
    const key = `m|${id}`;
    const existing = existingRows.get(key);
    await write(
      identityFrom(id, {
        kind: 'movie',
        type: typeByMeta.get(id) || existing?.mediaType || 'movie',
        metaId: id,
      }),
      existing
    );
  }

  for (const videoId of episodes) {
    const key = episodeKeyOf(videoId);
    const existing = existingRows.get(key);
    const split = splitVideoId(videoId);
    await write(
      identityFrom(videoId, {
        kind: 'episode',
        type: typeByMeta.get(split.metaId) || existing?.mediaType || 'series',
        metaId: split.metaId,
        season: split.season,
        episode: split.episode,
      }),
      existing
    );
  }

  return { written, skipped };
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

  const parsed = PlaybackStateSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error('unreadable state payload');
  return parsed.data;
}

/**
 * `watched` is a complete set when present, so an absent block and an empty one
 * mean different things: absent changes nothing, empty clears every imported row.
 */
export async function pullSink(sink: SinkRow): Promise<PullOutcome> {
  if (!appConfig.watchState.pullEnabled || !sink.pullUrl) return EMPTY;

  const now = Date.now();
  let payload: PlaybackStatePayload | null;
  try {
    payload = await fetchState(sink);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await PlaybackHandoffRepository.recordPull(sink.id, now, {
      error: message,
    });
    logger.warn(
      { addon: sink.addonName, err: message },
      'failed to read watch state from addon'
    );
    return EMPTY;
  }
  if (!payload) return EMPTY;

  const scope = scopeOf(sink);
  const items = await importItems(scope, sink, payload.items ?? [], now);

  // Always complete, so anything it stopped reporting goes now.
  let removed = await WatchStateRepository.deleteStaleImports(
    scope,
    sink.id,
    now,
    'resume'
  );

  let watchedWritten = 0;
  let watchedSkipped = 0;
  const unchanged = !payload.watched;

  if (payload.watched) {
    const res = await importWatched(scope, sink, payload.watched, now);
    watchedWritten = res.written;
    watchedSkipped = res.skipped;
    removed += await WatchStateRepository.deleteStaleImports(
      scope,
      sink.id,
      now,
      'watched'
    );
  }

  await PlaybackHandoffRepository.recordPull(sink.id, now, {
    version: payload.version ?? null,
  });

  const outcome: PullOutcome = {
    unchanged,
    items: items.written,
    watched: watchedWritten,
    removed,
    skipped: items.skipped + watchedSkipped,
  };
  if (outcome.items || outcome.watched || outcome.removed) {
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

  const staleBefore =
    Date.now() - appConfig.watchState.pullIntervalSeconds * 1000;
  const sinks = await PlaybackHandoffRepository.listPullable(
    staleBefore,
    MAX_SINKS_PER_RUN
  );

  for (const sink of sinks) {
    const outcome = await pullSink(sink).catch((error) => {
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
  return totals;
}

/** Never awaited by a shelf: a slow addon must not delay one. */
export function refreshSinkIfStale(sink: SinkRow): void {
  if (!appConfig.watchState.pullEnabled || !sink.pullUrl) return;
  const ttlMs = appConfig.watchState.pullTtlSeconds * 1000;
  if (sink.lastPullAt && Date.now() - sink.lastPullAt < ttlMs) return;
  void pullSink(sink).catch(() => undefined);
}
