import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import { AnimeDatabase } from '../../anime-database/index.js';
import {
  PlaybackHandoffRepository,
  type QueuedEvent,
  type SinkRow,
} from '../../db/repositories/playback-handoff.js';
import { getSimpleTextHash } from '../../utils/crypto.js';
import type { IdType } from '../../utils/id-parser.js';
import { sinkProbeMs } from './deliver.js';
import { pullUrlFor, pushUrlFor, uniqueByAddress } from './resolve.js';
import {
  PLAYBACK_EVENTS,
  WATCHLIST_EVENTS,
  type PlaybackEventKind,
} from './capability.js';
import type { AnimeEntryMappings } from '../../anime-database/types.js';
import type { ResolvedPlaybackSink } from './resolve.js';
import type { WatchScope } from '../types.js';

const logger = createLogger('playback-handoff');

/**
 * Transitions key on position, not a clock bucket, so a pause and the resume
 * after it stay two events. A mark has no position and keys on its timestamp.
 */
function idempotencyKeyFor(event: PlaybackEventInput, at: number): string {
  const suffix =
    event.kind === 'played' || event.kind === 'unplayed'
      ? at
      : Math.round(event.positionMs ?? 0);
  return `${event.itemKey}|${event.kind}|${suffix}`;
}

/** Jellyfin `ProviderIds` keys -> what a tracker addon expects to read. */
const ID_KEYS: Record<string, string> = {
  Imdb: 'imdb',
  Tmdb: 'tmdb',
  Tvdb: 'tvdb',
  Kitsu: 'kitsu',
  MyAnimeList: 'mal',
  AniList: 'anilist',
  AniDB: 'anidb',
  Simkl: 'simkl',
  Trakt: 'trakt',
};

export interface PlaybackEventInput {
  kind: PlaybackEventKind;
  /** Stremio type of the item, as the addon declared its `types`. */
  type: string;
  videoId: string;
  /**
   * The meta the video belongs to. A meta's videos may use a different id space
   * from its own id, so both are reported and either may match a prefix.
   */
  baseId: string;
  /** Content identity, used to collapse duplicate reports. */
  itemKey: string;
  season?: number | null;
  episode?: number | null;
  at?: number;
  positionMs?: number;
  durationMs?: number;
  /** Our threshold decision, so the addon does not re-derive it. */
  played?: boolean;
  providerIds?: Record<string, string>;
}

function externalIds(
  providerIds: Record<string, string> | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(providerIds ?? {})) {
    const mapped = ID_KEYS[key];
    if (mapped && value) out[mapped] = value;
  }
  return out;
}

/** Which id to look the entry up by, best first. */
const ANIME_LOOKUP: [string, IdType][] = [
  ['kitsu', 'kitsuId'],
  ['mal', 'malId'],
  ['anilist', 'anilistId'],
  ['anidb', 'anidbId'],
  ['imdb', 'imdbId'],
  ['tmdb', 'themoviedbId'],
  ['tvdb', 'thetvdbId'],
];

const ANIME_MAPPED: [keyof AnimeEntryMappings, string][] = [
  ['malId', 'mal'],
  ['kitsuId', 'kitsu'],
  ['anilistId', 'anilist'],
  ['anidbId', 'anidb'],
  ['imdbId', 'imdb'],
  ['themoviedbId', 'tmdb'],
  ['thetvdbId', 'tvdb'],
];

/** Fills gaps from the anime database. */
async function fillAnimeIds(
  ids: Record<string, string>,
  season?: number | null,
  episode?: number | null
): Promise<Record<string, string>> {
  if (ANIME_MAPPED.every(([, key]) => ids[key])) return ids;
  const source = ANIME_LOOKUP.find(([key]) => ids[key]);
  if (!source) return ids;
  try {
    const entry = await AnimeDatabase.getInstance().getEntryById(
      source[1],
      ids[source[0]],
      season ?? undefined,
      episode ?? undefined
    );
    for (const [field, key] of ANIME_MAPPED) {
      const value = entry?.mappings?.[field];
      if (value != null && value !== '' && !ids[key]) ids[key] = String(value);
    }
  } catch (error) {
    logger.debug(
      { err: error instanceof Error ? error.message : String(error) },
      'anime id lookup failed'
    );
  }
  return ids;
}

function matchesSink(
  sink: ResolvedPlaybackSink,
  kind: PlaybackEventKind,
  type: string,
  ids: string[]
): boolean {
  if (!sink.events.includes(kind)) return false;
  if (sink.types.length && !sink.types.includes(type)) return false;
  const prefixes = sink.idPrefixes;
  if (
    prefixes?.length &&
    !ids.some((id) => prefixes.some((prefix) => id.startsWith(prefix)))
  ) {
    return false;
  }
  return true;
}

