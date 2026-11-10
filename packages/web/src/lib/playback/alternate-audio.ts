import { languageToIso6392B } from '@aiostreams/core/src/utils/languages';
import { languageCode, tagName } from '../languages';
import type { SourceInfo } from '../types';
import { needsAppPlayer } from './stream';

export interface OtherAudioMenu {
  /** The version playing before the first switch, pinned above the rest. */
  original?: AlternateAudio;
  options: AlternateAudio[];
  onOpenChange(open: boolean): void;
  onSelect(choice: AlternateAudio): void;
}

/** A language another version of the title plays, and that version. */
export interface AlternateAudio {
  language: string;
  label: string;
  source: SourceInfo & { Id: string };
}

/** A track's language as versions are compared by: ISO 639-2/B, or a canonical tag for a regional variant, and nothing for und, multi and the like. */
export function audioLanguage(
  tag: string | null | undefined
): string | undefined {
  const input = tag?.trim().replaceAll('_', '-');
  if (
    !input ||
    /^(?:und|mul|mis|zxx|unknown|dual audio|dubbed|multi|original)$/i.test(
      input
    )
  )
    return;
  if (tagName(input)) {
    if (/^[a-z]{2,3}-[a-z]{2}$|^[a-z]{2,3}-\d{3}$/i.test(input)) {
      return Intl.getCanonicalLocales(input)[0];
    }
    return languageCode(input);
  }
  const code = languageToIso6392B(input);
  return code && tagName(code) ? languageCode(code) : undefined;
}

/** The languages a version's audio tracks play, else the ones its addon listed. */
export function sourceAudioLanguages(source: SourceInfo): string[] {
  const tracks = (source.MediaStreams ?? [])
    .filter((track) => track.Type === 'Audio')
    .flatMap((track) => audioLanguage(track.Language) ?? []);
  return tracks.length
    ? tracks
    : (source.aiostreams?.languages ?? []).flatMap(
        (tag) => audioLanguage(tag) ?? []
      );
}

/** Browsers without an audio-track API play the file's default track. */
export function sourceDefaultsToAudio(
  source: SourceInfo,
  requested: string
): boolean {
  const tracks = (source.MediaStreams ?? []).filter(
    (track) => track.Type === 'Audio'
  );
  const index = source.DefaultAudioStreamIndex;
  const chosen =
    (index == null
      ? undefined
      : tracks.find((track) => track.Index === index)) ??
    tracks.find((track) => track.IsDefault);
  const language = audioLanguage(chosen?.Language);
  if (language) return language === requested;
  const available = new Set(sourceAudioLanguages(source));
  return available.size === 1 && available.has(requested);
}

/** A finite version this player can switch to: one it plays directly, or any at all for an app player that sends request headers. */
export function canPlayAudioSource(
  source: SourceInfo,
  nativeAudio = false
): source is SourceInfo & { Id: string } {
  return (
    !!source.Id &&
    source.Type !== 'Placeholder' &&
    !source.IsInfiniteStream &&
    (nativeAudio ||
      (!needsAppPlayer(source) && source.SupportsDirectPlay !== false))
  );
}

/** One result per missing language, preserving server order within each resolution preference. */
export function alternateAudio(
  current: SourceInfo,
  currentTracks: readonly { lang?: string }[],
  sources: readonly SourceInfo[],
  nativeAudio = false
): AlternateAudio[] {
  const currentLanguages = currentTracks.flatMap(
    (track) => audioLanguage(track.lang) ?? []
  );
  const present = new Set(
    currentLanguages.length ? currentLanguages : sourceAudioLanguages(current)
  );
  const options = new Map<string, AlternateAudio>();
  const resolution = current.aiostreams?.resolution;
  const sameResolution = (source: SourceInfo) =>
    !!resolution && source.aiostreams?.resolution === resolution;
  for (const source of sources) {
    if (!canPlayAudioSource(source, nativeAudio) || source.Id === current.Id)
      continue;
    for (const language of sourceAudioLanguages(source)) {
      if (present.has(language)) continue;
      const previous = options.get(language);
      if (
        previous &&
        (!sameResolution(source) || sameResolution(previous.source))
      )
        continue;
      options.set(language, {
        language,
        label: tagName(language) ?? language,
        source,
      });
    }
  }
  return [...options.values()];
}

/** The language the source plays now: the selected track's, else the first it advertises. */
export function playingAudioLanguage(
  source: SourceInfo,
  tracks: readonly { id: string; lang?: string }[],
  selected: string | null | undefined
): string | undefined {
  const available = sourceAudioLanguages(source);
  const playing = audioLanguage(
    tracks.find((track) => track.id === selected)?.lang
  );
  return playing && available.includes(playing) ? playing : available[0];
}

/**
 * The audio menu's versions: the original one pinned while another plays,
 * and the other languages without a second entry for the original's.
 */
export function audioChoices(
  current: SourceInfo,
  currentTracks: readonly { lang?: string }[],
  sources: readonly SourceInfo[],
  nativeAudio = false,
  original?: { sourceId: string; language: string }
): Pick<OtherAudioMenu, 'original' | 'options'> {
  const options = alternateAudio(current, currentTracks, sources, nativeAudio);
  const source =
    original && original.sourceId !== current.Id
      ? sources.find((candidate) => candidate.Id === original.sourceId)
      : undefined;
  if (!original || !source || !canPlayAudioSource(source, nativeAudio))
    return { options };
  return {
    original: {
      language: original.language,
      label: tagName(original.language) ?? original.language,
      source,
    },
    options: options.filter((choice) => choice.language !== original.language),
  };
}
