/**
 * Fribb's `anime-list-full.json`: broad ID-only mapping table covering AniDB,
 * AniList, MAL, Kitsu, IMDb, TMDB, TVDB, Trakt, and many others.
 */
import path from 'path';
import { config as appConfig } from '../../config/index.js';
import { AnimeType, type SourceEntry } from '../types.js';
import { ANIME_DATABASE_PATH } from '../storage/paths.js';
import { streamJsonArray } from '../storage/streaming.js';
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

      const entry: SourceEntry = {
        type,
        ids: {
          animePlanetId: raw['anime-planet_id'],
          animecountdownId: raw.animecountdown_id,
          anidbId: raw.anidb_id,
          anilistId: raw.anilist_id,
          anisearchId: raw.anisearch_id,
          imdbId: Array.isArray(raw.imdb_id) ? raw.imdb_id[0] : raw.imdb_id,
          kitsuId: raw.kitsu_id,
          livechartId: raw.livechart_id,
          malId: raw.mal_id,
          notifyMoeId: raw['notify.moe_id'],
          simklId: raw.simkl_id,
          themoviedbId:
            typeof tmdbId === 'number' && Number.isFinite(tmdbId)
              ? tmdbId
              : typeof tmdbId === 'object' && tmdbId !== null
                ? (tmdbId.tv ??
                  (Array.isArray(tmdbId.movie) ? tmdbId.movie[0] : undefined))
                : undefined,
          thetvdbId: tvdbIdRaw,
          traktId: raw.trakt_id,
        },
      };

      // Drop ids that ended up undefined to keep canonical records compact.
      for (const [k, v] of Object.entries(entry.ids)) {
        if (v === undefined || v === null || v === '') {
          delete entry.ids[k as keyof typeof entry.ids];
        }
      }

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