/**
 * Rows seen recently, so an unchanged sink costs no statements.
 *
 * Bounded and cleared wholesale; a lost entry costs one extra read.
 */
const sinkRows = new Map<string, { row: SinkRow; at: number }>();
const SINK_ROW_TTL_MS = 5 * 60_000;
const SINK_ROWS_MAX = 20_000;
/** How often a sink's `active_at` is refreshed while it keeps being used. */
const ACTIVE_WINDOW_MS = 60 * 60_000;

/** Everything a stored row has to agree with before a write can be skipped. */
function routingHashOf(sink: ResolvedPlaybackSink): string {
  return getSimpleTextHash(
    JSON.stringify([
      sink.name,
      sink.baseUrl,
      pullUrlFor(sink),
      sink.query,
      [...sink.events].sort(),
      [...sink.types].sort(),
      sink.idPrefixes ? [...sink.idPrefixes].sort() : null,
    ])
  );
}

/**
 * Persists the declared routing so a job with no request in hand can reach the
 * addon. Called from the read path too, which otherwise never creates a row.
 */
export async function ensurePlaybackSink(
  scope: WatchScope,
  sink: ResolvedPlaybackSink
): Promise<SinkRow> {
  const key = `${scope.uuid}|${scope.persona}|${sink.instanceId}`;
  const hash = routingHashOf(sink);
  const now = Date.now();

  // Writing a retired row revives it.
  const cached = sinkRows.get(key);
  if (
    cached &&
    cached.row.routingHash === hash &&
    cached.row.retiredAt == null &&
    now - cached.at < SINK_ROW_TTL_MS
  ) {
    void touchActive(cached.row, now);
    return cached.row;
  }

  const existing = await PlaybackHandoffRepository.getSinkByAddon(
    scope,
    sink.instanceId
  );
  if (existing && existing.routingHash === hash && existing.retiredAt == null) {
    remember(key, existing, now);
    void touchActive(existing, now);
    return existing;
  }

  const row = await PlaybackHandoffRepository.ensureSink(scope, {
    addonInstanceId: sink.instanceId,
    addonName: sink.name,
    baseUrl: sink.baseUrl,
    pullUrl: pullUrlFor(sink),
    query: sink.query,
    events: [...sink.events],
    types: sink.types,
    idPrefixes: sink.idPrefixes ?? null,
    routingHash: hash,
  });
  remember(key, row, now);
  void touchActive(row, now);
  return row;
}

/** Forgets remembered rows too, or reviving a retired sink would skip its write. */
export async function retireUnusedSinks(
  scope: WatchScope,
  keep: readonly string[]
): Promise<void> {
  const prefix = `${scope.uuid}|${scope.persona}|`;
  for (const key of sinkRows.keys()) {
    if (key.startsWith(prefix) && !keep.includes(key.slice(prefix.length)))
      sinkRows.delete(key);
  }
  await PlaybackHandoffRepository.retireSinksExcept(scope, keep, Date.now());
}

export async function retireOtherPersonaSinks(
  uuid: string,
  keepPersonaIds: readonly string[]
): Promise<void> {
  for (const key of sinkRows.keys()) {
    const [owner, persona] = key.split('|');
    if (owner === uuid && persona && !keepPersonaIds.includes(persona))
      sinkRows.delete(key);
  }
  await PlaybackHandoffRepository.retireOtherPersonas(
    uuid,
    keepPersonaIds,
    Date.now()
  );
}

function remember(key: string, row: SinkRow, at: number): void {
  if (sinkRows.size >= SINK_ROWS_MAX) sinkRows.clear();
  sinkRows.set(key, { row, at });
}

function touchActive(row: SinkRow, now: number): Promise<void> {
  if (now - row.activeAt < ACTIVE_WINDOW_MS) return Promise.resolve();
  row.activeAt = now;
  return PlaybackHandoffRepository.touchActive(
    row.id,
    now,
    ACTIVE_WINDOW_MS
  ).catch(() => undefined);
}

/*
 * Pending rows per sink, tracked locally: the real COUNT runs once per sink
 * to seed the tally, then only when the tally says the cap is in reach.
 */
const pendingGuess = new Map<string, number>();
const PENDING_GUESS_MAX = 20_000;

