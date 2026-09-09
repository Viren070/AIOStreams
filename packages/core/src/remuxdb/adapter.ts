import type { ParsedStream } from '../db/schemas.js';
import { decodeProxyToken, ProxyDataSchema } from '../proxy/token.js';
import type { MediaInfo } from '../utils/media-info.js';
import type { MediaProbeVersion, TrackDetail } from './client.js';

/** Unwraps AIOStreams' own `/proxy/{mode}.{auth}.{data}` url to the real url it wraps. Input unchanged if it isn't one. */
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

/** `id` query param, or a hex guid embedded in the path. Bare guid if not a URL at all. */
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

/** Matches by torrent hash+fileIdx, then nzb indexer_guid. No filename/size fallback. */
export function matchEntry(
  versions: MediaProbeVersion[],
  stream: ParsedStream
): MediaProbeVersion | undefined {
  const hash = stream.torrent?.infoHash?.toLowerCase();
  if (hash) {
    const fileIdx = stream.torrent?.fileIdx;
    const match = versions.find((v) =>
      v.sources.some(
        (s) =>
          s.torrent_info_hash?.toLowerCase() === hash &&
          (s.torrent_file_idx ?? undefined) === fileIdx
      )
    );
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

/** Adapts a RemuxDB entry into the wire shape parseMediaInfo() already knows how to parse. */
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
    has_chapters: (entry.chapters?.length ?? 0) > 0,
  };
}
