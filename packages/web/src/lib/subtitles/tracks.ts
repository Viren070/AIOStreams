import type { JellyfinClient } from '../client';
import { firstInLanguages, sameLanguage } from '../languages';
import type { MediaStream, SourceInfo } from '../types';
import { subtitleLanguages, type PlaybackPrefs } from '../user-config';

/** The kinds of subtitle track the user ranks; commentary always comes last. */
export const SUBTITLE_TYPES = ['normal', 'sdh', 'forced', 'signs'] as const;
export type SubtitleType = (typeof SUBTITLE_TYPES)[number];

export interface SubtitleFacts {
  title?: string | null;
  forced?: boolean;
  hearingImpaired?: boolean;
}

/** Signs before forced, as files often flag a signs and songs track forced. */
export function subtitleType(
  track: SubtitleFacts
): SubtitleType | 'commentary' {
  const title = track.title?.toLowerCase() ?? '';
  if (/\bcommentary\b/.test(title)) return 'commentary';
  if (/\b(signs?|songs?)\b/.test(title)) return 'signs';
  if (track.forced || /\bforced\b/.test(title)) return 'forced';
  if (track.hearingImpaired || /\b(sdh|cc|hearing[ -]impaired)\b/.test(title))
    return 'sdh';
  return 'normal';
}

/** Only forced lines, which a signs and songs track also is. */
export const forcedOnly = (track: SubtitleFacts) =>
  ['forced', 'signs'].includes(subtitleType(track));

/** The user's order, any type it leaves out after the rest. */
export function subtitleTypes(prefs: PlaybackPrefs): SubtitleType[] {
  const saved = (prefs.SubtitleTypes ?? []).filter((t): t is SubtitleType =>
    (SUBTITLE_TYPES as readonly string[]).includes(t)
  );
  return [...new Set([...saved, ...SUBTITLE_TYPES])];
}

/** The track of the user's best-ranked type, the file's first of it on a tie. */
export function bestOfTypes<T>(
  tracks: T[],
  factsOf: (track: T) => SubtitleFacts,
  prefs: PlaybackPrefs
): T | undefined {
  const order = subtitleTypes(prefs);
  const rank = (track: T) => {
    const type = subtitleType(factsOf(track));
    return type === 'commentary' ? order.length : order.indexOf(type);
  };
  let best: T | undefined;
  for (const track of tracks)
    if (best === undefined || rank(track) < rank(best)) best = track;
  return best;
}

type StreamFacts = Pick<MediaStream, 'Language' | 'IsForced'> &
  Partial<Pick<MediaStream, 'Title' | 'DisplayTitle' | 'IsHearingImpaired'>>;

const streamFacts = (s: StreamFacts): SubtitleFacts => ({
  title: s.Title ?? s.DisplayTitle,
  forced: s.IsForced,
  hearingImpaired: s.IsHearingImpaired,
});

export function textSubtitles(source: SourceInfo): MediaStream[] {
  return (source.MediaStreams ?? []).filter(
    (s) => s.Type === 'Subtitle' && s.DeliveryMethod === 'External'
  );
}

/**
 * An absolute address for an external subtitle stream, converted to the
 * WebVTT a `<video>` element reads unless `original` keeps the file's format.
 */
export function subtitleUrl(
  client: JellyfinClient,
  stream: MediaStream,
  { original = false } = {}
): string | null {
  if (!stream.DeliveryUrl) return null;
  const path = original
    ? stream.DeliveryUrl
    : stream.DeliveryUrl.replace(/Stream\.\w+(?=\?|$)/, 'Stream.vtt');
  return new URL(client.url(path), window.location.href).toString();
}

export function splitByLanguage<T extends { id: string; lang?: string }>(
  tracks: T[],
  languages: string[],
  current: string | null
): { shown: T[]; hidden: T[] } {
  if (!languages.length) return { shown: tracks, hidden: [] };
  const mine = (t: T) =>
    !t.lang ||
    t.lang === 'und' ||
    t.id === current ||
    languages.some((l) => sameLanguage(l, t.lang));
  return {
    shown: tracks.filter(mine),
    hidden: tracks.filter((t) => !mine(t)),
  };
}

/** The subtitle the user's languages, subtitle mode and subtitle types start with. */
export function preferredSubtitle<T extends StreamFacts>(
  subtitles: T[],
  prefs: PlaybackPrefs
): T | undefined {
  if (prefs.SubtitleMode === 'None') return undefined;
  const pool =
    prefs.SubtitleMode === 'OnlyForced'
      ? subtitles.filter((s) => forcedOnly(streamFacts(s)))
      : subtitles;
  const languages = subtitleLanguages(prefs);
  const first = languages.length
    ? firstInLanguages(languages, pool, (s) => s.Language)
    : pool[0];
  if (!first) return undefined;
  return bestOfTypes(
    pool.filter(
      (s) =>
        s === first ||
        (!!s.Language && sameLanguage(first.Language, s.Language))
    ),
    streamFacts,
    prefs
  );
}
