import { z } from 'zod';
import {
  Cache,
  DistributedLock,
  appConfig,
  createLogger,
  makeRequest,
} from '../utils/index.js';
import { instanceId } from '../stream-sessions/index.js';

const logger = createLogger('remuxdb');

const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().nullable().optional();

export const ProbeSourceSchema = z.looseObject({
  kind: z.string(),
  filename: nullableString,
  indexer: nullableString,
  indexer_guid: nullableString,
  torrent_info_hash: nullableString,
  torrent_file_idx: nullableNumber,
});
export type ProbeSource = z.infer<typeof ProbeSourceSchema>;

export const TrackDetailSchema = z.looseObject({
  kind: z.string(),
  idx: z.number(),
  is_default: z.boolean(),
  is_forced: z.boolean(),
  is_hearing_impaired: z.boolean(),
  is_external: z.boolean(),
  is_anamorphic: z.boolean(),
  hdr10_plus_present: z.boolean(),
  codec: nullableString,
  language: nullableString,
  title: nullableString,
  bit_rate: nullableNumber,
  bit_depth: nullableNumber,
  pixel_format: nullableString,
  profile: nullableString,
  level: nullableNumber,
  ref_frames: nullableNumber,
  width: nullableNumber,
  height: nullableNumber,
  fps: nullableNumber,
  aspect_ratio: nullableString,
  color_primaries: nullableString,
  color_range: nullableString,
  color_space: nullableString,
  color_transfer: nullableString,
  dv_profile: nullableNumber,
  channels: nullableNumber,
  sample_rate: nullableNumber,
  channel_layout: nullableString,
});
export type TrackDetail = z.infer<typeof TrackDetailSchema>;

export const MediaProbeVersionSchema = z
  .looseObject({
    content_hash: nullableString,
    container: nullableString,
    duration: nullableNumber,
    size: nullableNumber,
    bitrate: nullableNumber,
    virtual_chapters: z.boolean().optional(),
    chapters: z.array(z.unknown()).optional(),
    sources: z.array(ProbeSourceSchema),
    tracks: z.array(TrackDetailSchema),
  })
  // Only chapter presence is used, and the lists bloat the cache.
  .transform(({ chapters, ...version }) => ({
    ...version,
    has_chapters: (chapters?.length ?? 0) > 0,
  }));
export type MediaProbeVersion = z.infer<typeof MediaProbeVersionSchema>;

const probeCache = Cache.getInstance<string, MediaProbeVersion[]>(
  'remuxdb:probe'
);
const bgRefreshCache = Cache.getInstance<string, number>('remuxdb:bg-refresh');

function cacheKey(imdbId: string, season?: number, episode?: number): string {
  return `${imdbId}:${season ?? ''}:${episode ?? ''}`;
}

async function cacheVersions(
  key: string,
  versions: MediaProbeVersion[] | null
): Promise<void> {
  await probeCache.set(
    key,
    versions ?? [],
    versions === null
      ? appConfig.remuxdb.errorCacheTtl
      : versions.length > 0
        ? appConfig.remuxdb.cacheTtl
        : appConfig.remuxdb.negativeCacheTtl
  );
}

function triggerBackgroundRefresh(
  key: string,
  imdbId: string,
  season?: number,
  episode?: number
): void {
  (async () => {
    const intervalS = appConfig.remuxdb.minimumBackgroundRefreshInterval;
    const lastRefresh = await bgRefreshCache.get(key);
    if (lastRefresh && Date.now() - lastRefresh < intervalS * 1000) return;
    await bgRefreshCache.set(key, Date.now(), intervalS);

    const versions = await fetchFromApi(imdbId, season, episode);
    // A failed or empty refresh never replaces what's cached.
    if (versions?.length) await cacheVersions(key, versions);
  })().catch((error) =>
    logger.debug(`remuxdb background refresh failed for ${key}: ${error}`)
  );
}

export async function fetchProbeVersions(
  imdbId: string,
  season?: number,
  episode?: number
): Promise<MediaProbeVersion[]> {
  const key = cacheKey(imdbId, season, episode);
  const cached = await probeCache.get(key);
  if (cached !== undefined) {
    triggerBackgroundRefresh(key, imdbId, season, episode);
    return cached;
  }

  const versions = await fetchFromApi(imdbId, season, episode);
  await cacheVersions(key, versions);
  return versions ?? [];
}

/** Failure is `null`, not `undefined`: a memory-lock waiter that arrives late treats `undefined` as still pending. */
async function fetchFromApi(
  imdbId: string,
  season?: number,
  episode?: number
): Promise<MediaProbeVersion[] | null> {
  const { result } = await DistributedLock.getInstance().withLock(
    `remuxdb:fetch:${cacheKey(imdbId, season, episode)}`,
    () => _fetchFromApi(imdbId, season, episode),
    { type: 'memory' }
  );
  return result;
}

async function _fetchFromApi(
  imdbId: string,
  season?: number,
  episode?: number
): Promise<MediaProbeVersion[] | null> {
  try {
    const url = new URL(`${appConfig.remuxdb.baseUrl}/api/media/info`);
    url.searchParams.set('imdb_id', imdbId);
    if (season !== undefined) url.searchParams.set('season', String(season));
    if (episode !== undefined) url.searchParams.set('episode', String(episode));

    const response = await makeRequest(url.toString(), {
      method: 'GET',
      timeout: 5000,
      headers: { 'x-client-id': instanceId() },
    });
    if (!response.ok) {
      logger.debug(`remuxdb lookup for ${imdbId} returned ${response.status}`);
      return null;
    }
    return z.array(MediaProbeVersionSchema).parse(await response.json());
  } catch (error) {
    logger.debug(`remuxdb lookup failed for ${imdbId}: ${error}`);
    return null;
  }
}
