import { currentHost } from '../hosts';
import type { SourceInfo } from '../types';

/**
 * Codec strings a server's codec names stand for. They are asked inside an MP4
 * so only the codec counts: a TV's own player takes MKV, which its web engine
 * would refuse.
 */
const VIDEO: Record<string, string> = {
  h264: 'avc1.640028',
  hevc: 'hvc1.2.4.L153.B0',
  av1: 'av01.0.12M.10',
  vp9: 'vp09.02.51.10',
};
const DOLBY_VISION = 'dvhe.08.06';
const AUDIO: Record<string, [codec: string, label: string]> = {
  aac: ['mp4a.40.2', 'AAC'],
  ac3: ['ac-3', 'DD'],
  eac3: ['ec-3', 'DD+'],
  dts: ['dtsc', 'DTS'],
  dca: ['dtsc', 'DTS'],
  truehd: ['mlpa', 'TrueHD'],
  mlp: ['mlpa', 'TrueHD'],
  flac: ['flac', 'FLAC'],
  opus: ['opus', 'Opus'],
};
/** A release's audio tags as codecs, for a version whose streams the server doesn't know. */
const AUDIO_TAGS: Record<string, string> = {
  'DTS:X': 'dts',
  'DTS-HD MA': 'dts',
  'DTS-HD': 'dts',
  'DTS-ES': 'dts',
  DTS: 'dts',
  TrueHD: 'truehd',
  'DD+': 'eac3',
  DD: 'ac3',
  AAC: 'aac',
  FLAC: 'flac',
  OPUS: 'opus',
};
const DV_TAGS = ['DV', 'DV Only', 'HDR+DV'];

const answers = new Map<string, boolean>();

/** What the web engine decodes, which on a TV is its own player's decoders too. */
function decodes(kind: 'video' | 'audio', codec: string): boolean {
  const type = `${kind}/mp4; codecs="${codec}"`;
  let yes = answers.get(type);
  if (yes === undefined) {
    yes =
      (typeof MediaSource !== 'undefined' &&
        MediaSource.isTypeSupported(type)) ||
      document.createElement('video').canPlayType(type) !== '';
    answers.set(type, yes);
  }
  return yes;
}

/**
 * What a TV can't decode in `source`, as a label, or null when it can or
 * there's no telling. Only TVs are asked: the desktop and phone players
 * decode it all, and a TV only learns otherwise from a failed start.
 */
export function unsupportedOnTv(source: SourceInfo): string | null {
  if (!currentHost().tv) return null;
  let verdict = verdicts.get(source);
  if (verdict === undefined) verdicts.set(source, (verdict = judge(source)));
  return verdict;
}

/** Each version's verdict, as lists and their rows ask on every render. */
const verdicts = new WeakMap<SourceInfo, string | null>();

function judge(source: SourceInfo): string | null {
  const streams = source.MediaStreams ?? [];
  const tags = source.aiostreams;
  const video = streams.find((s) => s.Type === 'Video');
  const range = video?.VideoRangeType;
  const dolbyVision = range
    ? /^DOVI/i.test(range)
    : !!tags?.visualTags.some((t) => DV_TAGS.includes(t));
  if (dolbyVision && !decodes('video', DOLBY_VISION)) return 'Dolby Vision';
  const videoCodec = VIDEO[video?.Codec?.toLowerCase() ?? ''];
  if (videoCodec && !decodes('video', videoCodec))
    return video!.Codec!.toUpperCase();
  const probed = streams
    .filter((s) => s.Type === 'Audio' && s.Codec)
    .map((s) => s.Codec!.toLowerCase());
  const audio = (
    probed.length
      ? probed
      : (tags?.audioTags ?? []).map((t) => AUDIO_TAGS[t] ?? '')
  ).filter((c) => AUDIO[c]);
  // Unplayable only when no track it knows of plays.
  if (audio.length && audio.every((c) => !decodes('audio', AUDIO[c][0])))
    return AUDIO[audio[0]][1];
  return null;
}
