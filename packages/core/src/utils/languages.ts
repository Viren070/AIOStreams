import { FULL_LANGUAGE_MAPPING } from './language-list.js';
import { LANGUAGES } from './constants.js';

/**
 * Returns the canonical display name for a language entry.
 * internal_english_name is used verbatim it is manually curated and already correct.
 * english_name is split on `;` or `(` to strip region/variant qualifiers.
 */
export function getLanguageDisplayName(entry: {
  internal_english_name?: string;
  english_name: string;
}): string {
  if (entry.internal_english_name) return entry.internal_english_name;
  return entry.english_name.split(/;|\(/)[0].trim();
}

// ISO 639-2 legacy alias normalisation

const LANGUAGE_ALIAS_MAP: Record<string, string> = {
  fre: 'fra',
  ger: 'deu',
  cze: 'ces',
  slo: 'slk',
  rum: 'ron',
  dut: 'nld',
  gre: 'ell',
  alb: 'sqi',
  baq: 'eus',
  bur: 'mya',
  chi: 'zho',
  per: 'fas',
  arm: 'hye',
  geo: 'kat',
  ice: 'isl',
  mac: 'mkd',
  mao: 'mri',
  may: 'msa',
  tib: 'bod',
  wel: 'cym',
};

/** Resolve a deprecated ISO 639-2 alias to its preferred form (lowercased). */
export function normaliseLangCode(code: string): string {
  const lower = code.toLowerCase().trim();
  return LANGUAGE_ALIAS_MAP[lower] ?? lower;
}

const LANGUAGE_BY_NAME = new Map<string, string>(
  LANGUAGES.map((lang) => [lang.toLowerCase(), lang])
);

// Public utilities

/** Normalise well-known BCP 47 variants to the canonical code used in FULL_LANGUAGE_MAPPING. */
export function mapLanguageCode(code: string): string {
  switch (code.toLowerCase()) {
    case 'zh-tw':
    case 'zh-hans':
      return 'zh';
    case 'es-419':
      return 'es-MX';
    default:
      return code;
  }
}

/** Convert a BCP 47 code (e.g. "pt-BR") to a LANGUAGES display name. */
export function convertLangCodeToName(code: string): string | undefined {
  const parts = code.split('-');
  const possibleLangs = FULL_LANGUAGE_MAPPING.filter((language) => {
    if (parts.length === 2) {
      return (
        language.iso_639_1?.toLowerCase() === parts[0].toLowerCase() &&
        language.iso_3166_1?.toLowerCase() === parts[1].toLowerCase()
      );
    }
    return language.iso_639_1?.toLowerCase() === parts[0].toLowerCase();
  });
  const chosenLang =
    possibleLangs.find((lang) => lang.flag_priority) || possibleLangs[0];
  if (!chosenLang) return undefined;
  const candidateLang = getLanguageDisplayName(chosenLang);
  return LANGUAGES.includes(candidateLang as any) ? candidateLang : undefined;
}

/**
 * Normalise any language value (display name or code string) to a LANGUAGES
 * display name. Returns undefined if unrecognised.
 */
export function normaliseLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  const byName = LANGUAGE_BY_NAME.get(raw.toLowerCase());
  if (byName) return byName;

  const code = normaliseLangCode(raw);
  const parts = code.split('-');

  const possible = FULL_LANGUAGE_MAPPING.filter((lang) => {
    if (parts.length === 2) {
      return (
        lang.iso_639_1?.toLowerCase() === parts[0] &&
        lang.iso_3166_1?.toLowerCase() === parts[1]
      );
    }
    return (
      lang.iso_639_1?.toLowerCase() === parts[0] ||
      lang.iso_639_2?.toLowerCase() === parts[0]
    );
  });

  const chosen = possible.find((lang) => lang.flag_priority) ?? possible[0];
  if (!chosen) return undefined;

  const candidate = getLanguageDisplayName(chosen);
  return LANGUAGES.includes(candidate as (typeof LANGUAGES)[number])
    ? candidate
    : undefined;
}

// Languages where the ISO 639-1 code is not sufficient to disambiguate between multiple languages with the same name
// so we append the country code in those cases.
const AMBIGIOUS_LANGUAGES = new Set(
  ['Latino', 'Portuguese (Brazil)'].map((lang) => lang.toLowerCase())
);
/**
 * Convert a LANGUAGES display name (e.g. "Portuguese") to an
 * upper-case ISO 639-1 code (e.g. "PT"). Returns undefined if unrecognised.
 */
