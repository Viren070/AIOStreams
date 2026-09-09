import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import { AnimeDatabase } from '../../anime-database/index.js';
import { PlaybackHandoffRepository } from '../../db/repositories/playback-handoff.js';
import type { IdType } from '../../utils/id-parser.js';
import { SINK_PROBE_MS } from './deliver.js';
import { pullUrlFor, pushUrlFor } from './resolve.js';
import type { PlaybackEventKind } from './capability.js';
import type { AnimeEntryMappings } from '../../anime-database/types.js';
import type { ResolvedPlaybackSink } from './resolve.js';
import type { WatchScope } from '../types.js';

const logger = createLogger('playback-handoff');

const MAX_PENDING_PER_SINK = 2000;

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
  event: PlaybackEventInput
): Promise<Record<string, string>> {
  if (ANIME_MAPPED.every(([, key]) => ids[key])) return ids;
  const source = ANIME_LOOKUP.find(([key]) => ids[key]);
  if (!source) return ids;
  try {
    const entry = await AnimeDatabase.getInstance().getEntryById(
      source[1],
      ids[source[0]],
      event.season ?? undefined,
      event.episode ?? undefined
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
  event: PlaybackEventInput
): boolean {
  if (!sink.events.has(event.kind)) return false;
  if (sink.types.length && !sink.types.includes(event.type)) return false;
  if (
    sink.idPrefixes?.length &&
    !sink.idPrefixes.some(
      (prefix) =>
        event.videoId.startsWith(prefix) || event.baseId.startsWith(prefix)
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Persists the declared routing so a job with no request in hand can reach the
 * addon. Called from the read path too, which otherwise never creates a row.
 */
export async function ensurePlaybackSink(
  scope: WatchScope,
  sink: ResolvedPlaybackSink
) {
  return PlaybackHandoffRepository.ensureSink(scope, {
    addonInstanceId: sink.instanceId,
    addonName: sink.name,
    baseUrl: sink.baseUrl,
    pullUrl: pullUrlFor(sink),
    query: sink.query,
    events: [...sink.events],
    types: sink.types,
    idPrefixes: sink.idPrefixes ?? null,
  });
}

export async function dispatchPlayback(
  scope: WatchScope,
  sinks: ResolvedPlaybackSink[],
  event: PlaybackEventInput
): Promise<void> {
  if (!appConfig.watchState.reportEnabled || !sinks.length) return;

  const at = event.at ?? Date.now();
  const ids = await fillAnimeIds(externalIds(event.providerIds), event);
  const idempotencyKey = idempotencyKeyFor(event, at);

  for (const sink of sinks) {
    if (!matchesSink(sink, event)) continue;
    try {
      const row = await ensurePlaybackSink(scope, sink);
      // auth_expired keeps queuing; a failing sink only past its probe window.
      if (row.status === 'error' && Date.now() - row.updatedAt < SINK_PROBE_MS)
        continue;

      const url = pushUrlFor(sink, event.type, event.videoId);

      const body = JSON.stringify({
        id: idempotencyKey,
        event: event.kind,
        at: Math.floor(at / 1000),
        metaId: event.baseId,
        videoId: event.videoId,
        ...(event.positionMs != null ? { positionMs: event.positionMs } : {}),
        ...(event.durationMs ? { durationMs: event.durationMs } : {}),
        ...(event.played != null ? { played: event.played } : {}),
        ...(event.season != null ? { season: event.season } : {}),
        ...(event.episode != null ? { episode: event.episode } : {}),
        ...(Object.keys(ids).length ? { ids } : {}),
      });

      const queued = await PlaybackHandoffRepository.enqueue({
        sinkId: row.id,
        idempotencyKey,
        event: event.kind,
        itemKey: event.itemKey,
        url,
        body,
      });
      if (!queued) continue;

      if (
        (await PlaybackHandoffRepository.countPending(row.id)) >
        MAX_PENDING_PER_SINK
      ) {
        const dropped = await PlaybackHandoffRepository.trimPending(
          row.id,
          MAX_PENDING_PER_SINK
        );
        if (dropped)
          logger.warn(
            { addon: sink.name, dropped },
            'playback delivery queue full, dropped the oldest events'
          );
      }
    } catch (error) {
      logger.warn(
        {
          addon: sink.name,
          event: event.kind,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to queue playback event'
      );
    }
  }
}
