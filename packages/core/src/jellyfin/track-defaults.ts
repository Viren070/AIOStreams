import { tagLanguage } from '../utils/languages.js';
import type { JellyfinMediaStream } from './types.js';

export const SUBTITLE_MODES = [
  'Default',
  'Always',
  'OnlyForced',
  'None',
  'Smart',
] as const;
export type SubtitleMode = (typeof SUBTITLE_MODES)[number];

/** The kinds of subtitle track a user ranks; commentary always comes last. */
export const SUBTITLE_TYPES = ['normal', 'sdh', 'forced', 'signs'] as const;
export type SubtitleType = (typeof SUBTITLE_TYPES)[number];

/** The kinds of audio track a user ranks. */
export const AUDIO_TYPES = ['main', 'description', 'commentary'] as const;
export type AudioType = (typeof AUDIO_TYPES)[number];

export interface TrackPreferences {
  /** Language codes in order, any of them `OriginalLanguage`. */
  audioLanguages: string[];
  playDefaultAudioTrack: boolean;
  audioTypes: AudioType[];
  subtitleLanguages: string[];
  subtitleMode: SubtitleMode;
  subtitleTypes: SubtitleType[];
}

/** The stored order of `all`, any it leaves out after the rest. */
function ranked<T extends string>(stored: unknown, all: readonly T[]): T[] {
  const order = Array.isArray(stored) ? stored : [];
  const saved = all
    .filter((t) => order.includes(t))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...new Set([...saved, ...all])];
}

/** A stored configuration, with Jellyfin's defaults for what it leaves out. */
export function trackPreferencesFrom(
  config: Record<string, unknown> | null | undefined
): TrackPreferences {
  // The ordered list where there is one, else Jellyfin's single language.
  const languages = (list: string, single: string) => {
    const value = config?.[list];
    if (Array.isArray(value) && value.length)
      return value.filter((v): v is string => typeof v === 'string' && !!v);
    const one = config?.[single];
    return typeof one === 'string' && one ? [one] : [];
  };
  const mode = SUBTITLE_MODES.find((m) => m === config?.SubtitleMode);
  return {
    audioLanguages: languages('AudioLanguages', 'AudioLanguagePreference'),
    playDefaultAudioTrack: config?.PlayDefaultAudioTrack !== false,
    audioTypes: ranked(config?.AudioTypes, AUDIO_TYPES),
    subtitleLanguages: languages(
      'SubtitleLanguages',
      'SubtitleLanguagePreference'
    ),
    subtitleMode: mode ?? 'Default',
    subtitleTypes: ranked(config?.SubtitleTypes, SUBTITLE_TYPES),
  };
}

/** The language a code or tag names; one the mapping lacks stays as written. */
function canonical(code: unknown): string | undefined {
  if (typeof code !== 'string') return undefined;
  const lower = code.trim().toLowerCase();
  if (!lower) return undefined;
  return tagLanguage(lower) ?? lower;
}

const isOriginal = (language: string | undefined) =>
  language?.toLowerCase() === 'originallanguage';

const known = (codes: (string | undefined)[]) => [
  ...new Set(codes.filter((c): c is string => !!c)),
];

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

const COMMENTARY = /\bcommentary\b/;
const DESCRIPTION = /\b(audio description|descriptive audio|described video)\b/;
const SIGNS = /\b(signs?|songs?)\b/;
const FORCED = /\bforced\b/;
const SDH = /\b(sdh|cc|hearing[ -]impaired)\b/;

/** Signs before forced, as files often flag a signs and songs track forced. */
function subtitleType(
  stream: JellyfinMediaStream
): SubtitleType | 'commentary' {
  const title =
    typeof stream.Title === 'string' ? stream.Title.toLowerCase() : '';
  if (COMMENTARY.test(title)) return 'commentary';
  if (SIGNS.test(title)) return 'signs';
  if (flag(stream, 'IsForced') || FORCED.test(title)) return 'forced';
  if (flag(stream, 'IsHearingImpaired') || SDH.test(title)) return 'sdh';
  return 'normal';
}

/** Only forced lines, which a signs and songs track also is. */
const forcedOnly = (stream: JellyfinMediaStream) =>
  ['forced', 'signs'].includes(subtitleType(stream));

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

