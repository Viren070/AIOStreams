/**
 * A match key is an item's key under the preferred id the anime database gives
 * it, or else under the IMDb id the id mappings give a TVDB or TMDB id. It is
 * only ever looked up alongside a row's own key, never instead of it.
 */
import { AnimeDatabase } from '../anime-database/index.js';
import { enrichParsedIdWithAnimeEntry } from '../anime-database/enrich.js';
import type {
  AnimeEntry,
  AnimeEntryMappings,
} from '../anime-database/types.js';
import { IdMappingDataset } from '../metadata/id-mappings.js';
import { config as appConfig } from '../config/index.js';
import { IdParser, type ParsedId } from '../utils/id-parser.js';
import { createLogger } from '../logging/logger.js';
import {
  identityFor,
  itemKeyFor,
  type ContentRef,
  type WatchIdentity,
} from './types.js';

const logger = createLogger('watch-state');

/** Fixed order, because every spelling has to arrive at the same answer. */
const PREFERRED: [keyof AnimeEntryMappings, string][] = [
  ['imdbId', ''],
  ['thetvdbId', 'tvdb:'],
  ['kitsuId', 'kitsu:'],
  ['malId', 'mal:'],
  ['anilistId', 'anilist:'],
];

function preferredBase(mappings?: AnimeEntryMappings): string | null {
  for (const [key, prefix] of PREFERRED) {
    const value = mappings?.[key];
    if (value === undefined || value === null || value === '') continue;
    return `${prefix}${value}`;
  }
  return null;
}

interface Lookup {
  parsed: ParsedId;
  season?: number;
  episode?: number;
}

function lookupOf(ref: ContentRef): Lookup | null {
  if (ref.kind !== 'episode' && ref.kind !== 'movie') return null;
  const source = ref.videoId || ref.baseId;
  if (!source) return null;
  const parsed = IdParser.parse(source, ref.type);
  if (!parsed) return null;
  return {
    parsed,
    season: parsed.season ? Number(parsed.season) : (ref.season ?? undefined),
    episode: parsed.episode
      ? Number(parsed.episode)
      : (ref.episode ?? undefined),
  };
}

const ENTRY_NUMBERED: ParsedId['type'][] = ['kitsuId', 'malId', 'anilistId'];

/**
 * The anime-list ranges count AniDB episodes, which are the entry's own numbers
 * only when the entry is the whole show in TVDB's absolute order.
 */
function tvdbEpisodeOf(
  parsed: ParsedId,
  entry: AnimeEntry
): { season: number; episode: number } | null {
  if (!entry.tvdb.absoluteOrder || !ENTRY_NUMBERED.includes(parsed.type)) {
    return null;
  }
  const episode = Number(parsed.episode);
  if (!Number.isInteger(episode)) return null;
  const range = entry.episodeMappings?.find(
    (m) =>
      m.anidbSeason === 1 &&
      m.start !== undefined &&
      m.end !== undefined &&
      episode >= m.start &&
      episode <= m.end &&
      m.tvdbSeason !== undefined &&
      m.offset !== undefined
  );
  if (range?.tvdbSeason === undefined || range.offset === undefined) {
    return null;
  }
  return { season: range.tvdbSeason, episode: episode + range.offset };
}

function matchKeyWith(
  ref: ContentRef,
  lookup: Lookup,
  entry: AnimeEntry | null
): string | null {
  if (!entry) return null;
  const base = preferredBase(entry.mappings);
  if (!base) return null;
  if (ref.kind === 'movie') {
    return itemKeyFor({ ...ref, baseId: base, videoId: base });
  }

  const placed = tvdbEpisodeOf(lookup.parsed, entry);
  if (placed) {
    lookup.parsed.season = String(placed.season);
    lookup.parsed.episode = String(placed.episode);
  } else {
    // Fills season and episode in place, applying any cour offset.
    enrichParsedIdWithAnimeEntry(lookup.parsed, entry);
  }
  const episode = lookup.parsed.episode
    ? Number(lookup.parsed.episode)
    : ref.episode;
  if (episode == null) return null;
  const season = lookup.parsed.season
    ? Number(lookup.parsed.season)
    : ref.season;
  return itemKeyFor({
    ...ref,
    baseId: base,
    season: season ?? null,
    episode,
    videoId:
      season == null ? `${base}:${episode}` : `${base}:${season}:${episode}`,
  });
}

const MAPPED: Partial<Record<ParsedId['type'], 'tvdb' | 'tmdb'>> = {
  thetvdbId: 'tvdb',
  themoviedbId: 'tmdb',
};

/** The mappings name shows, not episodes, so numbers carry over unchanged. */
function mappedMatchKey(ref: ContentRef, lookup: Lookup): string | null {
  const provider = MAPPED[lookup.parsed.type];
  if (!provider || !appConfig.metadata.idMappings.enabled) return null;
  const base = IdMappingDataset.getInstance().imdbIdFor(
    ref.kind === 'movie' ? 'movie' : 'series',
    provider,
    Number(lookup.parsed.value)
  );
  if (!base) return null;
  if (ref.kind === 'movie') {
    return itemKeyFor({ ...ref, baseId: base, videoId: base });
  }
  const { season, episode } = lookup;
  if (season == null || episode == null) return null;
  return itemKeyFor({
    ...ref,
    baseId: base,
    season,
    episode,
    videoId: `${base}:${season}:${episode}`,
  });
}

function logMiss(ref: ContentRef, error: unknown) {
  logger.debug(
    {
      id: ref.videoId ?? ref.baseId,
      err: error instanceof Error ? error.message : String(error),
    },
    'could not resolve a watch-state match key'
  );
}

export async function matchKeyFor(ref: ContentRef): Promise<string | null> {
  try {
    const lookup = lookupOf(ref);
    if (!lookup) return null;
    const entry = await AnimeDatabase.getInstance().getEntryById(
      lookup.parsed.type,
      lookup.parsed.value,
      lookup.season,
      lookup.episode
    );
    return matchKeyWith(ref, lookup, entry) ?? mappedMatchKey(ref, lookup);
  } catch (error) {
    logMiss(ref, error);
    return null;
  }
}

/** Keyed by each reference's own key; one anime-database read per distinct id. */
export async function matchKeysFor(
  refs: ContentRef[]
): Promise<Map<string, string | null>> {
  type Selector = (season?: number, episode?: number) => AnimeEntry | null;
  const out = new Map<string, string | null>();
  const selectors = new Map<string, Promise<Selector | null>>();
  for (const ref of refs) {
    const key = itemKeyFor(ref);
    if (out.has(key)) continue;
    try {
      const lookup = lookupOf(ref);
      if (!lookup) {
        out.set(key, null);
        continue;
      }
      const id = `${lookup.parsed.type}:${lookup.parsed.value}`;
      let selector = selectors.get(id);
      if (!selector) {
        selector = AnimeDatabase.getInstance()
          .selectorFor(lookup.parsed.type, lookup.parsed.value)
          .catch((error: unknown) => {
            logMiss(ref, error);
            return null;
          });
        selectors.set(id, selector);
      }
      const select = await selector;
      out.set(
        key,
        (select
          ? matchKeyWith(ref, lookup, select(lookup.season, lookup.episode))
          : null) ?? mappedMatchKey(ref, lookup)
      );
    } catch (error) {
      logMiss(ref, error);
      out.set(key, null);
    }
  }
  return out;
}

export async function watchIdentityFor(
  ref: ContentRef
): Promise<WatchIdentity> {
  return { ...identityFor(ref), matchKey: await matchKeyFor(ref) };
}