export function languageToCode(language: string): string | undefined {
  const possibleLangs = FULL_LANGUAGE_MAPPING.filter(
    (lang) =>
      lang.english_name
        .split(';')
        .some(
          (name) =>
            name.split('(')[0].trim().toLowerCase() === language.toLowerCase()
        ) ||
      (lang.internal_english_name &&
        lang.internal_english_name.toLowerCase() === language.toLowerCase()) ||
      lang.name.toLowerCase() === language.toLowerCase()
  );
  if (possibleLangs.length === 0) return undefined;
  const selectedLang =
    possibleLangs.find((lang) => lang.flag_priority) ?? possibleLangs[0];
  if (
    AMBIGIOUS_LANGUAGES.has(getLanguageDisplayName(selectedLang).toLowerCase())
  ) {
    return `${selectedLang.iso_639_1?.toUpperCase()}-${selectedLang.iso_3166_1?.toUpperCase()}`;
  }
  return selectedLang.iso_639_1?.toUpperCase();
}

/** Convert an ISO 639-1 code (e.g. "pt") to a display name. */
export function iso6391ToLanguage(code: string): string | undefined {
  const langs = FULL_LANGUAGE_MAPPING.filter(
    (lang) => lang.iso_639_1?.toLowerCase() === code.toLowerCase()
  );
  if (langs.length === 0) return undefined;
  const selectedLang = langs.find((lang) => lang.flag_priority) ?? langs[0];
  return getLanguageDisplayName(selectedLang);
}

/** Convert an ISO 3166-1 country code (e.g. "BR") to an ISO 639-1 language code. */
export function iso31661ToIso6391(countryCode: string): string | undefined {
  const entry =
    FULL_LANGUAGE_MAPPING.find(
      (lang) =>
        lang.iso_3166_1?.toLowerCase() === countryCode.toLowerCase() &&
        lang.flag_priority
    ) ??
    FULL_LANGUAGE_MAPPING.find(
      (lang) => lang.iso_3166_1?.toLowerCase() === countryCode.toLowerCase()
    );
  return entry?.iso_639_1 || undefined;
}

/** Convert an ISO 639-2/3 code (e.g. "por") to an ISO 639-1 code. */
export function iso6392ToIso6391(code: string): string | undefined {
  const entry = FULL_LANGUAGE_MAPPING.find(
    (lang) => (lang as any).iso_639_2?.toLowerCase() === code.toLowerCase()
  );
  return entry?.iso_639_1 || undefined;
}

const languageEmojiMap: Record<string, string> = {
  multi: '🌎',
  english: '🇬🇧',
  japanese: '🇯🇵',
  chinese: '🇨🇳',
  russian: '🇷🇺',
  arabic: '🇸🇦',
  portuguese: '🇵🇹',
  'portuguese (brazil)': '🇧🇷',
  spanish: '🇪🇸',
  french: '🇫🇷',
  german: '🇩🇪',
  italian: '🇮🇹',
  korean: '🇰🇷',
  hindi: '🇮🇳',
  bengali: '🇧🇩',
  punjabi: '🇵🇰',
  marathi: '🇮🇳',
  gujarati: '🇮🇳',
  tamil: '🇮🇳',
  telugu: '🇮🇳',
  kannada: '🇮🇳',
  malayalam: '🇮🇳',
  thai: '🇹🇭',
  vietnamese: '🇻🇳',
  indonesian: '🇮🇩',
  turkish: '🇹🇷',
  hebrew: '🇮🇱',
  persian: '🇮🇷',
  ukrainian: '🇺🇦',
  greek: '🇬🇷',
  lithuanian: '🇱🇹',
  latvian: '🇱🇻',
  estonian: '🇪🇪',
  polish: '🇵🇱',
  czech: '🇨🇿',
  slovak: '🇸🇰',
  hungarian: '🇭🇺',
  romanian: '🇷🇴',
  bulgarian: '🇧🇬',
  serbian: '🇷🇸',
  croatian: '🇭🇷',
  slovenian: '🇸🇮',
  dutch: '🇳🇱',
  danish: '🇩🇰',
  finnish: '🇫🇮',
  swedish: '🇸🇪',
  norwegian: '🇳🇴',
  malay: '🇲🇾',
  latino: '💃🏻',
  Latino: '🇲🇽',
};

export function languageToEmoji(language: string): string | undefined {
  return languageEmojiMap[language.toLowerCase()];
}

export function emojiToLanguage(emoji: string): string | undefined {
  return Object.entries(languageEmojiMap).find(
    ([_, value]) => value === emoji
  )?.[0];
}
