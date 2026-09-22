import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appConfig } from '../utils/index.js';
import {
  encodeUsenetStreamToken,
  type UsenetStreamToken,
} from '../usenet/integration/tokens.js';
import { NEWZNAB_INDEXERS } from '../presets/newznab.js';
import { extractNzbGuid, resolveNzbHostname } from './adapter.js';
import { fetchProbeVersions, invalidateProbeCache, logger } from './client.js';
import {
  submitProbe,
  type MediaInfoPayload,
  type TrackPayload,
} from './submit.js';

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 30_000;
const VIDEO_FRAME_SAMPLE_SIZE = 5;
const DEBOUNCE_MS = 5 * 60 * 1000;
const MAX_CONCURRENT_PROBES = 1;
const MAX_PENDING_QUEUE_SIZE = 20;
let activeProbes = 0;
const pendingQueue = new Map<string, UsenetStreamToken>();

const KNOWN_INDEXER_HOSTNAMES: Record<string, string> = Object.fromEntries(
  NEWZNAB_INDEXERS.flatMap((i) =>
    i.remuxDbIndexer
      ? [[new URL(i.value).hostname.replace(/^www\./, ''), i.remuxDbIndexer]]
      : []
  )
);

const recentlyProbed = new Map<string, number>();
const evictionTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, at] of recentlyProbed) {
    if (now - at > DEBOUNCE_MS) recentlyProbed.delete(key);
  }
}, DEBOUNCE_MS);
evictionTimer.unref?.();

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export interface FfprobeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  codec_tag_string?: string;
  width?: number;
  height?: number;
  level?: number;
  field_order?: string;
  refs?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  bit_rate?: string;
  bits_per_raw_sample?: string;
  pix_fmt?: string;
  color_primaries?: string;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  display_aspect_ratio?: string;
  channels?: number;
  sample_rate?: string;
  channel_layout?: string;
  side_data_list?: {
    side_data_type?: string;
    dv_profile?: number;
    dv_level?: number;
  }[];
  tags?: { language?: string; title?: string; comment?: string };
  disposition?: {
    default?: number;
    forced?: number;
    hearing_impaired?: number;
    visual_impaired?: number;
  };
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  frames?: {
    stream_index?: number;
    side_data_list?: { side_data_type?: string }[];
  }[];
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
}

interface VideoFrameData {
  refsByIndex: Map<number, number>;
  hdr10PlusIndexes: Set<number>;
}

async function runFfprobe(
  args: string[],
  label: string
): Promise<FfprobeOutput | undefined> {
  let raw: string;
  try {
    const result = await execFileAsync(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', ...args],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
    );
    raw = result.stdout;
  } catch {
    logger.error(`ffprobe failed for ${label}`);
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    logger.error(`ffprobe returned unparsable output for ${label}: ${error}`);
    return undefined;
  }
}

function frameRateToFps(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const [num, den] = rate.split('/').map(Number);
  if (!den) return num || undefined;
  return num / den;
}

/** Containers without a FourCC concept (e.g. Matroska) report an all-zero tag. */
function meaningfulCodecTag(tag: string | undefined): string | undefined {
  return tag && /^(\[0\])+$/.test(tag) ? undefined : tag;
}

