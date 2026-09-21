import type { ParsedStream } from '../db/schemas.js';
import { decodeProxyToken, ProxyDataSchema } from '../proxy/token.js';
import type { MediaInfo } from '../utils/media-info.js';
import type { MediaProbeVersion, ProbeSource, TrackDetail } from './client.js';

function unwrapProxyUrl(nzbUrl: string): string {
  try {
    const segments = new URL(nzbUrl).pathname.split('/');
    const token = segments[segments.indexOf('proxy') + 1];
    if (!token) return nzbUrl;
    const decoded = decodeProxyToken(token);
    if (!decoded) return nzbUrl;
    const data = ProxyDataSchema.safeParse(JSON.parse(decoded.rawData));
    return data.success ? data.data.url : nzbUrl;
  } catch {
    return nzbUrl;
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

  const guid = extractNzbGuid(stream.nzbUrl);
  if (guid) {
    return versions.find((v) => v.sources.some((s) => s.indexer_guid === guid));
  }

  return undefined;
}

function deriveHdrTags(track: TrackDetail): string[] {
  if ((track.dv_profile ?? 0) > 0) return ['dv'];
  if (track.hdr10_plus_present) return ['hdr10+'];
  if (track.color_transfer === 'smpte2084') return ['hdr10'];
  if (track.color_transfer === 'arib-std-b67') return ['hlg'];
  return [];
}

export function toWireMediaInfo(entry: MediaProbeVersion): MediaInfo {
  const videoTrack = entry.tracks.find((t) => t.kind === 'video');
  const audioTracks = entry.tracks.filter((t) => t.kind === 'audio');
  const subtitleTracks = entry.tracks.filter((t) => t.kind === 'subtitle');

  return {
    video: videoTrack
      ? {
          codec: videoTrack.codec ?? undefined,
          w: videoTrack.width ?? undefined,
          h: videoTrack.height ?? undefined,
          hdr: deriveHdrTags(videoTrack),
        }
      : undefined,
    audio: audioTracks.map((t) => ({
      codec: t.codec ?? undefined,
      profile: t.profile ?? undefined,
      lang: t.language ?? undefined,
      title: t.title ?? undefined,
      ch_layout: t.channel_layout ?? undefined,
      ch: t.channels ?? undefined,
    })),
    subtitle: subtitleTracks.map((t) => ({
      lang: t.language ?? undefined,
      title: t.title ?? undefined,
    })),
    format: {
      n: entry.container ?? '',
      dur: (entry.duration ?? 0) * 1_000_000_000,
      s: entry.size ?? 0,
      br: entry.bitrate ?? 0,
    },
    has_chapters: entry.has_chapters,
  };
}
