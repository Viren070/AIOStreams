import { ParsedResult } from '@viren070/parse-torrent-title';

export type LibraryNameFormat = 'release' | 'title';

const pad = (num: number) => num.toString().padStart(2, '0');

function rangeLabel(prefix: string, values: number[]): string {
  const first = values[0];
  const last = values[values.length - 1];
  return first === last
    ? `${prefix}${pad(first)}`
    : `${prefix}${pad(first)}-${prefix}${pad(last)}`;
}

/**
 * A readable name for a library item: the title followed by its season/episode
 * range for series ("Rick and Morty S09E04", "Sex and the City S01-S06") or its
 * year for movies ("Mayday (2026)").
 *
 * `matched` is the title/year of a confident metadata match, which is preferred
 * over the parsed values because it has the canonical spelling and casing.
 */
export function formatLibraryItemName(
  parsed: ParsedResult,
  fallback: string,
  matched?: { title?: string; year?: number }
): string {
  const title = (matched?.title || parsed.title || fallback).trim();
  const seasons = parsed.seasons ?? [];
  const episodes = parsed.episodes ?? [];

  if (seasons.length > 0 || episodes.length > 0 || parsed.complete) {
    let suffix = '';
    if (seasons.length > 0) suffix += rangeLabel('S', seasons);
    if (episodes.length > 0) suffix += rangeLabel('E', episodes);
    if (!suffix && parsed.complete) suffix = 'Complete';
    return suffix ? `${title} ${suffix}` : title;
  }

  const year = parsed.year ? Number(parsed.year) : matched?.year;
  return year && !Number.isNaN(year) ? `${title} (${year})` : title;
}
