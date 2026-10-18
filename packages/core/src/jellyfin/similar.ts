import type { Meta, MetaPreview } from '../db/schemas.js';
import type { AIOStreams } from '../main/index.js';
import { IdMappingDataset } from '../metadata/id-mappings.js';
import { providerIdsFor, type Catalog } from './dto.js';
import { readEnrichment } from './enrichment.js';
import { getCatalogPage, supportsExtra } from './library.js';

const ID_PREFIXES: [string, string][] = [
  ['Imdb', ''],
  ['Tmdb', 'tmdb:'],
  ['Tvdb', 'tvdb:'],
  ['Kitsu', 'kitsu:'],
  ['MyAnimeList', 'mal:'],
  ['AniList', 'anilist:'],
  ['AniDB', 'anidb:'],
  ['Simkl', 'simkl:'],
];

function knownIds(type: string, id: string, meta: Meta | null): string[] {
  const ids = meta
    ? providerIdsFor(meta, readEnrichment(meta))
    : providerIdsFor({ id, type });
  const kind = type === 'movie' ? 'movie' : 'series';
  const mappings = IdMappingDataset.getInstance();
  const imdb =
    ids.Imdb ??
    mappings.imdbIdFor(kind, 'tmdb', Number(ids.Tmdb)) ??
    mappings.imdbIdFor(kind, 'tvdb', Number(ids.Tvdb));
  if (imdb) {
    const mapped = mappings.resolve(kind, {
      imdbId: imdb,
      tmdbId: Number(ids.Tmdb) || undefined,
      tvdbId: Number(ids.Tvdb) || undefined,
    });
    ids.Imdb = imdb;
    if (mapped.tmdbId) ids.Tmdb = String(mapped.tmdbId);
    if (mapped.tvdbId) ids.Tvdb = String(mapped.tvdbId);
  }
  return [
    ...new Set([
      id,
      ...(meta ? [meta.id] : []),
      ...ID_PREFIXES.flatMap(([key, prefix]) =>
        ids[key] ? [`${prefix}${ids[key]}`] : []
      ),
    ]),
  ];
}

/**
 * Titles like this one from the first `similar` catalog of its type with any,
 * or null when none has.
 */
export async function similarPreviews(
  engine: AIOStreams,
  type: string,
  id: string,
  meta: Meta | null,
  limit: number
): Promise<MetaPreview[] | null> {
  const catalogs = ((engine.getCatalogs() ?? []) as Catalog[]).filter(
    (c) =>
      c.type === type &&
      supportsExtra(c, 'similar') &&
      (c.extra ?? []).every((e) => !e.isRequired || e.name === 'similar')
  );
  if (!catalogs.length) return null;
  const ids = knownIds(type, id, meta);
  for (const catalog of catalogs) {
    const sent = catalog.idPrefixes?.length
      ? catalog.idPrefixes
          .map((prefix) => ids.find((i) => i.startsWith(prefix)))
          .find(Boolean)
      : id;
    if (!sent) continue;
    const page = await getCatalogPage(engine, catalog, {
      startIndex: 0,
      limit: limit + 1,
      similar: sent,
      singlePage: true,
    }).catch(() => null);
    const items =
      page?.items.filter((p) => p.type !== type || !ids.includes(p.id)) ?? [];
    if (items.length) return items.slice(0, limit);
  }
  return null;
}