export function toTrackPayload(
  stream: FfprobeStream,
  frameData?: VideoFrameData
): TrackPayload | undefined {
  const common = {
    idx: stream.index,
    bit_rate: toNumber(stream.bit_rate),
    profile: stream.profile,
    codec_tag: meaningfulCodecTag(stream.codec_tag_string),
    comment: stream.tags?.comment,
    title: stream.tags?.title,
    language: stream.tags?.language,
    is_default: stream.disposition?.default === 1,
    is_forced: stream.disposition?.forced === 1,
    is_hearing_impaired: stream.disposition?.hearing_impaired === 1,
    is_external: false,
  };

  if (stream.codec_type === 'video') {
    const dovi = stream.side_data_list?.find(
      (s) => s.side_data_type === 'DOVI configuration record'
    );
    return {
      ...common,
      kind: 'video',
      codec: stream.codec_name ?? '',
      width: stream.width ?? 0,
      height: stream.height ?? 0,
      fps: frameRateToFps(stream.r_frame_rate),
      avg_fps: frameRateToFps(stream.avg_frame_rate),
      bit_depth: toNumber(stream.bits_per_raw_sample),
      pixel_format: stream.pix_fmt,
      color_primaries: stream.color_primaries,
      color_range: stream.color_range,
      color_space: stream.color_space,
      color_transfer: stream.color_transfer,
      aspect_ratio: stream.display_aspect_ratio,
      dv_profile: dovi?.dv_profile,
      dv_level: dovi?.dv_level,
      level: stream.level,
      ref_frames: frameData?.refsByIndex.get(stream.index),
      is_interlaced:
        stream.field_order && stream.field_order !== 'unknown'
          ? stream.field_order !== 'progressive'
          : undefined,
      hdr10_plus_present: frameData?.hdr10PlusIndexes.has(stream.index),
    };
  }
  if (stream.codec_type === 'audio') {
    return {
      ...common,
      kind: 'audio',
      codec: stream.codec_name ?? '',
      channels: stream.channels ?? 0,
      sample_rate: toNumber(stream.sample_rate) ?? 0,
      channel_layout: stream.channel_layout,
    };
  }
  if (stream.codec_type === 'subtitle') {
    return {
      ...common,
      kind: 'subtitle',
      codec: stream.codec_name,
    };
  }
  return undefined;
}

const HDR10_PLUS_SIDE_DATA_TYPES = new Set([
  'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)',
  'HDR10+ Dynamic Metadata (SMPTE 2094-40)',
]);

export function hdr10PlusStreamIndexes(
  frames: FfprobeOutput['frames']
): Set<number> {
  const indexes = new Set<number>();
  for (const frame of frames ?? []) {
    if (
      frame.stream_index !== undefined &&
      frame.side_data_list?.some((s) =>
        HDR10_PLUS_SIDE_DATA_TYPES.has(s.side_data_type ?? '')
      )
    ) {
      indexes.add(frame.stream_index);
    }
  }
  return indexes;
}

// refs/HDR10+ need a decode (ffmpeg fe86fd07d3, 2026-01-23); scoped to video
// since read_intervals counts packets across every stream.
async function probeVideoFrameData(
  streamUrl: string,
  label: string
): Promise<VideoFrameData | undefined> {
  const output = await runFfprobe(
    [
      '-select_streams',
      'v',
      '-show_streams',
      '-show_frames',
      '-read_intervals',
      `%+#${VIDEO_FRAME_SAMPLE_SIZE}`,
      streamUrl,
    ],
    label
  );
  if (!output) return undefined;
  const refsByIndex = new Map<number, number>();
  for (const stream of output.streams ?? []) {
    if (stream.refs !== undefined) refsByIndex.set(stream.index, stream.refs);
  }
  return {
    refsByIndex,
    hdr10PlusIndexes: hdr10PlusStreamIndexes(output.frames),
  };
}

