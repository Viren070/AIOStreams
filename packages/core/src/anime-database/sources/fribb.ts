/**
 * Fribb's `anime-list-full.json`: broad ID-only mapping table covering AniDB,
 * AniList, MAL, Kitsu, IMDb, TMDB, TVDB, Trakt, and many others.
 */
import path from 'path';
import { config as appConfig } from '../../config/index.js';
import { AnimeType, type SourceEntry } from '../types.js';
import { ANIME_DATABASE_PATH } from '../storage/paths.js';
import { detachString, streamJsonArray } from '../storage/streaming.js';
import type { AnimeSource } from './base.js';

interface FribbTmdbMapping {
  tv?: number;
  movie?: number[];
}

interface FribbRaw {
  ['anime-planet_id']?: string | number;
  animecountdown_id?: number;
  anidb_id?: number;
  anilist_id?: number;
  anisearch_id?: number;
  imdb_id?: string | string[];
  kitsu_id?: number;
  livechart_id?: number;
  mal_id?: number;
  ['notify.moe_id']?: string;
  simkl_id?: number;
  themoviedb_id?: number | string | FribbTmdbMapping;
  thetvdb_id?: number;
  tvdb_id?: number;
  trakt_id?: number;
  type?: string;
  season?: { tvdb?: number; tmdb?: number };
}

function toAnimeType(v: unknown): AnimeType {
  if (typeof v === 'string') {
    const upper = v.toUpperCase() as AnimeType;
    if ((Object.values(AnimeType) as string[]).includes(upper)) return upper;
  }
  return AnimeType.UNKNOWN;
}

export const fribbSource: AnimeSource = {
  id: 'fribb',
  name: 'Fribb Mappings',
  url: 'https://raw.githubusercontent.com/Fribb/anime-lists/refs/heads/master/anime-list-full.json',
  filePath: path.join(ANIME_DATABASE_PATH, 'fribb-mappings.json'),
  refreshIntervalMs() {
    return appConfig.metadata.animeDb.refresh.fribbMappings * 1000;
  },
  async *parse(filePath: string): AsyncIterable<SourceEntry> {
    for await (const raw of streamJsonArray<FribbRaw>(filePath)) {
      if (!raw || typeof raw !== 'object') continue;
      const type = toAnimeType(raw.type);
      // Drop entries with bogus season metadata.
      const seasonRaw = raw.season;
      if (seasonRaw !== undefined && typeof seasonRaw !== 'object') continue;
      if (
        seasonRaw &&
        ((seasonRaw.tmdb !== undefined && typeof seasonRaw.tmdb !== 'number') ||
          (seasonRaw.tvdb !== undefined && typeof seasonRaw.tvdb !== 'number'))
      ) {
        continue;
      }

      const tmdbIdRaw = raw.themoviedb_id;
      const tmdbId =
        typeof tmdbIdRaw === 'string' ? parseInt(tmdbIdRaw, 10) : tmdbIdRaw;

      const tvdbIdRaw = raw.thetvdb_id ?? raw.tvdb_id;

      const themoviedbId =
        typeof tmdbId === 'number' && Number.isFinite(tmdbId)
          ? tmdbId
          : typeof tmdbId === 'object' && tmdbId !== null
            ? (tmdbId.tv ??
              (Array.isArray(tmdbId.movie) ? tmdbId.movie[0] : undefined))
            : undefined;

      const ids: SourceEntry['ids'] = {};
      const putId = (
        key: keyof SourceEntry['ids'],
        value: string | number | undefined | null
      ): void => {
        if (value === undefined || value === null || value === '') return;
        ids[key] = detachString(value);
      };
      putId('animePlanetId', raw['anime-planet_id']);
      putId('animecountdownId', raw.animecountdown_id);
      putId('anidbId', raw.anidb_id);
      putId('anilistId', raw.anilist_id);
      putId('anisearchId', raw.anisearch_id);
      putId(
        'imdbId',
        Array.isArray(raw.imdb_id) ? raw.imdb_id[0] : raw.imdb_id
      );
      putId('kitsuId', raw.kitsu_id);
      putId('livechartId', raw.livechart_id);
      putId('malId', raw.mal_id);
      putId('notifyMoeId', raw['notify.moe_id']);
      putId('simklId', raw.simkl_id);
      putId('themoviedbId', themoviedbId);
      putId('thetvdbId', tvdbIdRaw);
      putId('traktId', raw.trakt_id);

      const entry: SourceEntry = { type, ids };

      if (seasonRaw?.tvdb !== undefined) {
        entry.tvdb = { ...(entry.tvdb ?? {}), seasonNumber: seasonRaw.tvdb };
      }
      if (seasonRaw?.tmdb !== undefined) {
        entry.tmdb = { ...(entry.tmdb ?? {}), seasonNumber: seasonRaw.tmdb };
      }

      yield entry;
    }
  },
};
