export interface Metadata {
  title: string;
  titles?: string[];
  year?: number;
  yearEnd?: number;
  releaseDate?: string;
  seasons?: {
    season_number: number;
    episode_count: number;
  }[];
  tmdbId?: number | null;
  tvdbId?: number | null;
  originalLanguage?: string;
}

import { FULL_LANGUAGE_MAPPING } from '../utils/languages.js';

/**
 * Converts an ISO 639-1 language code to the full English language name
 * @param isoCode - ISO 639-1 code like "ja", "en", "ko"
 * @returns Full language name like "Japanese", "English", "Korean" or undefined if not found
 */
export function getLanguageFromIsoCode(isoCode: string): string | undefined {
  const language = FULL_LANGUAGE_MAPPING.find(lang => lang.iso_639_1 === isoCode);
  return language?.english_name;
}
