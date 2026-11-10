import { languageToIso6392B } from '@aiostreams/core/src/utils/languages';
import { languageCode, tagName } from '../languages';
import type { SourceInfo } from '../types';
import { needsAppPlayer } from './stream';

export interface OtherAudioMenu {
  options: AlternateAudio[];
  onOpenChange(open: boolean): void;
  onSelect(choice: AlternateAudio): void;
}

export interface AlternateAudio {
  language: string;
  label: string;
  source: SourceInfo & { Id: string };
}

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

export function browserAudioSource(
  source: SourceInfo
): source is SourceInfo & { Id: string } {
  return (
    !!source.Id &&
    source.Type !== 'Placeholder' &&
    !source.IsInfiniteStream &&
    !needsAppPlayer(source) &&
    source.SupportsDirectPlay !== false
  );
}

/** One result per missing language, preserving server order within each resolution preference. */
export function alternateAudio(
  current: SourceInfo,
  currentTracks: readonly { lang?: string }[],
  sources: readonly SourceInfo[]
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
    if (!browserAudioSource(source) || source.Id === current.Id) continue;
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
