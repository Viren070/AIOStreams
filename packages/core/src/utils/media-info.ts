import * as constants from './constants.js';
import { normaliseLanguage, normaliseLangCode } from './languages.js';

export interface ParsedMediaTrack {
  /** The track's stream index in the file. */
  index?: number;
  lang?: string;
  codec?: string;
  title?: string;
  /** @deprecated the first of `tags` */
  tag?: string;
  /** Audio format first, then what the profile adds. */
  tags?: string[];
  channels?: string;
  default?: boolean;
  forced?: boolean;
  commentary?: boolean;
  dub?: boolean;
  original?: boolean;
  hearingImpaired?: boolean;
  visualImpaired?: boolean;
}

export interface ParsedMediaInfo {
  /** Provenance tier; unset means unconfirmed. */
  mediaInfoQuality?: 'probe' | 'indexer' | 'addon';
  languages?: string[];
  subtitles?: string[];
  audioTags?: string[];
  audioChannels?: string[];
  visualTags?: string[];
  audioTracks?: ParsedMediaTrack[];
  subtitleTracks?: ParsedMediaTrack[];
  videoIndex?: number;
  /** Duration in seconds */
  duration?: number;
  bitrate?: number;
  encode?: string;
  resolution?: string;
  hasChapters?: boolean;
}

/** Whether tracks are known one by one, which only a probe of the file gives. */
export function hasTrackLists(
  info: { audioTracks?: unknown[]; subtitleTracks?: unknown[] } | undefined
): boolean {
  return !!(info?.audioTracks?.length || info?.subtitleTracks?.length);
}

type MediaInfoAudioTrack = {
  index?: unknown;
  codec?: unknown;
  profile?: unknown;
  lang?: unknown;
  title?: unknown;
  ch_layout?: unknown;
  ch?: unknown;
  default?: unknown;
  commentary?: unknown;
  dub?: unknown;
  original?: unknown;
  hearing_impaired?: unknown;
  visual_impaired?: unknown;
};

type MediaInfoSubtitleTrack = {
  index?: unknown;
  codec?: unknown;
  lang?: unknown;
  title?: unknown;
  default?: unknown;
  forced?: unknown;
  hearing_impaired?: unknown;
};

type MediaInfoVideo = {
  index?: unknown;
  codec?: unknown;
  hdr?: unknown;
  h?: unknown;
  w?: unknown;
  bit_depth?: unknown;
};

type MediaInfoFormat = {
  n: string;
  dur: number;
  s: number;
  br: number;
};

export type MediaInfo = {
  video?: MediaInfoVideo;
  audio?: MediaInfoAudioTrack[];
  subtitle?: MediaInfoSubtitleTrack[];
  format?: MediaInfoFormat;
  has_chapters?: boolean;
};

const TITLE_LANG_OVERRIDES: Array<{
  lang: string;
  pattern: RegExp;
  override: string;
}> = [
  { lang: 'spa', pattern: /latin/i, override: 'es-MX' },
  { lang: 'por', pattern: /brazilian/i, override: 'pt-BR' },
];

function applyTitleOverride(
  normalisedLang: string,
  title: string | undefined
): string {
  if (!title) return normalisedLang;
  const match = TITLE_LANG_OVERRIDES.find(
    (entry) => entry.lang === normalisedLang && entry.pattern.test(title)
  );
  return match ? match.override : normalisedLang;
}

