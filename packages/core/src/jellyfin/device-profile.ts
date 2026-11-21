import type { ParsedFile } from '../db/schemas.js';
import { constants } from '../utils/index.js';
import type {
  DeviceProfile,
  DirectPlayProfile,
  MediaSourceRecord,
} from './types.js';

type Encode = (typeof constants.ENCODES)[number];
type AudioTag = (typeof constants.AUDIO_TAGS)[number];

/* ffmpeg codec names, what Jellyfin clients compare their device profiles against */
export const ENCODE_CODEC = {
  AV1: 'av1',
  HEVC: 'hevc',
  AVC: 'h264',
  'VC-1': 'vc1',
  XviD: 'mpeg4',
  DivX: 'mpeg4',
  'MPEG-4': 'mpeg4',
  Unknown: undefined,
} satisfies Record<Encode, string | undefined>;

export const AUDIO_CODEC = {
  Atmos: 'truehd',
  TrueHD: 'truehd',
  'DTS:X': 'dts',
  'DTS-HD MA': 'dts',
  'DTS-HD': 'dts',
  'DTS-ES': 'dts',
  DTS: 'dts',
  'DD+': 'eac3',
  DD: 'ac3',
  PCM: 'pcm_s16le',
  OPUS: 'opus',
  FLAC: 'flac',
  AAC: 'aac',
  Unknown: undefined,
} satisfies Record<AudioTag, string | undefined>;

const CONTAINER_ALIASES: Record<string, string> = {
  matroska: 'mkv',
  mpegts: 'ts',
};

const CODEC_ALIASES: Record<string, string> = {
  h265: 'hevc',
  avc: 'h264',
  dca: 'dts',
  'ac-3': 'ac3',
  'ec-3': 'eac3',
  ec3: 'eac3',
};

const normalizeContainer = (value: string): string => {
  const lower = value.trim().toLowerCase();
  return CONTAINER_ALIASES[lower] ?? lower;
};

const normalizeCodec = (value: string): string => {
  const lower = value.trim().toLowerCase();
  return CODEC_ALIASES[lower] ?? lower;
};

const parseList = (
  csv: string | undefined,
  normalize: (value: string) => string
): string[] => (csv ?? '').split(',').map(normalize).filter(Boolean);

/** An empty list allows anything, as in Jellyfin. */
const allows = (allowed: string[], value: string | undefined): boolean =>
  allowed.length === 0 || value === undefined || allowed.includes(value);

function videoCodecOf(pf: ParsedFile | undefined): string | undefined {
  const encode = pf?.encode as Encode | undefined;
  const codec = encode ? ENCODE_CODEC[encode] : undefined;
  return codec ? normalizeCodec(codec) : undefined;
}

/**
 * Known audio codecs for the file. Returns `undefined` when audio is unknown
 * (or any probed audio track has an unknown codec) so we lean towards playable.
 */
function audioCodecsOf(pf: ParsedFile | undefined): string[] | undefined {
  if (pf?.audioTracks?.length) {
    const codecs: string[] = [];
    for (const track of pf.audioTracks) {
      const fromTrack = track.codec
        ? normalizeCodec(track.codec)
        : (track.tags ?? [])
            .map((t) => AUDIO_CODEC[t as AudioTag])
            .find((c): c is string => !!c);
      if (!fromTrack) return undefined;
      codecs.push(normalizeCodec(fromTrack));
    }
    return codecs.length ? codecs : undefined;
  }

  const codecs = (pf?.audioTags ?? [])
    .map((tag) => AUDIO_CODEC[tag as AudioTag])
    .filter((codec): codec is string => !!codec)
    .map(normalizeCodec);
  return codecs.length ? codecs : undefined;
}

/**
 * Whether the client's `DeviceProfile` says it can direct-play this version.
 * Unknown values (missing container, encode, audio tags, or profile entries)
 * count as playable so a version is never lost to a parsing gap.
 */
export function directPlayable(
  record: Pick<MediaSourceRecord, 'container' | 'parsedFile' | 'bitrate'>,
  profile: DeviceProfile | undefined
): boolean {
  if (!profile) return true;

  const maxBitrate = profile.MaxStreamingBitrate;
  if (
    typeof maxBitrate === 'number' &&
    maxBitrate > 0 &&
    record.bitrate &&
    record.bitrate > maxBitrate
  ) {
    return false;
  }

  const entries = Array.isArray(profile.DirectPlayProfiles)
    ? profile.DirectPlayProfiles.filter(
        (p): p is DirectPlayProfile =>
          !!p &&
          typeof p === 'object' &&
          (!p.Type || p.Type.toLowerCase() === 'video')
      )
    : undefined;
  if (!entries?.length) return true;

  const container = record.container
    ? normalizeContainer(record.container)
    : undefined;
  const video = videoCodecOf(record.parsedFile);
  const audio = audioCodecsOf(record.parsedFile);

  return entries.some((p) => {
    const containers = parseList(p.Container, normalizeContainer);
    const videoCodecs = parseList(p.VideoCodec, normalizeCodec);
    const audioCodecs = parseList(p.AudioCodec, normalizeCodec);
    return (
      allows(containers, container) &&
      allows(videoCodecs, video) &&
      (audio === undefined || audio.some((a) => allows(audioCodecs, a)))
    );
  });
}
