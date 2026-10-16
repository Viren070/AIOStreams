import { i18n } from '@lingui/core';
import {
  iso6392ToIso6391,
  languageToIso6392B,
  tagLanguage,
} from '@aiostreams/core/src/utils/languages';
import { LANGUAGES as FILTER_LANGUAGES } from '@aiostreams/core/src/utils/language-list';

/**
 * Jellyfin stores a preferred language as its ISO 639-2/B code; the two the
 * addon's filters tell apart from their language keep their region.
 */
export interface Language {
  code: string;
  name: string;
}

/* eslint-disable lingui/no-unlocalized-strings -- the addon's own names */

/** Filter labels for several languages or none. */
const NOT_LANGUAGES = ['Dual Audio', 'Dubbed', 'Multi', 'Original', 'Unknown'];

const REGIONAL: Record<string, string> = {
  Latino: 'es-MX',
  'Portuguese (Brazil)': 'pt-BR',
};

/** Not in the filters' list, but in settings that name them. */
const EXTRA: Language[] = [
  { code: 'cat', name: 'Catalan' },
  { code: 'fil', name: 'Filipino' },
  { code: 'ice', name: 'Icelandic' },
];

/* eslint-enable lingui/no-unlocalized-strings */

export const LANGUAGES: Language[] = [
  ...FILTER_LANGUAGES.filter((name) => !NOT_LANGUAGES.includes(name)).flatMap(
    (name) => {
      const code = REGIONAL[name] ?? languageToIso6392B(name);
      return code ? [{ code, name }] : [];
    }
  ),
  ...EXTRA,
].sort((a, b) =>
  a.name === 'English'
    ? -1
    : b.name === 'English'
      ? 1
      : a.name.localeCompare(b.name)
);

/** A language's name in the app's language; English keeps the addon's names. */
export function languageName(language: Language): string {
  if (i18n.locale.startsWith('en')) return language.name;
  const { code } = language;
  const tag = code.includes('-') ? code : (iso6392ToIso6391(code) ?? code);
  try {
    return (
      new Intl.DisplayNames([i18n.locale], {
        type: 'language',
        fallback: 'none',
      }).of(tag) ?? language.name
    );
  } catch {
    return language.name;
  }
}

/** A code or tag's language by the addon's mapping, else the tag itself. */
const languageOf = (tag: string) => tagLanguage(tag) ?? tag.toLowerCase();

/** The code Jellyfin stores for the language a track's tag names. */
export function languageCode(tag: string): string {
  const language = languageOf(tag);
  return (
    LANGUAGES.find((l) => languageOf(l.code) === language)?.code ??
    tag.toLowerCase()
  );
}

export function sameLanguage(
  code: string | null | undefined,
  tag: string | null | undefined
): boolean {
  return !!code && !!tag && languageOf(code) === languageOf(tag);
}

/** The first of `items` in the earliest of `codes` that any is in. */
export function firstInLanguages<T>(
  codes: string[],
  items: T[],
  tagOf: (item: T) => string | null | undefined
): T | undefined {
  for (const code of codes) {
    const found = items.find((item) => sameLanguage(code, tagOf(item)));
    if (found) return found;
  }
  return undefined;
}