function resolveTrackLang(lang: unknown, title: unknown): string | undefined {
  if (typeof lang !== 'string') return undefined;
  const normCode = normaliseLangCode(lang);
  const titleStr = typeof title === 'string' ? title : undefined;
  return applyTitleOverride(normCode, titleStr);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asMediaInfo(value: unknown): MediaInfo | undefined {
  if (!isObject(value)) return undefined;
  return value as MediaInfo;
}

function asStreamIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function asTrackText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** An empty track is kept: players number tracks by position, unknown ones included. */
function normaliseTrack(track: ParsedMediaTrack | undefined): ParsedMediaTrack {
  if (!track) return {};
  const index = asStreamIndex(track.index);
  const tags = track.tags?.length
    ? track.tags
    : track.tag
      ? [track.tag]
      : undefined;
  return {
    ...(index !== undefined ? { index } : {}),
    ...(track.lang ? { lang: track.lang } : {}),
    ...(track.codec ? { codec: track.codec } : {}),
    ...(track.title ? { title: track.title } : {}),
    ...(track.tag ? { tag: track.tag } : {}),
    ...(tags ? { tags } : {}),
    ...(track.channels ? { channels: track.channels } : {}),
    ...(track.default ? { default: true } : {}),
    ...(track.forced ? { forced: true } : {}),
    ...(track.commentary ? { commentary: true } : {}),
    ...(track.dub ? { dub: true } : {}),
    ...(track.original ? { original: true } : {}),
    ...(track.hearingImpaired ? { hearingImpaired: true } : {}),
    ...(track.visualImpaired ? { visualImpaired: true } : {}),
  };
}

function normaliseTrackList(
  tracks: ParsedMediaTrack[] | undefined
): ParsedMediaTrack[] {
  return (tracks ?? []).map(normaliseTrack);
}

/** The tracks something is known about, for describing or filtering a stream. */
export function describedTracks<T extends object>(
  tracks: T[] | undefined
): T[] {
  return (tracks ?? []).filter((track) =>
    Object.keys(track).some((key) => key !== 'index')
  );
}

function normaliseLanguageList(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const lang = normaliseLanguage(value);
    if (!lang || seen.has(lang)) continue;
    seen.add(lang);
    out.push(lang);
  }

  return out;
}

export function normaliseAudioTags(codec: unknown, profile: unknown): string[] {
  const codecStr = typeof codec === 'string' ? codec.toLowerCase().trim() : '';
  const profileStr =
    typeof profile === 'string' ? profile.toLowerCase().trim() : '';
  const format = audioFormat(codecStr, profileStr);

  // ffprobe names these "Dolby TrueHD + Dolby Atmos", "DTS-HD MA + DTS:X"
  return [
    ...(format ? [format] : []),
    ...(profileStr.includes('atmos') ? ['Atmos'] : []),
    ...(profileStr.includes('dts:x') ? ['DTS:X'] : []),
  ];
}

function audioFormat(codecStr: string, profileStr: string): string | undefined {
  if (codecStr === 'eac3' || codecStr === 'ec-3') return 'DD+';
  if (codecStr === 'ac3' || codecStr === 'ac-3') return 'DD';
  if (codecStr === 'truehd') return 'TrueHD';
  if (codecStr === 'dts' || codecStr === 'dca') {
    if (profileStr.includes('dts-hd ma')) return 'DTS-HD MA';
    if (profileStr.includes('dts-hd')) return 'DTS-HD';
    if (profileStr.includes('dts-es')) return 'DTS-ES';
    return 'DTS';
  }
  if (codecStr === 'opus') return 'OPUS';
  if (codecStr === 'flac') return 'FLAC';
  if (codecStr === 'aac' || codecStr === 'faad') return 'AAC';
  if (codecStr.startsWith('pcm_')) return 'PCM';

  if (profileStr.includes('dolby digital plus')) return 'DD+';
  if (profileStr.includes('dolby digital')) return 'DD';
  if (profileStr.includes('dolby truehd')) return 'TrueHD';
  if (profileStr.includes('dts-hd ma')) return 'DTS-HD MA';
  if (profileStr.includes('dts-hd')) return 'DTS-HD';
  if (profileStr.includes('dts-es')) return 'DTS-ES';

  return undefined;
}

function normaliseAudioChannels(
  track: MediaInfoAudioTrack
): string | undefined {
  const layout =
    typeof track.ch_layout === 'string' ? track.ch_layout.toLowerCase() : '';
  const ch = typeof track.ch === 'number' ? track.ch : undefined;

  if (layout.includes('7.1') || ch === 8) return '7.1';
  if (layout.includes('6.1') || ch === 7) return '6.1';
  if (layout.includes('5.1') || ch === 6) return '5.1';
  if (layout.includes('2.0') || layout.includes('stereo') || ch === 2) {
    return '2.0';
  }
  return undefined;
}

