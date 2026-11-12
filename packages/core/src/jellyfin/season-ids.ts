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

function sourceOf(
  item: { id: string; type: string },
  providerIds: Record<string, string> | undefined,
  lookup: [string, IdType][]
): [IdType, string | number] | undefined {
  const parsed = IdParser.parse(item.id, item.type);
  if (parsed && lookup.some(([, type]) => type === parsed.type))
    return [parsed.type, parsed.value];
  const fallback = lookup.find(([key]) => providerIds?.[key]);
  return fallback && [fallback[1], providerIds![fallback[0]]];
}

function idsOf(mappings: AnimeEntryMappings | undefined) {
  const ids: Record<string, string> = {};
  for (const [field, key] of MAPPED) {
    const value = mappings?.[field];
    if (value != null && value !== '') ids[key] = String(value);
  }
  return ids;
}

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
  const source = sourceOf(show, providerIds, LOOKUP);
  if (!source) return out;
  const select = await AnimeDatabase.getInstance()
    .selectorFor(source[0], source[1])
    .catch(() => null);
  if (!select) return out;
  for (const season of seasons) {
    const ids = idsOf(select(season)?.mappings);
    if (Object.keys(ids).length) out.set(season, ids);
  }
  return out;
}

/**
 * A film's anime ids, for one from a catalog that gives only its IMDb id. TMDB
 * numbers films and shows separately, so its ids could name a show here.
 */
export async function filmAnimeIds(
  film: { id: string; type: string },
  providerIds: Record<string, string> | undefined
): Promise<Record<string, string>> {
  if (MAPPED.some(([, key]) => providerIds?.[key])) return {};
  const source = sourceOf(film, providerIds, [['Imdb', 'imdbId']]);
  if (!source) return {};
  const entry = await AnimeDatabase.getInstance()
    .getEntryById(source[0], source[1])
    .catch(() => null);
  return idsOf(entry?.mappings);
}
