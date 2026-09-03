export type FileCategory =
  | 'video'
  | 'audio'
  | 'archive'
  | 'par2'
  | 'subtitle'
  | 'other';

export interface DetectedType {
  category: FileCategory;
  /** Container/format label, e.g. 'matroska', 'mp4', 'flac', 'rar', 'par2'. */
  format?: string;
  /** Whether this is a directly streamable media container. */
  streamable: boolean;
}

/** Playable content: what the library persists, selects and serves. */
export function isMediaCategory(category: string | undefined): boolean {
  return category === 'video' || category === 'audio';
}

const VIDEO_EXT = new Set([
  'mkv',
  'mp4',
  'm4v',
  'avi',
  'wmv',
  'mov',
  'ts',
  'm2ts',
  'flv',
  'webm',
  'mpg',
  'mpeg',
  'vob',
  'ogv',
  'mka',
]);
const AUDIO_EXT = new Set([
  'mp3',
  'm4a',
  'm4b',
  'flac',
  'ogg',
  'oga',
  'opus',
  'aac',
  'wma',
  'wav',
  'aiff',
  'aif',
]);
const ARCHIVE_EXT = new Set(['rar', 'zip', '7z', 'tar', 'gz']);
const SUBTITLE_EXT = new Set(['srt', 'sub', 'idx', 'ass', 'ssa', 'vtt']);

/** Detect file type from a leading byte sample (magic) + filename extension. */
export function detectFileType(
  sample: Buffer,
  filename?: string
): DetectedType {
  const ext = extensionOf(filename);
  const magic = detectByMagic(sample, ext);
  if (magic) return magic;

  // Multi-part archive volume names whose final "extension" is a number
  // (`.7z.002`, `.part03.rar`): continuation volumes carry no magic at their
  // start, so without this they'd classify as `other`.
  if (filename) {
    if (/\.7z\.\d+$/i.test(filename)) {
      return { category: 'archive', format: '7z', streamable: false };
    }
    if (/\.part\d+\.rar$/i.test(filename)) {
      return { category: 'archive', format: 'rar', streamable: false };
    }
  }

  if (ext) {
    if (VIDEO_EXT.has(ext))
      return { category: 'video', format: ext, streamable: true };
    if (AUDIO_EXT.has(ext))
      return { category: 'audio', format: ext, streamable: true };
    // Disc images are stored video content; players (VLC/Kodi/Infuse) mount
    // BDMV/UHD ISOs directly, and our byte-range path serves them as-is.
    if (ext === 'iso' || ext === 'img')
      return { category: 'video', format: 'iso', streamable: true };
    if (ext === 'par2')
      return { category: 'par2', format: 'par2', streamable: false };
    if (/^r\d{2,3}$/.test(ext) || ARCHIVE_EXT.has(ext)) {
      return { category: 'archive', format: ext, streamable: false };
    }
    if (SUBTITLE_EXT.has(ext)) {
      return { category: 'subtitle', format: ext, streamable: false };
    }
  }
  return { category: 'other', streamable: false };
}

/**
 * Conventional extension for a {@link DetectedType.format}
 */
export function extensionForFormat(format?: string): string | undefined {
  if (!format) return undefined;
  const mapped = FORMAT_EXT[format];
  if (mapped) return mapped;
  return VIDEO_EXT.has(format) || AUDIO_EXT.has(format) ? format : undefined;
}

const FORMAT_EXT: Record<string, string> = {
  matroska: 'mkv',
  mpegts: 'ts',
  iso: 'iso',
};

const audio = (format: string): DetectedType => ({
  category: 'audio',
  format,
  streamable: true,
});

function detectByMagic(b: Buffer, ext?: string): DetectedType | undefined {
  if (b.length < 4) return undefined;
  const audioExt = ext && AUDIO_EXT.has(ext) ? ext : undefined;

  // Matroska / WebM (EBML)
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return { category: 'video', format: 'matroska', streamable: true };
  }
  // MP4 / MOV / M4A / M4B: 'ftyp' at offset 4. The major brand names the
  // audio-only variants; a generic brand (isom/mp42) is video unless the
  // extension says otherwise.
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('latin1').trim().toLowerCase();
    if (brand === 'm4b') return audio('m4b');
    if (brand === 'm4a' || brand === 'm4p') return audio('m4a');
    if (audioExt) return audio(audioExt);
    return { category: 'video', format: 'mp4', streamable: true };
  }
  // RIFF: 'AVI ' or 'WAVE' at offset 8
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF') {
    const form = b.subarray(8, 12).toString('latin1');
    if (form === 'AVI ') {
      return { category: 'video', format: 'avi', streamable: true };
    }
    if (form === 'WAVE') return audio('wav');
  }
  // MPEG-TS: 0x47 sync byte (and again 188 bytes later when available)
  if (b[0] === 0x47 && (b.length < 189 || b[188] === 0x47)) {
    return { category: 'video', format: 'mpegts', streamable: true };
  }
  // ID3v2 tag: MP3 in practice (a tagged AAC/FLAC keeps its extension's name).
  if (b.subarray(0, 3).toString('latin1') === 'ID3') {
    return audio(audioExt ?? 'mp3');
  }
  if (b.subarray(0, 4).toString('latin1') === 'fLaC') return audio('flac');
  // Ogg: Theora video or Vorbis/Opus/FLAC audio, told apart by the first
  // stream's header packet, which sits inside the first page.
  if (b.subarray(0, 4).toString('latin1') === 'OggS') {
    const head = b.subarray(0, 128).toString('latin1');
    if (head.includes('theora')) {
      return { category: 'video', format: 'ogv', streamable: true };
    }
    return audio(audioExt ?? (head.includes('OpusHead') ? 'opus' : 'ogg'));
  }
  // AIFF: 'FORM' .... 'AIFF' / 'AIFC'
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'FORM' &&
    /^AIF[FC]$/.test(b.subarray(8, 12).toString('latin1'))
  ) {
    return audio('aiff');
  }
  // PAR2: magic 'PAR2\0PKT'
  if (b.subarray(0, 8).toString('latin1') === 'PAR2\x00PKT') {
    return { category: 'par2', format: 'par2', streamable: false };
  }
  // RAR: 'Rar!\x1a\x07'
  if (b.subarray(0, 4).toString('latin1') === 'Rar!') {
    return { category: 'archive', format: 'rar', streamable: false };
  }
  // 7z: '7z\xbc\xaf\x27\x1c'
  if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf) {
    return { category: 'archive', format: '7z', streamable: false };
  }
  // ZIP: 'PK\x03\x04'
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    return { category: 'archive', format: 'zip', streamable: false };
  }
  // ISO 9660: 'CD001' at byte 1 of a volume descriptor, which sits at sector
  // 16 for 2048-byte sectors (0x8001) or the equivalent for 2336/2352-byte raw
  // sectors (0x8801/0x9001). Probe samples are a full first segment (~700KB),
  // comfortably covering all three.
  for (const off of [0x8001, 0x8801, 0x9001]) {
    if (b.length >= off + 5 && b.toString('latin1', off, off + 5) === 'CD001') {
      return { category: 'video', format: 'iso', streamable: true };
    }
  }
  return undefined;
}

function extensionOf(filename?: string): string | undefined {
  if (!filename) return undefined;
  const idx = filename.lastIndexOf('.');
  if (idx === -1 || idx === filename.length - 1) return undefined;
  return filename.slice(idx + 1).toLowerCase();
}
