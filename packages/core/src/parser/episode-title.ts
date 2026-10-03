import { normaliseLanguage } from '../utils/languages.js';

/** Remove numbered presentation labels only when a real episode name follows. */
export function stripEpisodeTitleLabel(title: string): string {
  return title.replace(
    /^(?:chapter|episode|ep|part|session)[\s._-]+#?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|[ivxlcdm]+)[\s.:_-]+(?=\S)/i,
    (label, number: string) => {
      // Roman-letter words such as "Vic" and "Did" are not numerals.
      if (
        /^[ivxlcdm]+$/i.test(number) &&
        !/^m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/i.test(
          number
        )
      )
        return label;
      return '';
    }
  );
}

/** A complete subtitle/dub label is release information, not an episode name. */
export function isEpisodeTitleLanguageTag(title: string): boolean {
  const text = title.trim();
  const prefix =
    /^(?:sub(?:bed|titles?|s)?|dub(?:bed)?|vost)[ ._-]*(.+)$/i.exec(text);
  const suffix = /^(.+?)[ ._-]+(?:sub(?:bed|titles?|s)?|dub(?:bed)?)$/i.exec(
    text
  );
  return !!normaliseLanguage(prefix?.[1] ?? suffix?.[1]);
}
