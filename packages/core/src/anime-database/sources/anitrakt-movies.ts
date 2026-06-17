/**
 * Rensetsu's "extended Anitrakt" movies dataset: MAL-to-Trakt mappings for
 * anime films, with TMDB/IMDb externals and the Trakt slug/title.
 */
import path from 'path';
import fs from 'fs/promises';
import { config as appConfig } from '../../config/index.js';
import { type SourceEntry } from '../types.js';
import { ANIME_DATABASE_PATH } from '../storage/paths.js';
import type { AnimeSource } from './base.js';

interface AnitraktMovieRaw {
  myanimelist?: { title?: string; id?: number };
  trakt?: { title?: string; id?: number; slug?: string; type?: string };
  release_year?: number;
  externals?: {
    tmdb?: number | null;
    imdb?: string | null;
  };
}

export const anitraktMoviesSource: AnimeSource = {
  id: 'anitrakt-movies',
  name: 'Extended Anitrakt Movies',
  url: 'https://github.com/rensetsu/db.trakt.extended-anitrakt/releases/download/latest/movies_ex.json',
  filePath: path.join(ANIME_DATABASE_PATH, 'anitrakt-movies-ex.json'),
  refreshIntervalMs() {
    return appConfig.metadata.animeDb.refresh.extendedAnitraktMovies * 1000;
  },
  async *parse(filePath: string): AsyncIterable<SourceEntry> {
    const text = await fs.readFile(filePath, 'utf8');
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) return;

    for (const raw of data as AnitraktMovieRaw[]) {
      if (!raw || typeof raw !== 'object') continue;
      const malId = raw.myanimelist?.id;
      const traktId = raw.trakt?.id;
      if (typeof malId !== 'number' || typeof traktId !== 'number') continue;
      if (raw.trakt?.type !== 'movies') continue;
      if (typeof raw.trakt.slug !== 'string') continue;
      if (typeof raw.trakt.title !== 'string') continue;

      const entry: SourceEntry = {
        ids: { malId, traktId },
        trakt: {
          id: traktId,
          slug: raw.trakt.slug,
          title: raw.trakt.title,
          type: 'movies',
        },
      };

      const externals = raw.externals ?? {};
      if (typeof externals.tmdb === 'number') {
        entry.ids.themoviedbId = externals.tmdb;
      }
      if (typeof externals.imdb === 'string' && externals.imdb) {
        entry.ids.imdbId = externals.imdb;
      }

      yield entry;
    }
  },
};
