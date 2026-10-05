import type { MediaInfo } from '../utils/media-info.js';
import type {
  AudioTrack,
  MediaInfoRecord,
  SubtitleTrack,
  VideoTrack,
} from './record.js';

function hdrTags(track: VideoTrack): string[] {
  if (track.hdr) return track.hdr.map((tag) => tag.toLowerCase());
  if ((track.dvProfile ?? 0) > 0) return ['dv'];
  if (track.hdr10Plus) return ['hdr10+'];
  if (track.colorTransfer === 'smpte2084') return ['hdr10'];
  if (track.colorTransfer === 'arib-std-b67') return ['hlg'];
  return [];
}

/** The shape `parseMediaInfo` reads. */
export function toWireMediaInfo(record: MediaInfoRecord): MediaInfo {
  const tracks = [...record.tracks].sort((a, b) => a.index - b.index);
  const video = tracks.find((t): t is VideoTrack => t.type === 'video');
  const audio = tracks.filter((t): t is AudioTrack => t.type === 'audio');
  const subtitles = tracks.filter(
    (t): t is SubtitleTrack => t.type === 'subtitle'
  );
  return {
    video: video
      ? {
          index: video.index,
          codec: video.codec,
          w: video.width,
          h: video.height,
          hdr: hdrTags(video),
        }
      : undefined,
    audio: audio.map((t) => ({
      index: t.index,
      codec: t.codec,
      profile: t.profile,
      lang: t.language,
      title: t.title,
      ch_layout: t.channelLayout,
      ch: t.channels,
      default: t.default,
      commentary: t.commentary,
      dub: t.dub,
      original: t.original,
      hearing_impaired: t.hearingImpaired,
      visual_impaired: t.visualImpaired,
    })),
    subtitle: subtitles.map((t) => ({
      index: t.index,
      codec: t.codec,
      lang: t.language,
      title: t.title,
      default: t.default,
      forced: t.forced,
      hearing_impaired: t.hearingImpaired,
    })),
    format: {
      n: record.container ?? '',
      dur: (record.duration ?? 0) * 1_000_000_000,
      s: record.size ?? 0,
      br: record.bitrate ?? 0,
    },
    has_chapters: record.chapters,
  };
}
