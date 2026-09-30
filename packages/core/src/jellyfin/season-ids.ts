import { AnimeDatabase } from '../anime-database/index.js';
import type { AnimeEntryMappings } from '../anime-database/types.js';
import type { IdType } from '../utils/id-parser.js';

/** Jellyfin provider id -> the anime database's, best lookup first. */
const LOOKUP: [string, IdType][] = [
  ['Kitsu', 'kitsuId'],
  ['MyAnimeList', 'malId'],
  ['AniList', 'anilistId'],
  ['AniDB', 'anidbId'],
  ['Imdb', 'imdbId'],
  ['Tmdb', 'themoviedbId'],
  ['Tvdb', 'thetvdbId'],
];

const MAPPED: [keyof AnimeEntryMappings, string][] = [
  ['anidbId', 'AniDB'],
  ['malId', 'MyAnimeList'],
  ['anilistId', 'AniList'],
  ['kitsuId', 'Kitsu'],
];

/** Each season's own anime entry, for a show that spans several. */
export async function seasonAnimeIds(
  providerIds: Record<string, string> | undefined,
  seasons: number[]
): Promise<Map<number, Record<string, string>>> {
  const out = new Map<number, Record<string, string>>();
  const source = LOOKUP.find(([key]) => providerIds?.[key]);
  if (!source || !seasons.length) return out;
  const select = await AnimeDatabase.getInstance()
    .selectorFor(source[1], providerIds![source[0]])
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
