import { languageToIso6392 } from '../utils/languages.js';
import type { JellyfinMediaStream } from './types.js';

export const SUBTITLE_MODES = [
  'Default',
  'Always',
  'OnlyForced',
  'None',
  'Smart',
] as const;
export type SubtitleMode = (typeof SUBTITLE_MODES)[number];

export interface TrackPreferences {
  /** A language code, `OriginalLanguage`, or empty for none. */
  audioLanguage: string;
  playDefaultAudioTrack: boolean;
  subtitleLanguage: string;
  subtitleMode: SubtitleMode;
}

/** A stored configuration, with Jellyfin's defaults for what it leaves out. */
export function trackPreferencesFrom(
  config: Record<string, unknown> | null | undefined
): TrackPreferences {
  const text = (key: string) =>
    typeof config?.[key] === 'string' ? (config[key] as string) : '';
  const mode = SUBTITLE_MODES.find((m) => m === config?.SubtitleMode);
  return {
    audioLanguage: text('AudioLanguagePreference'),
    playDefaultAudioTrack: config?.PlayDefaultAudioTrack !== false,
    subtitleLanguage: text('SubtitleLanguagePreference'),
    subtitleMode: mode ?? 'Default',
  };
}

/** Clients send the bibliographic ISO 639-2 codes; tracks carry the terminologic ones. */
const TERMINOLOGIC: Record<string, string> = {
  alb: 'sqi',
  arm: 'hye',
  baq: 'eus',
  bur: 'mya',
  chi: 'zho',
  cze: 'ces',
  dut: 'nld',
  fre: 'fra',
  geo: 'kat',
  ger: 'deu',
  gre: 'ell',
  ice: 'isl',
  mac: 'mkd',
  mao: 'mri',
  may: 'msa',
  per: 'fas',
  rum: 'ron',
  slo: 'slk',
  tib: 'bod',
  wel: 'cym',
};

function canonical(code: unknown): string | undefined {
  if (typeof code !== 'string') return undefined;
  const lower = code.trim().toLowerCase();
  if (!lower) return undefined;
  return TERMINOLOGIC[lower] ?? languageToIso6392(lower) ?? lower;
}

const UNDEFINED_LANGUAGES = new Set([
  'und',
  'unknown',
  'undetermined',
  'mul',
  'zxx',
]);

function undefinedLanguage(stream: JellyfinMediaStream): boolean {
  const language = canonical(stream.Language);
  return !language || UNDEFINED_LANGUAGES.has(language);
}

/** No preferred language matches any. */
function matches(stream: JellyfinMediaStream, preferred: string[]): boolean {
  return !preferred.length || preferred.includes(canonical(stream.Language)!);
}

const flag = (stream: JellyfinMediaStream, key: string) => stream[key] === true;

/** Stable, so equal keys keep the file's order. */
function sortBy(
  streams: JellyfinMediaStream[],
  ...keys: ((stream: JellyfinMediaStream) => number | boolean)[]
): JellyfinMediaStream[] {
  return [...streams].sort((a, b) => {
    for (const key of keys) {
      const diff = Number(key(b)) - Number(key(a));
      if (diff) return diff;
    }
    return 0;
  });
}

function score(stream: JellyfinMediaStream, preferred: string[]): number {
  const at = preferred.indexOf(canonical(stream.Language) ?? '');
  let total = at === -1 ? 1 : 101 - at;
  for (const key of [
    'IsForced',
    'IsDefault',
    'SupportsExternalStream',
    'IsTextSubtitleStream',
    'IsExternal',
  ])
    total = total * 10 + (flag(stream, key) ? 2 : 1);
  return total;
}

function audioIndex(
  streams: JellyfinMediaStream[],
  preferred: string[],
  preferDefault: boolean
): number | undefined {
  const sorted = sortBy(streams, (s) => score(s, preferred));
  return (
    (preferDefault ? sorted.find((s) => flag(s, 'IsDefault')) : undefined) ??
    sorted[0]
  )?.Index;
}

function defaultAudio(
  streams: JellyfinMediaStream[],
  prefs: TrackPreferences,
  originalLanguage: string | undefined
): number | undefined {
  const audio = streams.filter((s) => s.Type === 'Audio');
  const original = canonical(originalLanguage);
  if (prefs.audioLanguage.toLowerCase() !== 'originallanguage') {
    const preferred = canonical(prefs.audioLanguage);
    return audioIndex(
      audio,
      preferred ? [preferred] : [],
      prefs.playDefaultAudioTrack
    );
  }
  if (!prefs.playDefaultAudioTrack) {
    const flagged = audio.find((s) => flag(s, 'IsOriginal'));
    if (flagged && (!original || canonical(flagged.Language) === original))
      return flagged.Index;
  }
  return audioIndex(
    audio,
    original ? [original] : [],
    prefs.playDefaultAudioTrack
  );
}

function onlyForced(
  sorted: JellyfinMediaStream[],
  preferred: string[]
): JellyfinMediaStream | undefined {
  return sortBy(
    sorted.filter(
      (s) =>
        flag(s, 'IsForced') && (matches(s, preferred) || undefinedLanguage(s))
    ),
    (s) => matches(s, preferred),
    undefinedLanguage
  )[0];
}

/**
 * Jellyfin's subtitle modes, except that the file's own tracks come before
 * external ones and Default mode never turns an external one on: those come
 * from subtitle addons in every language, not files placed beside the video.
 */
function defaultSubtitle(
  streams: JellyfinMediaStream[],
  prefs: TrackPreferences,
  audioLanguage: string | undefined
): number {
  if (prefs.subtitleMode === 'None') return -1;
  const language = canonical(prefs.subtitleLanguage);
  const preferred = language ? [language] : [];
  const sorted = sortBy(
    streams.filter((s) => s.Type === 'Subtitle'),
    (s) => !flag(s, 'IsExternal'),
    (s) => flag(s, 'IsDefault'),
    (s) => !flag(s, 'IsForced') && matches(s, preferred),
    (s) => flag(s, 'IsForced') && matches(s, preferred),
    (s) => flag(s, 'IsForced') && undefinedLanguage(s),
    (s) => flag(s, 'IsForced')
  );
  let stream: JellyfinMediaStream | undefined;
  switch (prefs.subtitleMode) {
    case 'Default':
      stream = sorted.find(
        (s) =>
          !flag(s, 'IsExternal') &&
          (flag(s, 'IsDefault') || flag(s, 'IsForced'))
      );
      break;
    case 'Smart':
      stream = preferred.includes(canonical(audioLanguage) ?? '')
        ? onlyForced(sorted, preferred)
        : sorted.find((s) => matches(s, preferred));
      break;
    case 'Always':
      stream =
        sorted.find((s) => !flag(s, 'IsForced') && matches(s, preferred)) ??
        onlyForced(sorted, preferred);
      break;
    case 'OnlyForced':
      stream = onlyForced(sorted, preferred);
      break;
  }
  return stream?.Index ?? -1;
}

/**
 * The audio and subtitle tracks a version starts with, as Jellyfin picks them
 * for a user; -1 starts without subtitles.
 */
export function defaultTrackIndexes(
  streams: JellyfinMediaStream[],
  prefs: TrackPreferences,
  originalLanguage?: string
): { audio: number | undefined; subtitle: number } {
  const audio = defaultAudio(streams, prefs, originalLanguage);
  const audioLanguage = streams.find((s) => s.Index === audio)?.Language;
  return {
    audio,
    subtitle: defaultSubtitle(
      streams,
      prefs,
      typeof audioLanguage === 'string' ? audioLanguage : undefined
    ),
  };
}
