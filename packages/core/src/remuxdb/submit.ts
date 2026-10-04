import { appConfig, createLogger, makeRequest } from '../utils/index.js';
import { instanceId } from '../stream-sessions/index.js';
import type { MediaTrack } from '../media-info/record.js';
import type {
  ContributedSource,
  Contribution,
  ContributionTarget,
} from '../media-info/contribute.js';
import { extractNzbGuid, resolveRemuxDbIndexer } from './adapter.js';
import {
  fetchProbeVersions,
  invalidateProbeVersions,
  type ProbeSource,
} from './client.js';

const logger = createLogger('remuxdb');

function toTrackPayload(track: MediaTrack) {
  const common = {
    idx: track.index,
    codec: track.codec,
    bit_rate: track.bitrate,
    profile: track.profile,
    title: track.title,
    language: track.language,
    is_default: !!track.default,
    is_forced: !!track.forced,
    is_hearing_impaired: !!track.hearingImpaired,
    is_external: false,
  };
  switch (track.type) {
    case 'video':
      return {
        ...common,
        kind: 'video',
        codec: track.codec ?? '',
        codec_tag: track.codecTag,
        width: track.width ?? 0,
        height: track.height ?? 0,
        fps: track.fps,
        avg_fps: track.avgFps,
        bit_depth: track.bitDepth,
        pixel_format: track.pixelFormat,
        color_primaries: track.colorPrimaries,
        color_range: track.colorRange,
        color_space: track.colorSpace,
        color_transfer: track.colorTransfer,
        aspect_ratio: track.aspectRatio,
        level: track.level,
        ref_frames: track.refFrames,
        is_interlaced: track.interlaced,
        hdr10_plus_present: !!track.hdr10Plus,
        dv_profile: track.dvProfile,
        dv_level: track.dvLevel,
      };
    case 'audio':
      return {
        ...common,
        kind: 'audio',
        codec: track.codec ?? '',
        channels: track.channels ?? 0,
        sample_rate: track.sampleRate ?? 0,
        channel_layout: track.channelLayout,
      };
    case 'subtitle':
      return { ...common, kind: 'subtitle' };
  }
}

const baseName = (path: string) => path.split('/').pop()?.toLowerCase();

/** The submission's source fields, or nothing when RemuxDB can't name it. */
function sourcePayload(
  source: ContributedSource,
  filename: string
): {
  body: Record<string, unknown>;
  known(sources: ProbeSource[]): boolean;
} | null {
  if (source.kind === 'torrent') {
    const hash = source.infoHash.toLowerCase();
    // RemuxDB matches on the file name; an index is per service, so none is sent.
    return {
      body: { torrent_info_hash: hash },
      known: (sources) =>
        sources.some(
          (s) =>
            s.torrent_info_hash?.toLowerCase() === hash &&
            !!s.filename &&
            baseName(s.filename) === baseName(filename)
        ),
    };
  }
  const indexer = resolveRemuxDbIndexer(source.nzbUrl);
  const guid = extractNzbGuid(source.nzbUrl);
  if (!indexer || !guid) return null;
  return {
    body: { nzb: { indexer, indexer_guid: guid, title: filename } },
    known: (sources) =>
      sources.some((s) => s.indexer === indexer && s.indexer_guid === guid),
  };
}

/** Send a stored probe to RemuxDB, unless it already has this release. */
async function submit(release: Contribution): Promise<void> {
  const { imdbId, tmdbId, tvdbId, season, episode, record } = release;
  const source = sourcePayload(release.source, release.file);
  if (!source || !record.size || !(imdbId || tmdbId || tvdbId)) return;
  const label =
    release.source.kind === 'nzb'
      ? resolveRemuxDbIndexer(release.source.nzbUrl)
      : 'torrent';
  const isEpisode = season !== undefined && episode !== undefined;
  try {
    if (imdbId) {
      const versions = await fetchProbeVersions(
        imdbId,
        isEpisode ? season : undefined,
        isEpisode ? episode : undefined
      );
      if (versions.some((v) => source.known(v.sources))) return;
    }
    const response = await makeRequest(
      `${appConfig.remuxdb.baseUrl}/api/mediainfo`,
      {
        method: 'POST',
        timeout: 10_000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: instanceId(),
          kind: isEpisode ? 'episode' : 'movie',
          filename: release.file.split('/').pop() || release.file,
          ...source.body,
          container: record.container ?? '',
          size: record.size,
          duration: record.duration ?? 0,
          bitrate: record.bitrate,
          season: isEpisode ? season : undefined,
          episode: isEpisode ? episode : undefined,
          external_ids: { imdb_id: imdbId, tmdb_id: tmdbId, tvdb_id: tvdbId },
          tracks: record.tracks.map(toTrackPayload),
        }),
      }
    );
    if (!response.ok) {
      logger.warn(
        {
          source: label,
          status: response.status,
          body: (await response.text().catch(() => '')).slice(0, 300),
        },
        'remuxdb rejected a contribution'
      );
      return;
    }
    if (imdbId) {
      await invalidateProbeVersions(
        imdbId,
        isEpisode ? season : undefined,
        isEpisode ? episode : undefined
      );
    }
    logger.debug(
      { source: label, filename: release.file },
      'contributed to remuxdb'
    );
  } catch (err) {
    logger.warn(
      { source: label, err: (err as Error)?.message },
      'remuxdb contribution failed'
    );
  }
}

export const remuxDbTarget: ContributionTarget = {
  name: 'remuxdb',
  enabled: () => appConfig.remuxdb.enabled && appConfig.remuxdb.contribute,
  send: submit,
};