/** Returns false when the attempt failed and a retry should be allowed later. */
async function probeAndSubmit(
  token: UsenetStreamToken,
  streamUrl: string,
  indexer: string,
  guid: string
): Promise<boolean> {
  const label = `${token.filename} (${indexer}:${guid})`;
  if (token.imdbId) {
    const versions = await fetchProbeVersions(
      token.imdbId,
      token.season,
      token.episode
    );
    if (
      versions.some((v) =>
        v.sources.some((s) => s.indexer === indexer && s.indexer_guid === guid)
      )
    ) {
      logger.debug(`skipping remuxdb probe for ${label}: already known`);
      return true;
    }
  }

  const output = await runFfprobe(
    ['-show_format', '-show_streams', streamUrl],
    label
  );
  if (!output) return false;

  const frameData = await probeVideoFrameData(streamUrl, label);
  const tracks = (output.streams ?? [])
    .map((s) => toTrackPayload(s, frameData))
    .filter((t): t is TrackPayload => t !== undefined);
  const size = toNumber(output.format?.size);
  if (!tracks.length || !size) {
    logger.debug(
      `ffprobe for ${label} yielded no usable data (tracks: ${tracks.length}, size: ${size})`
    );
    return false;
  }
  logger.debug(
    `ffprobe for ${label} found ${tracks.length} track(s), container ${output.format?.format_name}, size ${size}`
  );

  const isEpisode = token.season !== undefined && token.episode !== undefined;

  const payload: Omit<MediaInfoPayload, 'client_id'> = {
    kind: isEpisode ? 'episode' : 'movie',
    filename: token.filename,
    nzb: { indexer, indexer_guid: guid, title: token.filename },
    container: output.format?.format_name ?? '',
    size,
    duration: toNumber(output.format?.duration) ?? 0,
    bitrate: toNumber(output.format?.bit_rate),
    season: isEpisode ? token.season : undefined,
    episode: isEpisode ? token.episode : undefined,
    external_ids:
      token.imdbId || token.tmdbId || token.tvdbId
        ? {
            imdb_id: token.imdbId,
            tmdb_id: token.tmdbId,
            tvdb_id: token.tvdbId,
          }
        : undefined,
    tracks,
  };
  const accepted = await submitProbe(payload);
  if (accepted && token.imdbId) {
    await invalidateProbeCache(token.imdbId, token.season, token.episode);
  }
  return accepted;
}

/**
 * Fire-and-forget: probe a just-played usenet file and submit the result to
 * RemuxDB. Debounced per file so repeated plays/seeks within the window don't
 * re-probe. Never throws into the playback path.
 */
export function queueUsenetProbe(token: UsenetStreamToken): void {
  if (!appConfig.remuxdb.enabled) return;
  if (!token.imdbId && !token.tmdbId && !token.tvdbId) {
    logger.debug(
      `skipping remuxdb probe for ${token.filename}: no external id`
    );
    return;
  }
  const indexer = KNOWN_INDEXER_HOSTNAMES[resolveNzbHostname(token.nzb) ?? ''];
  const guid = extractNzbGuid(token.nzb);
  if (!indexer || !guid) {
    logger.debug(
      `skipping remuxdb probe for ${token.filename}: unsupported or unidentifiable indexer`
    );
    return;
  }
  const label = `${token.filename} (${indexer}:${guid})`;
  const key = `${token.hash}:${token.fileIndex ?? 'auto'}:${token.innerPath ?? ''}`;

  const last = recentlyProbed.get(key);
  if (last && Date.now() - last < DEBOUNCE_MS) {
    logger.debug(`skipping remuxdb probe for ${label}: debounced`);
    return;
  }

  if (activeProbes >= MAX_CONCURRENT_PROBES) {
    if (!pendingQueue.has(key) && pendingQueue.size >= MAX_PENDING_QUEUE_SIZE) {
      logger.warn(`dropping remuxdb probe for ${label}: pending queue full`);
      return;
    }
    logger.debug(
      `deferring remuxdb probe for ${label}: already at max concurrent probes`
    );
    pendingQueue.set(key, token);
    return;
  }

  recentlyProbed.set(key, Date.now());

  // Not attributed to the viewer's own connection quota.
  const streamUrl = `http://localhost:${appConfig.bootstrap.port}/api/v1/usenet/stream/${encodeUsenetStreamToken({ ...token, owner: undefined, internalProbe: true })}`;
  logger.debug(`starting remuxdb probe for ${label}`);
  activeProbes++;
  probeAndSubmit(token, streamUrl, indexer, guid)
    .then((succeeded) => {
      if (!succeeded) recentlyProbed.delete(key);
    })
    .catch((error) => {
      recentlyProbed.delete(key);
      logger.error(`remuxdb ingest failed for ${label}: ${error}`);
    })
    .finally(() => {
      activeProbes--;
      for (const [nextKey, nextToken] of pendingQueue) {
        pendingQueue.delete(nextKey);
        queueUsenetProbe(nextToken);
        if (activeProbes >= MAX_CONCURRENT_PROBES) break;
      }
    });
}