function normaliseVisualTags(video: MediaInfoVideo | undefined): string[] {
  if (!video) return [];

  const tags = new Set<string>();
  for (const rawTag of Array.isArray(video.hdr) ? video.hdr : []) {
    if (typeof rawTag !== 'string') continue;
    const tag = rawTag.toLowerCase().trim();

    if (tag === 'dv' || tag.includes('dolby vision')) tags.add('DV');
    if (tag === 'hdr10+') tags.add('HDR10+');
    else if (tag === 'hdr10') tags.add('HDR10');
    else if (tag === 'hlg') tags.add('HLG');
    else if (tag === 'hdr') tags.add('HDR');
  }
  if (typeof video.bit_depth === 'number' && video.bit_depth >= 10) {
    tags.add('10bit');
  }

  return [...tags];
}

const DYNAMIC_RANGE_TAGS: ReadonlySet<string> = new Set([
  'DV',
  'HDR10+',
  'HDR10',
  'HDR',
  'HLG',
  'SDR',
]);

/** A probe's range tags replace the name's if it found any; the rest stay. */
export function mergeVisualTags(
  named: string[] | undefined,
  probed: string[] | undefined
): string[] {
  const probedRange = !!probed?.some((tag) => DYNAMIC_RANGE_TAGS.has(tag));
  return [
    ...new Set([
      ...(probed ?? []),
      ...(named ?? []).filter(
        (tag) => !probedRange || !DYNAMIC_RANGE_TAGS.has(tag)
      ),
    ]),
  ];
}

export function normaliseEncode(
  video: MediaInfoVideo | undefined
): string | undefined {
  const codec =
    typeof video?.codec === 'string' ? video.codec.toLowerCase().trim() : '';

  if (codec === 'hevc' || codec === 'h265' || codec === 'x265') return 'HEVC';
  if (
    codec === 'avc' ||
    codec === 'h264' ||
    codec === 'x264' ||
    codec === 'avc1'
  ) {
    return 'AVC';
  }
  if (codec === 'av1') return 'AV1';
  if (codec === 'xvid') return 'XviD';
  if (codec === 'divx' || codec === 'dx50') return 'DivX';
  if (codec === 'vc1' || codec === 'vc-1' || codec === 'wvc1') return 'VC-1';

  return undefined;
}

export function normaliseResolution(
  width: unknown,
  height: unknown
): string | undefined {
  const h =
    typeof height === 'number' && height > 0 ? Math.round(height) : undefined;
  const w =
    typeof width === 'number' && width > 0 ? Math.round(width) : undefined;

  if (!h && !w) return undefined;

  const heightLevels = [2160, 1440, 1080, 720, 576, 480, 360, 240, 144];
  const widthThresholds = [3840, 2560, 1920, 1280, 1024, 854, 640, 426, 256];

  const closestIdx = (levels: number[], ref: number) =>
    levels.reduce(
      (bestIdx, level, i) =>
        Math.abs(level - ref) < Math.abs(levels[bestIdx] - ref) ? i : bestIdx,
      0
    );

  const fromH = h ? heightLevels[closestIdx(heightLevels, h)] : 0;
  const fromW = w ? heightLevels[closestIdx(widthThresholds, w)] : 0;

  return `${Math.max(fromH, fromW)}p`;
}

