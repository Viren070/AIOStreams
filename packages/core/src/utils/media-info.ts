import * as constants from './constants.js';
import { normaliseLanguage, normaliseLangCode } from './languages.js';

export interface ParsedMediaInfo {
  languages?: string[];
  subtitles?: string[];
  audioTags?: string[];
  audioChannels?: string[];
  visualTags?: string[];
  duration?: number;
  bitrate?: number;
  encode?: string;
  resolution?: string;
  hasChapters?: boolean;
}

type MediaInfoAudioTrack = {
  codec?: unknown;
  profile?: unknown;
  lang?: unknown;
  title?: unknown;
  ch_layout?: unknown;
  ch?: unknown;
};

type MediaInfoSubtitleTrack = {
  lang?: unknown;
  title?: unknown;
};

type MediaInfoVideo = {
  codec?: unknown;
  hdr?: unknown;
  h?: unknown;
  w?: unknown;
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

function normaliseAudioTag(
  codec: unknown,
  profile: unknown
): string | undefined {
  const codecStr = typeof codec === 'string' ? codec.toLowerCase().trim() : '';
  const profileStr =
    typeof profile === 'string' ? profile.toLowerCase().trim() : '';

  if (codecStr === 'eac3' || codecStr === 'ec-3') return 'DD+';
  if (codecStr === 'ac3' || codecStr === 'ac-3') return 'DD';
  if (codecStr === 'truehd') return 'TrueHD';
  if (codecStr === 'dts') {
    if (profileStr.includes('dts-hd ma')) return 'DTS-HD MA';
    if (profileStr.includes('dts-hd')) return 'DTS-HD';
    if (profileStr.includes('dts-es')) return 'DTS-ES';
    return 'DTS';
  }
  if (codecStr === 'opus') return 'OPUS';
  if (codecStr === 'flac') return 'FLAC';
  if (codecStr === 'aac') return 'AAC';

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
  if (!video || !Array.isArray(video.hdr)) return [];

  const tags = new Set<string>();
  for (const rawTag of video.hdr) {
    if (typeof rawTag !== 'string') continue;
    const tag = rawTag.toLowerCase().trim();

    if (tag === 'dv' || tag.includes('dolby vision')) tags.add('DV');
    if (tag === 'hdr10+') tags.add('HDR10+');
    else if (tag === 'hdr10') tags.add('HDR10');
    else if (tag === 'hlg') tags.add('HLG');
    else if (tag === 'hdr') tags.add('HDR');
  }

  return [...tags];
}

function normaliseEncode(
  video: MediaInfoVideo | undefined
): string | undefined {
  const codec =
    typeof video?.codec === 'string' ? video.codec.toLowerCase().trim() : '';

  if (codec === 'hevc' || codec === 'h265' || codec === 'x265') return 'HEVC';
  if (codec === 'avc' || codec === 'h264' || codec === 'x264') return 'AVC';
  if (codec === 'av1') return 'AV1';
  if (codec === 'xvid') return 'XviD';
  if (codec === 'divx') return 'DivX';

  return undefined;
}

function normaliseResolution(
  width: unknown,
  height: unknown
): string | undefined {
  const h =
    typeof height === 'number' && height > 0 ? Math.round(height) : undefined;
  const w =
    typeof width === 'number' && width > 0 ? Math.round(width) : undefined;

  if (!h && !w) return undefined;

  const heightLevels = [2160, 1440, 1080, 720, 576, 480, 360, 240, 144];

  if (h && w) {
    const widthThresholds = [3840, 2560, 1920, 1280, 1024, 854, 640, 426, 256];
    const idx = widthThresholds.reduce(
      (bestIdx, wLevel, i) =>
        Math.abs(wLevel - w) < Math.abs(widthThresholds[bestIdx] - w)
          ? i
          : bestIdx,
      0
    );
    return `${heightLevels[idx]}p`;
  }

  // Single dimension (e.g. height extracted from a "Np" string): use height thresholds.
  const ref = w ?? h!;
  const closest = heightLevels.reduce((prev, curr) =>
    Math.abs(curr - ref) < Math.abs(prev - ref) ? curr : prev
  );
  return `${closest}p`;
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

  const result: ParsedMediaInfo = {
    ...(languages.length > 0 ? { languages } : {}),
    ...(subtitles.length > 0 ? { subtitles } : {}),
    ...(audioTags.length > 0 ? { audioTags } : {}),
    ...(audioChannels.length > 0 ? { audioChannels } : {}),
    ...(visualTags.length > 0 ? { visualTags } : {}),
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

  const audioTags = [
    ...new Set(
      audioTracks
        .map((track) => normaliseAudioTag(track.codec, track.profile))
        .filter((tag): tag is string => !!tag)
    ),
  ];

  const audioChannels = [
    ...new Set(
      audioTracks
        .map((track) => normaliseAudioChannels(track))
        .filter((channel): channel is string => !!channel)
    ),
  ];

  const visualTags = normaliseVisualTags(info.video);
  const encode = normaliseEncode(info.video);
  const resolution = normaliseResolution(info.video?.w, info.video?.h);
  const duration =
    typeof info.format?.dur === 'number' &&
    Number.isFinite(info.format.dur) &&
    info.format.dur > 0
      ? info.format.dur / 1_000_000
      : undefined;

  const bitrate =
    typeof info.format?.br === 'number' &&
    Number.isFinite(info.format.br) &&
    info.format.br > 0
      ? info.format.br
      : undefined;

  const normalised = normaliseParsedMediaInfo({
    languages,
    subtitles,
    audioTags,
    audioChannels,
    visualTags,
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
    languages: [...(base?.languages ?? []), ...(preferred?.languages ?? [])],
    subtitles: [...(base?.subtitles ?? []), ...(preferred?.subtitles ?? [])],
    audioTags: [...(base?.audioTags ?? []), ...(preferred?.audioTags ?? [])],
    audioChannels: [
      ...(base?.audioChannels ?? []),
      ...(preferred?.audioChannels ?? []),
    ],
    visualTags: [...(base?.visualTags ?? []), ...(preferred?.visualTags ?? [])],
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
