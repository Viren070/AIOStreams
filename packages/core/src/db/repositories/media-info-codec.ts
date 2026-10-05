import { deflateRawSync, inflateRawSync } from 'node:zlib';

const SUBTITLE_LANGUAGES = [
  'eng',
  'spa',
  'fre',
  'ger',
  'ita',
  'por',
  'dut',
  'pol',
  'cze',
  'hun',
  'rum',
  'gre',
  'tur',
  'swe',
  'dan',
  'nor',
  'fin',
  'rus',
  'ukr',
  'heb',
  'ara',
  'hin',
  'tha',
  'vie',
  'ind',
  'may',
  'kor',
  'jpn',
  'chi',
];

// Stored rows are read with this dictionary, so changing it needs a new
// format byte.
const DICTIONARY = Buffer.from(
  [
    {
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: 2722.47,
      size: 1840123456,
      bitrate: 5407321,
      chapters: false,
    },
    { container: 'matroska,webm', chapters: true, tracks: [] },
    {
      index: 0,
      codec: 'h264',
      profile: 'High',
      bitrate: 5000000,
      default: true,
      type: 'video',
      width: 1920,
      height: 1080,
      fps: 23.976023976023978,
      avgFps: 23.976023976023978,
      bitDepth: 8,
      pixelFormat: 'yuv420p',
      colorPrimaries: 'bt709',
      colorRange: 'tv',
      colorSpace: 'bt709',
      colorTransfer: 'bt709',
      aspectRatio: '16:9',
      codecTag: 'avc1',
      level: 41,
      refFrames: 4,
      interlaced: false,
    },
    {
      index: 0,
      codec: 'hevc',
      profile: 'Main 10',
      default: true,
      type: 'video',
      width: 3840,
      height: 2160,
      fps: 24,
      avgFps: 24,
      bitDepth: 10,
      pixelFormat: 'yuv420p10le',
      colorPrimaries: 'bt2020',
      colorRange: 'tv',
      colorSpace: 'bt2020nc',
      colorTransfer: 'smpte2084',
      aspectRatio: '16:9',
      level: 153,
      refFrames: 1,
      interlaced: false,
      dvProfile: 8,
      dvLevel: 6,
      hdr10Plus: true,
    },
    {
      index: 1,
      codec: 'truehd',
      profile: 'Dolby TrueHD + Dolby Atmos',
      language: 'eng',
      default: true,
      type: 'audio',
      channels: 8,
      channelLayout: '7.1',
      sampleRate: 48000,
    },
    {
      index: 2,
      codec: 'dts',
      profile: 'DTS-HD MA',
      language: 'eng',
      title: 'Commentary',
      commentary: true,
      type: 'audio',
      channels: 6,
      channelLayout: '5.1(side)',
      sampleRate: 48000,
    },
    {
      index: 3,
      codec: 'eac3',
      profile: 'Dolby Digital Plus + Dolby Atmos',
      language: 'spa',
      title: 'Latin American',
      bitrate: 640000,
      type: 'audio',
      channels: 6,
      channelLayout: '5.1(side)',
      sampleRate: 48000,
    },
    {
      index: 4,
      codec: 'ac3',
      language: 'fre',
      bitrate: 384000,
      type: 'audio',
      channels: 2,
      channelLayout: 'stereo',
      sampleRate: 48000,
    },
    {
      index: 5,
      codec: 'aac',
      profile: 'LC',
      language: 'jpn',
      type: 'audio',
      channels: 2,
      channelLayout: 'stereo',
      sampleRate: 48000,
    },
    {
      index: 6,
      codec: 'hdmv_pgs_subtitle',
      language: 'eng',
      title: 'SDH',
      bitrate: 41234,
      hearingImpaired: true,
      type: 'subtitle',
    },
    {
      index: 7,
      codec: 'subrip',
      language: 'eng',
      title: 'Forced',
      forced: true,
      type: 'subtitle',
    },
    {
      index: 8,
      codec: 'subrip',
      language: 'por',
      title: 'Brazilian',
      type: 'subtitle',
    },
    ...SUBTITLE_LANGUAGES.map((language, i) => ({
      index: 9 + i,
      codec: i % 2 ? 'subrip' : 'hdmv_pgs_subtitle',
      language,
      type: 'subtitle',
    })),
  ]
    .map((part) => JSON.stringify(part))
    .join(',')
);

const PACKED = 1;

export function packInfo(json: string): Buffer {
  return Buffer.concat([
    Buffer.of(PACKED),
    deflateRawSync(json, { dictionary: DICTIONARY }),
  ]);
}

/** `maxBytes` caps the inflated size, for records from another instance. */
export function unpackInfo(
  value: string | Buffer | Uint8Array,
  maxBytes?: number
): string {
  if (typeof value === 'string') return value;
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (bytes[0] === PACKED) {
    return inflateRawSync(bytes.subarray(1), {
      dictionary: DICTIONARY,
      ...(maxBytes ? { maxOutputLength: maxBytes } : {}),
    }).toString('utf8');
  }
  return bytes.toString('utf8');
}

/** A stored record as packed bytes, packing one written before packing. */
export function asPacked(value: string | Buffer | Uint8Array): Buffer {
  if (typeof value !== 'string' && value[0] === PACKED) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  }
  return packInfo(unpackInfo(value));
}

/** {@link asPacked} for a stored record already in base64, line breaks and all. */
export function asPackedBase64(stored: string): string {
  const base64 = stored.replaceAll('\n', '');
  return Buffer.from(base64.slice(0, 4), 'base64')[0] === PACKED
    ? base64
    : asPacked(Buffer.from(base64, 'base64')).toString('base64');
}