export function normaliseParsedMediaInfo(
  parsedMediaInfo: Partial<ParsedMediaInfo> | undefined
): ParsedMediaInfo | undefined {
  if (!parsedMediaInfo) return undefined;

  const languages = normaliseLanguageList(parsedMediaInfo.languages ?? []);
  const subtitles = normaliseLanguageList(parsedMediaInfo.subtitles ?? []);

  const audioTags = [
    ...new Set(
      (parsedMediaInfo.audioTags ?? []).filter((tag) =>
        constants.AUDIO_TAGS.includes(
          tag as (typeof constants.AUDIO_TAGS)[number]
        )
      )
    ),
  ];
  const audioChannels = [
    ...new Set(
      (parsedMediaInfo.audioChannels ?? []).filter((channel) =>
        constants.AUDIO_CHANNELS.includes(
          channel as (typeof constants.AUDIO_CHANNELS)[number]
        )
      )
    ),
  ];
  const visualTags = [
    ...new Set(
      (parsedMediaInfo.visualTags ?? []).filter((tag) =>
        constants.VISUAL_TAGS.includes(
          tag as (typeof constants.VISUAL_TAGS)[number]
        )
      )
    ),
  ];
  const encode = constants.ENCODES.includes(
    parsedMediaInfo.encode as (typeof constants.ENCODES)[number]
  )
    ? parsedMediaInfo.encode
    : undefined;

  let resolution: string | undefined;
  if (parsedMediaInfo.resolution) {
    const match = parsedMediaInfo.resolution.toLowerCase().match(/(\d+)p/);
    resolution = match
      ? normaliseResolution(undefined, Number.parseInt(match[1], 10))
      : undefined;
  }

  const audioTracks = normaliseTrackList(parsedMediaInfo.audioTracks);
  const subtitleTracks = normaliseTrackList(parsedMediaInfo.subtitleTracks);
  const videoIndex = asStreamIndex(parsedMediaInfo.videoIndex);

  const hasAnyData =
    languages.length > 0 ||
    subtitles.length > 0 ||
    audioTags.length > 0 ||
    audioChannels.length > 0 ||
    visualTags.length > 0 ||
    audioTracks.length > 0 ||
    subtitleTracks.length > 0 ||
    !!encode ||
    !!resolution ||
    !!parsedMediaInfo?.duration ||
    !!parsedMediaInfo?.bitrate ||
    !!parsedMediaInfo?.hasChapters;

  const result: ParsedMediaInfo = {
    ...(parsedMediaInfo.mediaInfoQuality && hasAnyData
      ? { mediaInfoQuality: parsedMediaInfo.mediaInfoQuality }
      : {}),
    ...(languages.length > 0 ? { languages } : {}),
    ...(subtitles.length > 0 ? { subtitles } : {}),
    ...(audioTags.length > 0 ? { audioTags } : {}),
    ...(audioChannels.length > 0 ? { audioChannels } : {}),
    ...(visualTags.length > 0 ? { visualTags } : {}),
    ...(audioTracks.length > 0 ? { audioTracks } : {}),
    ...(subtitleTracks.length > 0 ? { subtitleTracks } : {}),
    ...(videoIndex !== undefined ? { videoIndex } : {}),
    ...(encode ? { encode } : {}),
    ...(resolution ? { resolution } : {}),
    ...(parsedMediaInfo?.duration
      ? { duration: parsedMediaInfo.duration }
      : {}),
    ...(parsedMediaInfo?.bitrate ? { bitrate: parsedMediaInfo.bitrate } : {}),
    ...(parsedMediaInfo?.hasChapters ? { hasChapters: true } : {}),
  };

  return Object.keys(result).length > 0 ? result : undefined;
}

