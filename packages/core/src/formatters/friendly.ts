import type { ParsedStream } from '../db/schemas.js';

/**
 * Plain-English names for the parser's quality, visual, audio, channel and
 * encode tags, and the warnings a stream implies. Display only: filters,
 * sorting and deduplication keep using the raw tags.
 */

const FRIENDLY_LABELS: Readonly<Record<string, string>> = {
  // quality
  'BluRay REMUX': 'Blu-ray (exact copy)',
  BluRay: 'Blu-ray (compressed)',
  'WEB-DL': 'Streaming (original)',
  WEBRip: 'Streaming (re-encoded)',
  HDRip: 'HD Rip (re-encoded)',
  'HC HD-Rip': 'HD Rip (burned-in subs)',
  'DVD REMUX': 'DVD (exact copy)',
  DVDRip: 'DVD (compressed)',
  HDTV: 'TV Recording',
  CAM: 'Cinema Camera',
  TS: 'Cinema Recording',
  TC: 'Film Print Copy',
  SCR: 'Screener (advance copy)',

  // visual
  'HDR+DV': 'Dolby Vision (HDR fallback)',
  'DV Only': 'Dolby Vision (no fallback)',
  'HDR Only': 'HDR',
  'HDR10+': 'HDR10+ (dynamic)',
  HDR10: 'HDR10',
  DV: 'Dolby Vision',
  HDR: 'HDR',
  HLG: 'HLG (broadcast HDR)',
  '10bit': '10-bit Colour',
  '3D': '3D',
  IMAX: 'IMAX',
  AI: 'AI Upscaled',
  Upscaled: 'Upscaled',
  SDR: 'SDR (no HDR)',
  'H-OU': '3D (over/under)',
  'H-SBS': '3D (side by side)',

  // audio
  Atmos: 'Dolby Atmos',
  'DD+': 'Dolby Digital Plus',
  DD: 'Dolby Digital',
  'DTS:X': 'DTS:X (3D surround)',
  'DTS-HD MA': 'DTS-HD MA (lossless)',
  'DTS-HD': 'DTS-HD',
  'DTS-ES': 'DTS-ES (6.1)',
  DTS: 'DTS',
  TrueHD: 'Dolby TrueHD (lossless)',
  PCM: 'PCM (uncompressed)',
  OPUS: 'Opus',
  FLAC: 'FLAC (lossless)',
  AAC: 'AAC',

  // audio channels
  '2.0': 'Stereo',
  '5.1': '5.1 Surround',
  '6.1': '6.1 Surround',
  '7.1': '7.1 Surround',

  // encode
  AV1: 'AV1',
  HEVC: 'HEVC (H.265)',
  AVC: 'AVC (H.264)',
  'VC-1': 'VC-1',
  XviD: 'XviD',
  DivX: 'DivX',
  'MPEG-4': 'MPEG-4',
};

const LOWERED_LABELS: ReadonlyMap<string, string> = new Map(
  Object.entries(FRIENDLY_LABELS).map(([tag, label]) => [
    tag.toLowerCase(),
    label,
  ])
);

/** The plain-English name for a tag; anything unrecognised is returned as is. */
export function friendlyLabel(tag: string): string {
  return LOWERED_LABELS.get(tag.toLowerCase()) ?? tag;
}

const CINEMA_QUALITIES = new Set(['CAM', 'TS', 'TC', 'SCR']);
const THREE_D_TAGS = new Set(['3D', 'H-OU', 'H-SBS']);
const OLD_ENCODES = new Set(['XviD', 'DivX', 'MPEG-4']);
// audio many TVs and every browser cannot decode
const LIMITED_AUDIO = new Set([
  'DTS',
  'DTS-ES',
  'DTS-HD',
  'DTS-HD MA',
  'DTS:X',
  'TrueHD',
]);

/** Short warnings for anything likely to cause a bad viewing experience. */
export function streamWarnings(stream: ParsedStream): string[] {
  const file = stream.parsedFile;
  const visual = file?.visualTags ?? [];
  // Atmos rides on DD+ or TrueHD, so it says nothing about compatibility
  const audio = (file?.audioTags ?? []).filter((tag) => tag !== 'Atmos');
  const warnings: string[] = [];

  if (file?.quality && CINEMA_QUALITIES.has(file.quality)) {
    warnings.push('Recorded in a cinema (poor picture and sound)');
  }
  if (file?.quality === 'HC HD-Rip') {
    warnings.push('Subtitles burned into the picture');
  }
  if (
    visual.some((tag) => tag.startsWith('DV')) &&
    !visual.some((tag) => tag.startsWith('HDR'))
  ) {
    warnings.push('Dolby Vision only (colours may look wrong without DV)');
  }
  if (file?.upscaled || visual.includes('AI') || visual.includes('Upscaled')) {
    warnings.push('Upscaled (not true resolution)');
  }
  if (visual.some((tag) => THREE_D_TAGS.has(tag))) {
    warnings.push('3D (needs a 3D display)');
  }
  if (file?.encode === 'AV1') {
    warnings.push('AV1 (older devices may not play it)');
  }
  if (file?.encode && OLD_ENCODES.has(file.encode)) {
    warnings.push('Old video format (low quality)');
  }
  if (audio.length > 0 && audio.every((tag) => LIMITED_AUDIO.has(tag))) {
    warnings.push(
      'DTS/TrueHD audio only (some TVs and browsers have no sound)'
    );
  }
  const isIso = (value?: string) =>
    value?.toLowerCase().replace(/^\./, '') === 'iso';
  if (isIso(file?.extension) || isIso(file?.container)) {
    warnings.push('Disc image (may not play)');
  }
  if (stream.service?.cached === false) {
    warnings.push('Not cached (has to download before playing)');
  }
  if (
    (stream.type === 'p2p' || stream.service?.cached === false) &&
    stream.torrent?.seeders === 0
  ) {
    warnings.push('No seeders (may never start)');
  }

  return warnings;
}
