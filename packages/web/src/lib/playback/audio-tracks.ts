import { firstInLanguages, sameLanguage } from '../languages';
import type { PlaybackPrefs } from '../user-config';

/** The kinds of audio track the user ranks. */
export const AUDIO_TYPES = ['main', 'description', 'commentary'] as const;
export type AudioType = (typeof AUDIO_TYPES)[number];

export interface AudioFacts {
  title?: string;
  lang?: string;
  visualImpaired?: boolean;
  default?: boolean;
}

const DESCRIPTION =
  /\b(audio description|descriptive audio|described video)\b/i;
const COMMENTARY = /\bcommentary\b/i;

export function audioType(track: AudioFacts): AudioType {
  const title = track.title ?? '';
  if (track.visualImpaired || DESCRIPTION.test(title)) return 'description';
  if (COMMENTARY.test(title)) return 'commentary';
  return 'main';
}

/** The user's order, any type it leaves out after the rest. */
export function audioTypes(prefs: PlaybackPrefs): AudioType[] {
  const saved = (prefs.AudioTypes ?? []).filter((t): t is AudioType =>
    (AUDIO_TYPES as readonly string[]).includes(t)
  );
  return [...new Set([...saved, ...AUDIO_TYPES])];
}

/** The track to switch to from the player's pick, chosen as the server chooses its default. */
export function betterAudioFor<T extends AudioFacts>(
  tracks: T[],
  chosen: T,
  order: AudioType[],
  languages: string[],
  preferDefault: boolean
): T | undefined {
  const rank = (track: T) => order.indexOf(audioType(track));
  const usual = tracks.filter((track) => rank(track) <= order.indexOf('main'));
  const pool = usual.length ? usual : tracks;
  const inLanguages = (from: T[]) =>
    firstInLanguages(languages, from, (track) => track.lang) ?? from[0];
  const defaults = preferDefault ? pool.filter((track) => track.default) : [];
  const base = defaults.length
    ? inLanguages(defaults)
    : pool.includes(chosen)
      ? chosen
      : inLanguages(pool);
  let best = base;
  for (const track of tracks) {
    const same = base.lang ? sameLanguage(base.lang, track.lang) : !track.lang;
    if (same && rank(track) < rank(best)) best = track;
  }
  return best === chosen ? undefined : best;
}
