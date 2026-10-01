import { AnimeDatabase } from '../anime-database/index.js';
import type { AnimeEntryMappings } from '../anime-database/types.js';
import { IdParser, type IdType } from '../utils/id-parser.js';

/** Jellyfin provider id -> the anime database's, show-wide ids first. */
const LOOKUP: [string, IdType][] = [
  ['Tvdb', 'thetvdbId'],
  ['Tmdb', 'themoviedbId'],
  ['Imdb', 'imdbId'],
  ['Kitsu', 'kitsuId'],
  ['MyAnimeList', 'malId'],
  ['AniList', 'anilistId'],
  ['AniDB', 'anidbId'],
];

const MAPPED: [keyof AnimeEntryMappings, string][] = [
  ['anidbId', 'AniDB'],
  ['malId', 'MyAnimeList'],
  ['anilistId', 'AniList'],
  ['kitsuId', 'Kitsu'],
];

/**
 * Each season's own anime entry, for a show that spans several. Looked up by
 * the show's own id, whose seasons these are; a multi-season show's anime ids
 * often name only its first season.
 */
export async function seasonAnimeIds(
  show: { id: string; type: string },
  providerIds: Record<string, string> | undefined,
  seasons: number[]
): Promise<Map<number, Record<string, string>>> {
  const out = new Map<number, Record<string, string>>();
  if (!seasons.length) return out;
  const parsed = IdParser.parse(show.id, show.type);
  const fallback = LOOKUP.find(([key]) => providerIds?.[key]);
  const source: [IdType, string | number] | undefined = parsed
    ? [parsed.type, parsed.value]
    : fallback && [fallback[1], providerIds![fallback[0]]];
  if (!source) return out;
  const select = await AnimeDatabase.getInstance()
    .selectorFor(source[0], source[1])
    .catch(() => null);
  if (!select) return out;
  for (const season of seasons) {
    const mappings = select(season)?.mappings;
    const ids: Record<string, string> = {};
    for (const [field, key] of MAPPED) {
      const value = mappings?.[field];
      if (value != null && value !== '') ids[key] = String(value);
    }
    if (Object.keys(ids).length) out.set(season, ids);
  }
  return out;
}