function audioType(stream: JellyfinMediaStream): AudioType {
  const title = [stream.Title, stream.DisplayTitle]
    .filter((t) => typeof t === 'string')
    .join(' ')
    .toLowerCase();
  if (DESCRIPTION.test(title)) return 'description';
  if (COMMENTARY.test(title)) return 'commentary';
  return 'main';
}

/**
 * The language as before, from kinds the user ranks no lower than main where
 * the version has any, then the best-ranked kind in that language.
 */
function audioIndex(
  streams: JellyfinMediaStream[],
  preferred: string[],
  preferDefault: boolean,
  types: AudioType[]
): number | undefined {
  const rank = (s: JellyfinMediaStream) => types.indexOf(audioType(s));
  const usual = streams.filter((s) => rank(s) <= types.indexOf('main'));
  const sorted = sortBy(usual.length ? usual : streams, (s) =>
    score(s, preferred)
  );
  const chosen =
    (preferDefault ? sorted.find((s) => flag(s, 'IsDefault')) : undefined) ??
    sorted[0];
  if (!chosen) return undefined;
  const language = canonical(chosen.Language);
  return sortBy(
    streams.filter((s) => canonical(s.Language) === language),
    (s) => -rank(s),
    (s) => score(s, preferred)
  )[0].Index;
}

function defaultAudio(
  streams: JellyfinMediaStream[],
  prefs: TrackPreferences,
  originalLanguage: string | undefined
): number | undefined {
  const audio = streams.filter((s) => s.Type === 'Audio');
  const original = canonical(originalLanguage);
  if (isOriginal(prefs.audioLanguages[0]) && !prefs.playDefaultAudioTrack) {
    const flagged = audio.find((s) => flag(s, 'IsOriginal'));
    if (flagged && (!original || canonical(flagged.Language) === original))
      return flagged.Index;
  }
  const preferred = known(
    prefs.audioLanguages.map((l) => (isOriginal(l) ? original : canonical(l)))
  );
  return audioIndex(
    audio,
    preferred,
    prefs.playDefaultAudioTrack,
    prefs.audioTypes
  );
}

function onlyForced(
  sorted: JellyfinMediaStream[],
  preferred: string[]
): JellyfinMediaStream | undefined {
  return sortBy(
    sorted.filter(
      (s) => forcedOnly(s) && (matches(s, preferred) || undefinedLanguage(s))
    ),
    (s) => matches(s, preferred),
    undefinedLanguage
  )[0];
}

/**
 * Jellyfin's subtitle modes, except that the file's own tracks come before
 * external ones and Default mode never turns an external one on: those come
 * from subtitle addons in every language, not files placed beside the video.
 * The user's subtitle types rank tracks before the file's default does.
 */
function subtitleIn(
  streams: JellyfinMediaStream[],
  prefs: TrackPreferences,
  preferred: string[],
  listed: string[],
  audioLanguage: string | undefined
): number {
  const order = prefs.subtitleTypes;
  const sorted = sortBy(
    streams.filter((s) => s.Type === 'Subtitle'),
    (s) => !flag(s, 'IsExternal'),
    (s) => {
      const type = subtitleType(s);
      return type === 'commentary' ? 0 : order.length - order.indexOf(type);
    },
    (s) => flag(s, 'IsDefault')
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
    // Audio in any of the user's languages needs no more than forced lines.
    case 'Smart':
      stream = listed.includes(canonical(audioLanguage) ?? '')
        ? onlyForced(sorted, preferred)
        : sorted.find((s) => matches(s, preferred));
      break;
    case 'Always':
      stream =
        sorted.find((s) => matches(s, preferred)) ??
        onlyForced(sorted, preferred);
      break;
    case 'OnlyForced':
      stream = onlyForced(sorted, preferred);
      break;
  }
  return stream?.Index ?? -1;
}

/** Each language in turn, as the one Jellyfin knows, until one finds a track. */
function defaultSubtitle(
  streams: JellyfinMediaStream[],
  prefs: TrackPreferences,
  audioLanguage: string | undefined
): number {
  if (prefs.subtitleMode === 'None') return -1;
  const languages = known(prefs.subtitleLanguages.map(canonical));
  for (const language of languages.length ? languages : [undefined]) {
    const index = subtitleIn(
      streams,
      prefs,
      language ? [language] : [],
      languages,
      audioLanguage
    );
    if (index !== -1) return index;
  }
  return -1;
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