async function enforcePendingCap(
  sinkId: string,
  addon: string,
  added: number
): Promise<void> {
  const cap = appConfig.watchState.deliveryMaxPendingPerSink;
  let guess = pendingGuess.get(sinkId);
  if (guess === undefined) {
    guess = await PlaybackHandoffRepository.countPending(sinkId);
    if (pendingGuess.size >= PENDING_GUESS_MAX) pendingGuess.clear();
  } else {
    guess += added;
  }
  if (guess <= cap) {
    pendingGuess.set(sinkId, guess);
    return;
  }
  // Other replicas have been draining the same queue, so confirm before cutting.
  const actual = await PlaybackHandoffRepository.countPending(sinkId);
  pendingGuess.set(sinkId, Math.min(actual, cap));
  if (actual <= cap) return;
  const dropped = await PlaybackHandoffRepository.trimPending(sinkId, cap);
  if (dropped) {
    logger.warn(
      { addon, dropped },
      'playback delivery queue full, dropped the oldest events'
    );
  }
}

/** Playback and single marks are delivered ahead of anything a bulk mark queued. */
const SINGLE_LANE = 0;
const BULK_LANE = 1;

const BULK_PART_SIZE = 500;

/**
 * A mark is the final word on an item, a transition supersedes the transitions
 * before it, and a finished stop settles any mark still waiting.
 */
function replacesFor(
  kind: PlaybackEventKind,
  played?: boolean
): readonly PlaybackEventKind[] {
  switch (kind) {
    case 'played':
    case 'unplayed':
      return PLAYBACK_EVENTS;
    case 'watchlisted':
    case 'unwatchlisted':
      return WATCHLIST_EVENTS;
    case 'start':
    case 'pause':
      return ['start', 'pause'];
    case 'stop':
      return played ? ['played', 'unplayed'] : [];
  }
}

function singleEvent(
  sink: ResolvedPlaybackSink,
  event: PlaybackEventInput,
  at: number,
  ids: Record<string, string>,
  priority: number
): QueuedEvent {
  const idempotencyKey = idempotencyKeyFor(event, at);
  const scope = event.itemKey.startsWith('e|')
    ? 'episode'
    : event.itemKey.startsWith('m|')
      ? 'movie'
      : undefined;
  return {
    idempotencyKey,
    event: event.kind,
    itemKey: event.itemKey,
    url: pushUrlFor(sink, event.type, event.videoId),
    body: JSON.stringify({
      id: idempotencyKey,
      event: event.kind,
      ...(scope ? { scope } : {}),
      at: Math.floor(at / 1000),
      metaId: event.baseId,
      videoId: event.videoId,
      ...(event.positionMs != null ? { positionMs: event.positionMs } : {}),
      ...(event.durationMs ? { durationMs: event.durationMs } : {}),
      ...(event.played != null ? { played: event.played } : {}),
      ...(event.season != null ? { season: event.season } : {}),
      ...(event.episode != null ? { episode: event.episode } : {}),
      ...(Object.keys(ids).length ? { ids } : {}),
    }),
    priority,
    replaces: replacesFor(event.kind, event.played),
  };
}