export function parseMediaInfo(
  mediaInfo: unknown
): ParsedMediaInfo | undefined {
  const info = asMediaInfo(mediaInfo);
  if (!info) return undefined;

  const audioTracks = Array.isArray(info.audio) ? info.audio : [];
  const subtitleTracks = Array.isArray(info.subtitle) ? info.subtitle : [];

  const languages = normaliseLanguageList(
    audioTracks.map((track) => resolveTrackLang(track.lang, track.title))
  );
  const subtitles = normaliseLanguageList(
    subtitleTracks.map((track) => resolveTrackLang(track.lang, track.title))
  );

  const trackAudioTags = audioTracks.map((track) =>
    normaliseAudioTags(track.codec, track.profile)
  );
  const audioTags = [...new Set(trackAudioTags.flat())];

  const audioChannels = [
    ...new Set(
      audioTracks
        .map((track) => normaliseAudioChannels(track))
        .filter((channel): channel is string => !!channel)
    ),
  ];

  const audioTrackList = audioTracks.map((track, i) => ({
    index: asStreamIndex(track.index),
    lang: normaliseLanguage(resolveTrackLang(track.lang, track.title)),
    codec: asTrackText(track.codec)?.toLowerCase(),
    title: asTrackText(track.title),
    tag: trackAudioTags[i][0],
    tags: trackAudioTags[i],
    channels: normaliseAudioChannels(track),
    default: track.default === true,
    commentary: track.commentary === true,
    dub: track.dub === true,
    original: track.original === true,
    hearingImpaired: track.hearing_impaired === true,
    visualImpaired: track.visual_impaired === true,
  }));
  const subtitleTrackList = subtitleTracks.map((track) => ({
    index: asStreamIndex(track.index),
    lang: normaliseLanguage(resolveTrackLang(track.lang, track.title)),
    codec: asTrackText(track.codec)?.toLowerCase(),
    title: asTrackText(track.title),
    default: track.default === true,
    forced: track.forced === true,
    hearingImpaired: track.hearing_impaired === true,
  }));

  const visualTags = normaliseVisualTags(info.video);
  const encode = normaliseEncode(info.video);
  const resolution = normaliseResolution(info.video?.w, info.video?.h);
  const duration =
    typeof info.format?.dur === 'number' &&
    Number.isFinite(info.format.dur) &&
    info.format.dur > 0
      ? info.format.dur / 1_000_000_000
      : undefined;

  const bitrate =
    typeof info.format?.br === 'number' &&
    Number.isFinite(info.format.br) &&
    info.format.br > 0
      ? info.format.br
      : undefined;

  const normalised = normaliseParsedMediaInfo({
    mediaInfoQuality: 'probe',
    languages,
    subtitles,
    audioTags,
    audioChannels,
    visualTags,
    audioTracks: audioTrackList,
    subtitleTracks: subtitleTrackList,
    videoIndex: asStreamIndex(info.video?.index),
    encode,
    resolution,
    duration,
    bitrate,
    hasChapters: info.has_chapters === true,
  });

  return normalised;
}

export function mergeParsedMediaInfo(
  base: Partial<ParsedMediaInfo> | undefined,
  preferred: Partial<ParsedMediaInfo> | undefined
): ParsedMediaInfo | undefined {
  if (!base && !preferred) return undefined;

  const merged = normaliseParsedMediaInfo({
    mediaInfoQuality: preferred?.mediaInfoQuality ?? base?.mediaInfoQuality,
    languages: preferred?.languages ?? base?.languages,
    subtitles: preferred?.subtitles ?? base?.subtitles,
    audioTags: preferred?.audioTags ?? base?.audioTags,
    audioChannels: preferred?.audioChannels ?? base?.audioChannels,
    visualTags: preferred?.visualTags ?? base?.visualTags,
    audioTracks: preferred?.audioTracks ?? base?.audioTracks,
    subtitleTracks: preferred?.subtitleTracks ?? base?.subtitleTracks,
    // Only meaningful beside the track lists it was probed with.
    videoIndex: hasTrackLists(preferred)
      ? preferred?.videoIndex
      : base?.videoIndex,
    encode: preferred?.encode ?? base?.encode,
    resolution: preferred?.resolution ?? base?.resolution,
    duration: preferred?.duration ?? base?.duration,
    bitrate: preferred?.bitrate ?? base?.bitrate,
    hasChapters: preferred?.hasChapters ?? base?.hasChapters,
  });

  return merged;
}

export function mergeParsedMediaInfos(
  ...infos: Array<Partial<ParsedMediaInfo> | undefined>
): ParsedMediaInfo | undefined {
  return infos.reduce<ParsedMediaInfo | undefined>(
    (acc, current) => mergeParsedMediaInfo(acc, current),
    undefined
  );
}
