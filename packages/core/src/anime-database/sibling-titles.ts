import { cleanTitle, normaliseTitle } from '../parser/utils.js';
import type { AnimeEntry, AnimeRecord } from './types.js';

/** Only titles explicitly belonging to another part, never shared franchise aliases. */
export function getSiblingTitles(
  chosen: AnimeRecord,
  candidates: AnimeRecord[]
): string[] {
  const own = new Set(
    [chosen.title, ...(chosen.synonyms ?? [])]
      .filter((title): title is string => !!title)
      .map(normaliseTitle)
      .filter(Boolean)
  );
  if (!own.size) return [];
  const siblings = new Map<string, string>();
  for (const candidate of candidates) {
    if (candidate.rid === chosen.rid) continue;
    for (const title of [candidate.title, ...(candidate.synonyms ?? [])]) {
      if (!title) continue;
      const key = normaliseTitle(title);
      if (key && !own.has(key)) siblings.set(key, title);
    }
  }
  return [...siblings.values()];
}

/** Explicit season numbering can qualify a generic parent title, but not a different sequel. */
export function isExplicitAnimeParentTitle(
  title: string,
  entry: AnimeEntry | null | undefined,
  seasons: number[] | undefined,
  requestedSeason: number
): boolean {
  if (!entry || !seasons?.includes(requestedSeason)) return false;
  const parent = cleanTitle(title.replace(/[._]/g, ' '));
  return [entry.title, ...(entry.synonyms ?? [])].some(
    (own) =>
      own && cleanTitle(own.replace(/[._]/g, ' ')).startsWith(`${parent} `)
  );
}

/** Recover a known title before an episode token if parsing stripped a word such as Kan. */
export function getAnimeReleaseTitle(
  parsedTitle: string,
  filename: string | undefined,
  entry: AnimeEntry | null | undefined
): string {
  if (!entry?.siblingTitles?.length || !filename) return parsedTitle;
  const name = filename.replace(/^(?:\s*\[[^\]]+\][\s._-]*)+/, '');
  const names = [name, name.replace(/^[\w]+-/, '')].map((name) =>
    cleanTitle(name.replace(/[._()[\]]/g, ' '))
  );
  const titles = new Map(
    [entry.title, ...(entry.synonyms ?? []), ...entry.siblingTitles]
      .filter((title): title is string => !!title)
      .map((title) => [
        cleanTitle(title.replace(/[._()[\]]/g, ' ')).replace(/\s/g, ''),
        title,
      ])
  );
  let matched = parsedTitle;
  let longest = 0;
  for (const name of names) {
    // Ignore title whitespace like sibling deduplication, but preserve the
    // episode boundary and exact words (including "Kan").
    for (const episode of name.matchAll(
      /\s(?:s\d{1,2}\s*e\d{1,4}|\d{1,2}x\d{1,4}|e\d{1,4}|\d{1,4})(?:v\d+)?(?=\s|$)/gi
    )) {
      const key = name.slice(0, episode.index).replace(/\s/g, '');
      const title = titles.get(key);
      if (title && key.length > longest) {
        matched = title;
        longest = key.length;
      }
    }
  }
  return matched;
}
