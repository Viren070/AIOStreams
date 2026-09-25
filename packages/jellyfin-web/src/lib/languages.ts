/**
 * Jellyfin stores a preferred language as its ISO 639-2/B code; files tag
 * tracks with that, the /T code or the two-letter one.
 */
export interface Language {
  code: string;
  name: string;
  aliases: string[];
}

export const LANGUAGES: Language[] = [
  { code: 'eng', name: 'English', aliases: ['en'] },
  { code: 'ara', name: 'Arabic', aliases: ['ar'] },
  { code: 'ben', name: 'Bengali', aliases: ['bn'] },
  { code: 'bul', name: 'Bulgarian', aliases: ['bg'] },
  { code: 'cat', name: 'Catalan', aliases: ['ca'] },
  { code: 'chi', name: 'Chinese', aliases: ['zho', 'zh'] },
  { code: 'hrv', name: 'Croatian', aliases: ['hr'] },
  { code: 'cze', name: 'Czech', aliases: ['ces', 'cs'] },
  { code: 'dan', name: 'Danish', aliases: ['da'] },
  { code: 'dut', name: 'Dutch', aliases: ['nld', 'nl'] },
  { code: 'est', name: 'Estonian', aliases: ['et'] },
  { code: 'fil', name: 'Filipino', aliases: ['tgl', 'tl'] },
  { code: 'fin', name: 'Finnish', aliases: ['fi'] },
  { code: 'fre', name: 'French', aliases: ['fra', 'fr'] },
  { code: 'ger', name: 'German', aliases: ['deu', 'de'] },
  { code: 'gre', name: 'Greek', aliases: ['ell', 'el'] },
  { code: 'heb', name: 'Hebrew', aliases: ['he'] },
  { code: 'hin', name: 'Hindi', aliases: ['hi'] },
  { code: 'hun', name: 'Hungarian', aliases: ['hu'] },
  { code: 'ice', name: 'Icelandic', aliases: ['isl', 'is'] },
  { code: 'ind', name: 'Indonesian', aliases: ['id'] },
  { code: 'ita', name: 'Italian', aliases: ['it'] },
  { code: 'jpn', name: 'Japanese', aliases: ['ja'] },
  { code: 'kor', name: 'Korean', aliases: ['ko'] },
  { code: 'lav', name: 'Latvian', aliases: ['lv'] },
  { code: 'lit', name: 'Lithuanian', aliases: ['lt'] },
  { code: 'may', name: 'Malay', aliases: ['msa', 'ms'] },
  { code: 'nor', name: 'Norwegian', aliases: ['nob', 'nno', 'no', 'nb'] },
  { code: 'per', name: 'Persian', aliases: ['fas', 'fa'] },
  { code: 'pol', name: 'Polish', aliases: ['pl'] },
  { code: 'por', name: 'Portuguese', aliases: ['pt'] },
  { code: 'rum', name: 'Romanian', aliases: ['ron', 'ro'] },
  { code: 'rus', name: 'Russian', aliases: ['ru'] },
  { code: 'srp', name: 'Serbian', aliases: ['sr'] },
  { code: 'slo', name: 'Slovak', aliases: ['slk', 'sk'] },
  { code: 'slv', name: 'Slovenian', aliases: ['sl'] },
  { code: 'spa', name: 'Spanish', aliases: ['es'] },
  { code: 'swe', name: 'Swedish', aliases: ['sv'] },
  { code: 'tam', name: 'Tamil', aliases: ['ta'] },
  { code: 'tel', name: 'Telugu', aliases: ['te'] },
  { code: 'tha', name: 'Thai', aliases: ['th'] },
  { code: 'tur', name: 'Turkish', aliases: ['tr'] },
  { code: 'ukr', name: 'Ukrainian', aliases: ['uk'] },
  { code: 'vie', name: 'Vietnamese', aliases: ['vi'] },
];

/** Every tag a track in this language may carry; empty when none is set. */
export function languageTags(code: string | null | undefined): string[] {
  if (!code) return [];
  const language = LANGUAGES.find((l) => l.code === code.toLowerCase());
  return language ? [language.code, ...language.aliases] : [code.toLowerCase()];
}

export function sameLanguage(
  code: string | null | undefined,
  tag: string | null | undefined
): boolean {
  return !!tag && languageTags(code).includes(tag.toLowerCase());
}
