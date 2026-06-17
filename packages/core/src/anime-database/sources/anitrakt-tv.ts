/**
 * Rensetsu's "extended Anitrakt" TV dataset: MAL-to-Trakt mappings for anime
 * TV shows including per-cour Trakt season info, TMDB/TVDB/IMDb externals,
 * and an `is_split_cour` flag.
 */
import path from 'path';
import fs from 'fs/promises';
import { config as appConfig } from '../../config/index.js';
import { type SourceEntry } from '../types.js';
import { ANIME_DATABASE_PATH } from '../storage/paths.js';
import type { AnimeSource } from './base.js';

interface AnitraktTvRaw {
  myanimelist?: { title?: string; id?: number };
  trakt?: {
    title?: string;
    id?: number;
    slug?: string;
    type?: string;
    is_split_cour?: boolean;
    season?: {
      id?: number;
      number?: number;
      externals?: { tvdb?: number | null; tmdb?: number | null };
    } | null;
  };
  release_year?: number;
  externals?: {
    tvdb?: number | null;
    tmdb?: number | null;
    imdb?: string | null;
  };
}

export const anitraktTvSource: AnimeSource = {
  id: 'anitrakt-tv',
  name: 'Extended Anitrakt TV',
  url: 'https://github.com/rensetsu/db.trakt.extended-anitrakt/releases/download/latest/tv_ex.json',
  filePath: path.join(ANIME_DATABASE_PATH, 'anitrakt-tv-ex.json'),
  refreshIntervalMs() {
    return appConfig.metadata.animeDb.refresh.extendedAnitraktTv * 1000;
  },
  async *parse(filePath: string): AsyncIterable<SourceEntry> {
    const text = await fs.readFile(filePath, 'utf8');
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) return;

    for (const raw of data as AnitraktTvRaw[]) {
      if (!raw || typeof raw !== 'object') continue;
      const malId = raw.myanimelist?.id;
      const traktId = raw.trakt?.id;
      if (typeof malId !== 'number' || typeof traktId !== 'number') continue;
      if (raw.trakt?.type !== 'shows') continue;
      if (typeof raw.trakt.slug !== 'string') continue;
      if (typeof raw.trakt.title !== 'string') continue;
      if (typeof raw.trakt.is_split_cour !== 'boolean') continue;

      const entry: SourceEntry = {
        ids: { malId, traktId },
        trakt: {
          id: traktId,
          slug: raw.trakt.slug,
          title: raw.trakt.title,
          type: 'shows',
          isSplitCour: raw.trakt.is_split_cour,
          seasonNumber: raw.trakt.season?.number ?? null,
          seasonId: raw.trakt.season?.id ?? null,
        },
      };

      const externals = raw.externals ?? {};
      if (typeof externals.tvdb === 'number') {
        entry.ids.thetvdbId = externals.tvdb;
      }
      if (typeof externals.tmdb === 'number') {
        entry.ids.themoviedbId = externals.tmdb;
      }
      if (typeof externals.imdb === 'string' && externals.imdb) {
        entry.ids.imdbId = externals.imdb;
      }

      const seasonExt = raw.trakt.season?.externals;
      if (seasonExt) {
        if (typeof seasonExt.tmdb === 'number') {
          entry.tmdb = { ...(entry.tmdb ?? {}), seasonId: seasonExt.tmdb };
        }
        if (typeof seasonExt.tvdb === 'number') {
          entry.tvdb = { ...(entry.tvdb ?? {}), seasonId: seasonExt.tvdb };
        }
      }

      yield entry;
    }
  },
};
