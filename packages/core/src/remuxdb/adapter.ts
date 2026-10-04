import type { ParsedStream } from '../db/schemas.js';
import { unwrapProxyUrl } from '../proxy/token.js';
import type { MediaInfo } from '../utils/media-info.js';
import { NEWZNAB_INDEXERS } from '../presets/newznab.js';
import type { MediaInfoRecord, MediaTrack } from '../media-info/record.js';
import { toWireMediaInfo as recordToWire } from '../media-info/wire.js';
import type { MediaProbeVersion, ProbeSource, TrackDetail } from './client.js';

const KNOWN_INDEXER_HOSTNAMES: Record<string, string> = Object.fromEntries(
  NEWZNAB_INDEXERS.flatMap((i) =>
    i.remuxDbIndexer
      ? [[new URL(i.value).hostname.replace(/^www\./, ''), i.remuxDbIndexer]]
      : []
  )
);

export function resolveRemuxDbIndexer(
  nzbUrl: string | undefined
): string | undefined {
  if (!nzbUrl) return undefined;
  try {
    const hostname = new URL(unwrapProxyUrl(nzbUrl)).hostname
      .toLowerCase()
      .replace(/^www\./, '');
    return KNOWN_INDEXER_HOSTNAMES[hostname];
  } catch {
    return undefined;
  }
}

export function extractNzbGuid(nzbUrl: string | undefined): string | undefined {
  if (!nzbUrl) return undefined;
  const realUrl = unwrapProxyUrl(nzbUrl);
  try {
    const url = new URL(realUrl);
    return (
      url.searchParams.get('id') ??
      url.pathname.match(/\/([a-f0-9]{32,40})(?:[./]|$)/i)?.[1]
    );
  } catch {
    return realUrl;
  }
}

const baseName = (path: string | null | undefined) =>
  path?.split('/').pop()?.toLowerCase();

/** Filename goes before fileIdx, as RemuxDB can number a torrent's files differently. */
export function matchEntry(
  versions: MediaProbeVersion[],
  stream: ParsedStream
): MediaProbeVersion | undefined {
  const hash = stream.torrent?.infoHash?.toLowerCase();
  if (hash) {
    const inTorrent = (s: ProbeSource) =>
      s.torrent_info_hash?.toLowerCase() === hash;
    const candidates = versions.filter((v) => v.sources.some(inTorrent));
    const name = baseName(stream.filename);
    const fileIdx = stream.torrent?.fileIdx;
    const size = stream.size;
    const match =
      (name &&
        candidates.find((v) =>
          v.sources.some((s) => inTorrent(s) && baseName(s.filename) === name)
        )) ||
      (fileIdx !== undefined &&
        candidates.find((v) =>
          v.sources.some((s) => inTorrent(s) && s.torrent_file_idx === fileIdx)
        )) ||
      // No file index: the hash only counts if the sizes agree, ruling out packs.
      (fileIdx === undefined &&
        size &&
        candidates.find(
          (v) => v.size && Math.abs(v.size - size) <= size * 0.01
        ));
    if (match) return match;
  }

  const indexer = resolveRemuxDbIndexer(stream.nzbUrl);
  const guid = extractNzbGuid(stream.nzbUrl);
  if (indexer && guid) {
    return versions.find((v) =>
      v.sources.some((s) => s.indexer === indexer && s.indexer_guid === guid)
    );
  }

  return undefined;
}

const nonNull = <T>(value: T | null | undefined): T | undefined =>
  value ?? undefined;

function fromTrack(t: TrackDetail): MediaTrack | undefined {
  const common = {
    index: t.idx,
    codec: nonNull(t.codec),
    profile: nonNull(t.profile),
    language: nonNull(t.language),
    title: nonNull(t.title),
    bitrate: nonNull(t.bit_rate),
    default: t.is_default,
    forced: t.is_forced,
    hearingImpaired: t.is_hearing_impaired,
  };
  switch (t.kind) {
    case 'video':
      return {
        ...common,
        type: 'video',
        width: nonNull(t.width),
        height: nonNull(t.height),
        fps: nonNull(t.fps),
        bitDepth: nonNull(t.bit_depth),
        pixelFormat: nonNull(t.pixel_format),
        colorPrimaries: nonNull(t.color_primaries),
        colorRange: nonNull(t.color_range),
        colorSpace: nonNull(t.color_space),
        colorTransfer: nonNull(t.color_transfer),
        aspectRatio: nonNull(t.aspect_ratio),
        level: nonNull(t.level),
        refFrames: nonNull(t.ref_frames),
        dvProfile: nonNull(t.dv_profile),
        hdr10Plus: t.hdr10_plus_present,
      };
    case 'audio':
      return {
        ...common,
        type: 'audio',
        channels: nonNull(t.channels),
        channelLayout: nonNull(t.channel_layout),
        sampleRate: nonNull(t.sample_rate),
      };
    case 'subtitle':
      return t.is_external ? undefined : { ...common, type: 'subtitle' };
    default:
      return undefined;
  }
}

export function fromRemuxDbVersion(entry: MediaProbeVersion): MediaInfoRecord {
  return {
    container: nonNull(entry.container),
    duration: nonNull(entry.duration),
    size: nonNull(entry.size),
    bitrate: nonNull(entry.bitrate),
    chapters: entry.has_chapters,
    tracks: entry.tracks
      .map(fromTrack)
      .filter((t): t is MediaTrack => t !== undefined),
  };
}

export function toWireMediaInfo(entry: MediaProbeVersion): MediaInfo {
  return recordToWire(fromRemuxDbVersion(entry));
}
