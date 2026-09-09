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

/**
 * Every english_name spelling in FULL_LANGUAGE_MAPPING
 */
const ENTRY_BY_NAME = new Map<string, (typeof FULL_LANGUAGE_MAPPING)[number]>();
for (const entry of FULL_LANGUAGE_MAPPING) {
  const names = [
    entry.internal_english_name,
    entry.english_name,
    ...entry.english_name.split(';').map((name) => name.split('(')[0]),
  ];
  for (const name of names) {
    const key = name?.trim().toLowerCase();
    if (!key) continue;
    const existing = ENTRY_BY_NAME.get(key);
    if (!existing || (!existing.flag_priority && entry.flag_priority)) {
      ENTRY_BY_NAME.set(key, entry);
    }
  }
}

/**
 * Region qualifiers that are not ISO 3166-1 codes. `419` is the UN M49 code for
 * Latin America, which mapLanguageCode routes on.
 */
const REGION_ALIASES: Record<string, string> = {
  'latin america': '419',
  latam: '419',
  la: '419',
};

const QUALIFIER_PATTERN = /^(.*\S)\s*\(([^()]+)\)$/;
const MAX_INPUT_LENGTH = 64;

function toSupportedLanguage(
  entry: (typeof FULL_LANGUAGE_MAPPING)[number] | undefined
): string | undefined {
  if (!entry) return undefined;
  const candidate = getLanguageDisplayName(entry);
  return LANGUAGES.includes(candidate as (typeof LANGUAGES)[number])
    ? candidate
    : undefined;
}

/** Resolve a BCP 47 / ISO 639 code to its entry. */
function findEntryByCode(
  value: string
): (typeof FULL_LANGUAGE_MAPPING)[number] | undefined {
  const parts = mapLanguageCode(normaliseLangCode(value))
    .toLowerCase()
    .split('-');

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

  return possible.find((lang) => lang.flag_priority) ?? possible[0];
}

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
  let raw = value.trim();
  if (raw.length > MAX_INPUT_LENGTH) return undefined;

  // each pass strips one trailing qualifier, so this always terminates
  while (raw) {
    const byName = LANGUAGE_BY_NAME.get(raw.toLowerCase());
    if (byName) return byName;

    const byFullName = toSupportedLanguage(
      ENTRY_BY_NAME.get(raw.toLowerCase())
    );
    if (byFullName) return byFullName;

    const byCode = toSupportedLanguage(findEntryByCode(raw));
    if (byCode) return byCode;

    const qualified = QUALIFIER_PATTERN.exec(raw);
    if (!qualified) return undefined;

    const base = qualified[1].trim();
    const qualifier = qualified[2].trim();
    const baseCode =
      ENTRY_BY_NAME.get(base.toLowerCase())?.iso_639_1 ??
      findEntryByCode(base)?.iso_639_1;
    const region =
      REGION_ALIASES[qualifier.toLowerCase()] ??
      (/^[a-z]{2}$/i.test(qualifier) ? qualifier : undefined);

    if (baseCode && region) {
      const byRegion = toSupportedLanguage(
        findEntryByCode(`${baseCode}-${region}`)
      );
      if (byRegion) return byRegion;
    }

    raw = base;
  }

  return undefined;
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
  const cached = LANGUAGE_CODE_CACHE.get(language);
  if (cached !== undefined || LANGUAGE_CODE_CACHE.has(language)) return cached;

  const result = computeLanguageCode(language);
  // values come from parsed release names, so bound the cache rather than
  // letting junk input grow it forever
  if (LANGUAGE_CODE_CACHE.size >= LANGUAGE_CODE_CACHE_MAX) {
    LANGUAGE_CODE_CACHE.clear();
  }
  LANGUAGE_CODE_CACHE.set(language, result);
  return result;
}

/**
 * Scanning FULL_LANGUAGE_MAPPING costs ~70µs a call because every row is
 * re-split and re-lowercased. The stream formatter calls this a dozen times per
 * stream, so the result is memoised above.
 */
const LANGUAGE_CODE_CACHE = new Map<string, string | undefined>();
const LANGUAGE_CODE_CACHE_MAX = 1000;

function computeLanguageCode(language: string): string | undefined {
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

/**
 * Convert a language display name to a lower-case ISO 639-2 code ("por"),
 * the form Jellyfin clients expect on media streams.
 */
export function languageToIso6392(language: string): string | undefined {
  const needle = language.trim().toLowerCase();
  if (!needle) return undefined;
  const possible = FULL_LANGUAGE_MAPPING.filter(
    (lang) =>
      lang.english_name
        .split(';')
        .some((name) => name.split('(')[0].trim().toLowerCase() === needle) ||
      lang.internal_english_name?.toLowerCase() === needle ||
      lang.name.toLowerCase() === needle ||
      lang.iso_639_1?.toLowerCase() === needle ||
      lang.iso_639_2.toLowerCase() === needle
  );
  if (!possible.length) return undefined;
  const selected = possible.find((lang) => lang.flag_priority) ?? possible[0];
  return selected.iso_639_2.toLowerCase();
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
