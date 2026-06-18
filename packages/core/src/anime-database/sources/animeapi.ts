import path from 'path';
import { config as appConfig } from '../../config/index.js';
import { AnimeType, type SourceEntry } from '../types.js';
import { ANIME_DATABASE_PATH } from '../storage/paths.js';
import { streamJsonArray } from '../storage/streaming.js';
import type { AnimeSource } from './base.js';

interface AnimeApiRaw {
  title?: string;
  anidb?: number | null;
  anilist?: number | null;
  animeplanet?: string | null;
  anisearch?: number | null;
  imdb?: string | null;
  kitsu?: number | null;
  livechart?: number | null;
  myanimelist?: number | null;
  notify?: string | null;
  simkl?: number | null;
  themoviedb?: number | null;
  themoviedb_season_id?: number | null;
  themoviedb_type?: 'movie' | 'tv' | null;
  thetvdb?: number | null;
  thetvdb_season_id?: number | null;
  trakt?: number | null;
  trakt_may_invalid?: boolean | null;
  trakt_season?: number | null;
  trakt_season_id?: number | null;
  trakt_slug?: string | null;
  trakt_type?: 'movies' | 'shows' | null;
}

export const animeApiSource: AnimeSource = {
  id: 'animeapi',
  name: 'AnimeApi (nattadasu)',
  url: 'https://raw.githubusercontent.com/nattadasu/animeApi/refs/heads/v3/database/animeapi.json',
  filePath: path.join(ANIME_DATABASE_PATH, 'animeapi.json'),
  refreshIntervalMs() {
    return appConfig.metadata.animeDb.refresh.animeApi * 1000;
  },
  async *parse(filePath: string): AsyncIterable<SourceEntry> {
    for await (const raw of streamJsonArray<AnimeApiRaw>(filePath)) {
      if (!raw || typeof raw !== 'object') continue;

      const ids: SourceEntry['ids'] = {};
      const set = <K extends keyof SourceEntry['ids']>(
        k: K,
        v: SourceEntry['ids'][K] | null | undefined
      ) => {
        if (v !== null && v !== undefined && v !== '') ids[k] = v;
      };
      set('anidbId', raw.anidb ?? undefined);
      set('anilistId', raw.anilist ?? undefined);
      set('animePlanetId', raw.animeplanet ?? undefined);
      set('anisearchId', raw.anisearch ?? undefined);
      set('imdbId', raw.imdb ?? undefined);
      set('kitsuId', raw.kitsu ?? undefined);
      set('livechartId', raw.livechart ?? undefined);
      set('malId', raw.myanimelist ?? undefined);
      set('notifyMoeId', raw.notify ?? undefined);
      set('simklId', raw.simkl ?? undefined);
      set('themoviedbId', raw.themoviedb ?? undefined);
      set('thetvdbId', raw.thetvdb ?? undefined);
      set('traktId', raw.trakt ?? undefined);

      if (Object.keys(ids).length === 0) continue;

      const entry: SourceEntry = {
        type: AnimeType.UNKNOWN,
        ids,
        title: typeof raw.title === 'string' ? raw.title : undefined,
      };

      if (
        raw.themoviedb_type === 'movie' ||
        raw.themoviedb_type === 'tv' ||
        typeof raw.themoviedb_season_id === 'number'
      ) {
        entry.tmdb = {
          ...(entry.tmdb ?? {}),
          type: raw.themoviedb_type ?? undefined,
          seasonId:
            typeof raw.themoviedb_season_id === 'number'
              ? raw.themoviedb_season_id
              : undefined,
        };
      }

      if (typeof raw.thetvdb_season_id === 'number') {
        entry.tvdb = {
          ...(entry.tvdb ?? {}),
          seasonId: raw.thetvdb_season_id,
        };
      }

      if (
        typeof raw.trakt === 'number' ||
        typeof raw.trakt_season === 'number' ||
        typeof raw.trakt_season_id === 'number' ||
        typeof raw.trakt_slug === 'string' ||
        raw.trakt_type === 'movies' ||
        raw.trakt_type === 'shows' ||
        typeof raw.trakt_may_invalid === 'boolean'
      ) {
        entry.trakt = {
          id: raw.trakt ?? undefined,
          slug: raw.trakt_slug ?? undefined,
          type: raw.trakt_type ?? undefined,
          seasonNumber:
            typeof raw.trakt_season === 'number' ? raw.trakt_season : undefined,
          seasonId:
            typeof raw.trakt_season_id === 'number'
              ? raw.trakt_season_id
              : undefined,
          mayInvalid:
            typeof raw.trakt_may_invalid === 'boolean'
              ? raw.trakt_may_invalid
              : undefined,
        };
      }

      yield entry;
    }
  },
};
