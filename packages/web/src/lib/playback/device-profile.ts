import type {
  DeviceProfile,
  DirectPlayProfile,
} from '@jellyfin/sdk/lib/generated-client/models';
import { currentHost } from '@/lib/hosts';
import { playsWithWebGpu } from './player-choice';

/* eslint-disable lingui/no-unlocalized-strings -- Jellyfin's codec names and media types */
/** Jellyfin's video codecs, and how a browser is asked about each. */
const VIDEO: readonly [string, string][] = [
  ['h264', 'video/mp4; codecs="avc1.640029"'],
  ['hevc', 'video/mp4; codecs="hvc1.1.6.L120.90"'],
  ['av1', 'video/mp4; codecs="av01.0.08M.08"'],
  ['vp9', 'video/webm; codecs="vp9"'],
  ['vp8', 'video/webm; codecs="vp8"'],
];

const AUDIO: readonly [string, string][] = [
  ['aac', 'audio/mp4; codecs="mp4a.40.2"'],
  ['mp3', 'audio/mpeg'],
  ['opus', 'audio/webm; codecs="opus"'],
  ['vorbis', 'audio/webm; codecs="vorbis"'],
  ['flac', 'audio/flac'],
  ['ac3', 'audio/mp4; codecs="ac-3"'],
  ['eac3', 'audio/mp4; codecs="ec-3"'],
];
/* eslint-enable lingui/no-unlocalized-strings */

/** What a server converts to: HLS that every player here opens. */
const CONVERTED = {
  Type: 'Video',
  Container: 'ts',
  Protocol: 'hls',
  Context: 'Streaming',
  VideoCodec: 'h264',
  AudioCodec: 'aac,mp3',
  MaxAudioChannels: '6',
  MinSegments: 1,
  BreakOnNonKeyFrames: true,
} as const;

let tester: HTMLVideoElement | undefined;

function plays(type: string): boolean {
  tester ??= document.createElement('video');
  return (
    !!tester.canPlayType(type) ||
    (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type))
  );
}

/** A player of the app's own, which opens any file. */
function ownPlayer(): boolean {
  const host = currentHost();
  return !!host.play || !!host.playerFeatures?.includes('anyFormat');
}

function pageProfiles(tv: boolean): DirectPlayProfile[] {
  const video = VIDEO.filter(([, type]) => plays(type)).map(([c]) => c);
  const audio = AUDIO.filter(([, type]) => plays(type)).map(([c]) => c);
  const of = (codecs: string[], allowed: string[]) =>
    codecs.filter((c) => allowed.includes(c)).join(',');
  const profiles = [
    {
      Container: 'mp4,m4v,mov',
      VideoCodec: of(video, ['h264', 'hevc', 'av1', 'vp9']),
      AudioCodec: of(audio, ['aac', 'mp3', 'opus', 'flac', 'ac3', 'eac3']),
    },
    {
      Container: 'webm',
      VideoCodec: of(video, ['vp8', 'vp9', 'av1']),
      AudioCodec: of(audio, ['opus', 'vorbis']),
    },
    // A browser that reads WebM reads Matroska the same way.
    ...(tv || plays('video/webm')
      ? [
          {
            Container: 'mkv',
            VideoCodec: video.join(','),
            AudioCodec: audio.join(','),
          },
        ]
      : []),
    ...(tv
      ? [
          {
            Container: 'ts,mpegts,m2ts',
            VideoCodec: of(video, ['h264', 'hevc']),
            AudioCodec: of(audio, ['aac', 'mp3', 'ac3', 'eac3']),
          },
        ]
      : []),
  ];
  // An empty codec list would read as any codec.
  return profiles
    .filter((p) => p.VideoCodec && p.AudioCodec)
    .map((p) => ({ ...p, Type: 'Video' }));
}

/**
 * What this device's player opens as it is, and how it takes the rest, from
 * which a server picks the file itself or its own conversion. Players that
 * read any file take them all.
 */
export function deviceProfile(maxBitrate?: number): DeviceProfile {
  const any = ownPlayer() || (!currentHost().player && playsWithWebGpu());
  return {
    ...(maxBitrate && { MaxStreamingBitrate: maxBitrate }),
    DirectPlayProfiles: any
      ? [{ Type: 'Video' }]
      : pageProfiles(!!currentHost().tv),
    TranscodingProfiles: [CONVERTED],
    // A text subtitle gets an address only for a client that says it takes
    // one: a styled script keeps its own, the rest come as WebVTT.
    SubtitleProfiles: [
      { Format: 'ass', Method: 'External' },
      { Format: 'vtt', Method: 'External' },
    ],
  };
}