async function queueToSinks(
  scope: WatchScope,
  sinks: ResolvedPlaybackSink[],
  kind: PlaybackEventKind,
  matches: (sink: ResolvedPlaybackSink) => boolean,
  build: (sink: ResolvedPlaybackSink) => Promise<QueuedEvent[]>
): Promise<void> {
  for (const sink of uniqueByAddress(sinks)) {
    if (!matches(sink)) continue;
    try {
      const row = await ensurePlaybackSink(scope, sink);
      /*
       * auth_expired keeps queuing; a failing sink only past its probe window.
       * Measured from `status_at`: `updated_at` moves whenever the row is
       * written, which would keep the window from ever elapsing.
       */
      if (row.status === 'error' && Date.now() - row.statusAt < sinkProbeMs())
        continue;

      const added = await PlaybackHandoffRepository.enqueueMany(
        row.id,
        await build(sink)
      );
      if (added) await enforcePendingCap(row.id, sink.name, added);
    } catch (error) {
      logger.warn(
        {
          addon: sink.name,
          event: kind,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to queue playback event'
      );
    }
  }
}

export async function dispatchPlayback(
  scope: WatchScope,
  sinks: ResolvedPlaybackSink[],
  event: PlaybackEventInput
): Promise<void> {
  if (!appConfig.watchState.reportEnabled || !sinks.length) return;

  const at = event.at ?? Date.now();
  const ids = await fillAnimeIds(
    externalIds(event.providerIds),
    event.season,
    event.episode
  );

  await queueToSinks(
    scope,
    sinks,
    event.kind,
    (sink) =>
      matchesSink(sink, event.kind, event.type, [event.videoId, event.baseId]),
    async (sink) => [singleEvent(sink, event, at, ids, SINGLE_LANE)]
  );
}

export interface BulkMarkInput {
  kind: 'played' | 'unplayed';
  type: string;
  /** The show the mark was made on, which is the bulk request's path id. */
  metaId: string;
  scope: 'series' | 'season';
  /** The season marked when `scope` is `season`. */
  season: number | null;
  videos: {
    videoId: string;
    season: number | null;
    episode: number | null;
    itemKey: string;
  }[];
  providerIds?: Record<string, string>;
}

/** An addon that declares `bulk` gets the mark in parts; any other gets one event per video. */
export async function dispatchBulkMark(
  scope: WatchScope,
  sinks: ResolvedPlaybackSink[],
  mark: BulkMarkInput
): Promise<void> {
  if (!appConfig.watchState.reportEnabled) return;
  if (!sinks.length || !mark.videos.length) return;

  const at = Date.now();
  const ids = await fillAnimeIds(externalIds(mark.providerIds));
  const videoIds = mark.videos.map((v) => v.videoId);
  const target =
    mark.season == null ? mark.metaId : `${mark.metaId}:${mark.season}`;

  await queueToSinks(
    scope,
    sinks,
    mark.kind,
    (sink) =>
      matchesSink(sink, mark.kind, mark.type, [mark.metaId, ...videoIds]),
    async (sink) => {
      if (!sink.bulk) {
        const events: QueuedEvent[] = [];
        for (const video of mark.videos) {
          const event: PlaybackEventInput = {
            kind: mark.kind,
            type: mark.type,
            videoId: video.videoId,
            baseId: mark.metaId,
            itemKey: video.itemKey,
            season: video.season,
            episode: video.episode,
            played: mark.kind === 'played',
          };
          const own = await fillAnimeIds(
            externalIds(mark.providerIds),
            video.season,
            video.episode
          );
          events.push(singleEvent(sink, event, at, own, BULK_LANE));
        }
        return events;
      }

      const parts: BulkMarkInput['videos'][] = [];
      for (let i = 0; i < mark.videos.length; i += BULK_PART_SIZE)
        parts.push(mark.videos.slice(i, i + BULK_PART_SIZE));
      return parts.map((videos, i) => {
        const idempotencyKey = `b|${target}|${mark.kind}|${at}|${i + 1}`;
        return {
          idempotencyKey,
          event: mark.kind,
          itemKey: `b|${target}`,
          url: pushUrlFor(sink, mark.type, mark.metaId),
          body: JSON.stringify({
            id: idempotencyKey,
            event: mark.kind,
            scope: mark.scope,
            at: Math.floor(at / 1000),
            metaId: mark.metaId,
            season: mark.season,
            videos: videos.map(({ videoId, season, episode }) => ({
              videoId,
              season,
              episode,
            })),
            part: i + 1,
            parts: parts.length,
            ...(Object.keys(ids).length ? { ids } : {}),
          }),
          priority: BULK_LANE,
          covers: videos.map((v) => v.itemKey),
          replaces: PLAYBACK_EVENTS,
        };
      });
    }
  );
}

export interface WatchlistChangeInput {
  kind: 'watchlisted' | 'unwatchlisted';
  type: string;
  metaId: string;
  itemKey: string;
  providerIds?: Record<string, string>;
}

export async function dispatchWatchlist(
  scope: WatchScope,
  sinks: ResolvedPlaybackSink[],
  change: WatchlistChangeInput
): Promise<void> {
  if (!appConfig.watchState.reportEnabled || !sinks.length) return;

  const at = Date.now();
  const ids = await fillAnimeIds(externalIds(change.providerIds));
  const idempotencyKey = `w|${change.itemKey}|${change.kind}|${at}`;

  await queueToSinks(
    scope,
    sinks,
    change.kind,
    (sink) => matchesSink(sink, change.kind, change.type, [change.metaId]),
    async (sink) => [
      {
        idempotencyKey,
        event: change.kind,
        itemKey: change.itemKey,
        url: pushUrlFor(sink, change.type, change.metaId),
        body: JSON.stringify({
          id: idempotencyKey,
          event: change.kind,
          scope: change.itemKey.startsWith('m|') ? 'movie' : 'series',
          at: Math.floor(at / 1000),
          metaId: change.metaId,
          ...(Object.keys(ids).length ? { ids } : {}),
        }),
        priority: SINGLE_LANE,
        replaces: WATCHLIST_EVENTS,
      },
    ]
  );
}
