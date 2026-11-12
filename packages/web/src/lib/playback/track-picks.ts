import {
  firstInLanguages,
  languageCode,
  otherRegion,
  sameLanguage,
} from '@/lib/languages';
import {
  bestOfTypes,
  forcedOnly,
  preferredSubtitle,
  type SubtitleFacts,
} from '@/lib/subtitles/tracks';
import type { SourceInfo } from '@/lib/jellyfin/types';
import {
  audioLanguages,
  ORIGINAL_LANGUAGE,
  subtitleLanguages,
  type PlaybackPrefs,
} from '@/lib/jellyfin/user-config';
import { audioTypes, betterAudioFor } from './audio-tracks';
import type { EngineTrack, ServerSubtitle } from './engine';

/**
 * The user's audio languages. Original language takes the language of the
 * server's default audio track, as only the server knows it.
 */
export function audioCodes(prefs: PlaybackPrefs, source: SourceInfo): string[] {
  const original = source.MediaStreams?.find(
    (s) => s.Type === 'Audio' && s.Index === source.DefaultAudioStreamIndex
  )?.Language;
  return audioLanguages(prefs)
    .map((l) => (l === ORIGINAL_LANGUAGE ? original : l))
    .filter((l): l is string => !!l);
}

export const trackFacts = (t: EngineTrack): SubtitleFacts => ({
  title: t.title,
  forced: t.forced,
  hearingImpaired: t.hearingImpaired,
});

export const serverFacts = (s: ServerSubtitle): SubtitleFacts => ({
  title: s.stream.Title ?? s.stream.DisplayTitle,
  forced: s.stream.IsForced,
  hearingImpaired: s.stream.IsHearingImpaired,
});

export interface TrackPicks {
  audio: string | null;
  subtitle: string | null;
}

/**
 * The tracks a file plays with. An engine that picked from the settings as the
 * file opened keeps its picks unless they misread the user's languages; others
 * start from the user's languages. Both then take the user's track types, and
 * a server subtitle where the mode wants one and the file has none of its own
 * in that language or an earlier one.
 */
export function chooseTracks(
  tracks: EngineTrack[],
  servers: ServerSubtitle[],
  current: TrackPicks,
  prefs: PlaybackPrefs,
  source: SourceInfo,
  picked: boolean
): TrackPicks {
  const audio = tracks.filter((t) => t.type === 'audio');
  const decoded = audio.filter((t) => !t.unplayable);
  const audioPool = decoded.length ? decoded : audio;
  const subtitles = tracks.filter((t) => t.type === 'subtitle');
  const codes = audioCodes(prefs, source);
  let { audio: audioId, subtitle: subtitleId } = current;
  const wantedAudio = firstInLanguages(codes, audioPool, (t) => t.lang);
  // The file's own rank before the server's.
  const wantedSubtitle = preferredSubtitle(
    [
      ...subtitles.map((t) => ({
        id: t.id,
        Language: t.lang,
        IsForced: t.forced,
        Title: t.title,
        IsHearingImpaired: t.hearingImpaired,
      })),
      ...servers.map((s) => ({ ...s.stream, id: s.id })),
    ],
    prefs
  );

  if (!picked) {
    audioId =
      (wantedAudio ?? audioPool.find((t) => t.id === audioId) ?? audioPool[0])
        ?.id ?? null;
    subtitleId = wantedSubtitle?.id ?? null;
  } else {
    // Engines match a language's regions alike, and mpv ranks an exact tag
    // over the user's order. A pick outside the user's languages is their mpv.conf's.
    const rank = (lang: string | undefined) =>
      lang ? codes.findIndex((code) => sameLanguage(code, lang)) : -1;
    const engineAudio = audioPool.find((t) => t.id === audioId);
    if (
      wantedAudio &&
      (otherRegion(wantedAudio.lang, engineAudio?.lang) ||
        rank(engineAudio?.lang) > rank(wantedAudio.lang))
    )
      audioId = wantedAudio.id;
    const engineSubtitle = subtitles.find((t) => t.id === subtitleId);
    if (
      wantedSubtitle &&
      otherRegion(wantedSubtitle.Language, engineSubtitle?.lang)
    )
      subtitleId = wantedSubtitle.id;
  }

  const chosenAudio = audioPool.find((t) => t.id === audioId);
  const better =
    chosenAudio &&
    betterAudioFor(
      audioPool,
      chosenAudio,
      audioTypes(prefs),
      codes,
      prefs.PlayDefaultAudioTrack !== false
    );
  if (better) audioId = better.id;

  const playing = audio.find((t) => t.id === audioId);
  const languages = subtitleLanguages(prefs);
  const mode = prefs.SubtitleMode;
  const audioInLanguages = languages.some((l) =>
    sameLanguage(l, playing?.lang)
  );
  const chosen = subtitles.find((t) => t.id === subtitleId);
  if (chosen) {
    const onlyForced =
      mode === 'OnlyForced' || (mode === 'Smart' && audioInLanguages);
    const same = subtitles.filter(
      (t) =>
        t === chosen ||
        (!!t.lang &&
          !!chosen.lang &&
          languageCode(t.lang) === languageCode(chosen.lang))
    );
    const best = bestOfTypes(
      onlyForced ? same.filter((t) => forcedOnly(trackFacts(t))) : same,
      trackFacts,
      prefs
    );
    if (best) subtitleId = best.id;
  }

  if (mode === 'Always' || (mode === 'Smart' && !audioInLanguages)) {
    const shown = chosen?.server ?? subtitleId;
    for (const lang of languages) {
      const own = subtitles.some(
        (t) => !t.external && sameLanguage(lang, t.lang)
      );
      if (own) break;
      const offered = servers.filter((s) => sameLanguage(lang, s.lang));
      if (!offered.length) continue;
      if (!offered.some((s) => s.id === shown))
        subtitleId = bestOfTypes(offered, serverFacts, prefs)!.id;
      break;
    }
  }
  return { audio: audioId, subtitle: subtitleId };
}
