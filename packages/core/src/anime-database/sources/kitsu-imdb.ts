/**
 * TheBeastLT's Kitsu-to-IMDb mapping: adds IMDb ids and per-season-cour
 * fromSeason/fromEpisode hints (and TVDB ids and a fanart logo id) to the
 * Kitsu entries Fribb already covers.
 */
import path from 'path';
import fs from 'fs/promises';
import { config as appConfig } from '../../config/index.js';
import { type SourceEntry } from '../types.js';
import { ANIME_DATABASE_PATH } from '../storage/paths.js';
import type { AnimeSource } from './base.js';

interface KitsuRaw {
  fanartLogoId?: number | string;
  tvdbId?: number | string;
  tvdb_id?: number | string;
  imdbId?: string;
  imdb_id?: string;
  title?: string;
  fromSeason?: number;
  fromEpisode?: number;
  nonImdbEpisodes?: number[];
  kitsu_id?: number | string;
}

export const kitsuImdbSource: AnimeSource = {
  id: 'kitsu-imdb',
  name: 'Kitsu IMDB Mapping',
  url: 'https://raw.githubusercontent.com/TheBeastLT/stremio-kitsu-anime/master/static/data/imdb_mapping.json',
  filePath: path.join(ANIME_DATABASE_PATH, 'kitsu-imdb-mapping.json'),
  refreshIntervalMs() {
    return appConfig.metadata.animeDb.refresh.kitsuImdbMapping * 1000;
  },
  async *parse(filePath: string): AsyncIterable<SourceEntry> {
    const text = await fs.readFile(filePath, 'utf8');
    const data: unknown = JSON.parse(text);

    const entries: Array<[number, KitsuRaw]> = [];
    if (Array.isArray(data)) {
      for (const e of data as KitsuRaw[]) {
        if (e?.kitsu_id !== undefined) {
          entries.push([Number(e.kitsu_id), e]);
        }
      }
    } else if (data && typeof data === 'object') {
      for (const [id, e] of Object.entries(data as Record<string, KitsuRaw>)) {
        entries.push([Number(id), e]);
      }
    }

    for (const [kitsuId, raw] of entries) {
      if (!Number.isFinite(kitsuId)) continue;
      if (!raw || typeof raw !== 'object') continue;

      const tvdbRaw = raw.tvdbId ?? raw.tvdb_id;
      const tvdbId = typeof tvdbRaw === 'string' ? Number(tvdbRaw) : tvdbRaw;
      const imdbId = raw.imdbId ?? raw.imdb_id;
      const fanart =
        typeof raw.fanartLogoId === 'string'
          ? Number(raw.fanartLogoId)
          : raw.fanartLogoId;

      const entry: SourceEntry = {
        ids: { kitsuId },
      };

      if (typeof tvdbId === 'number' && Number.isFinite(tvdbId)) {
        entry.ids.thetvdbId = tvdbId;
      }
      if (typeof imdbId === 'string' && imdbId) {
        entry.ids.imdbId = imdbId;
      }

      if (
        typeof raw.fromSeason === 'number' ||
        typeof raw.fromEpisode === 'number' ||
        Array.isArray(raw.nonImdbEpisodes) ||
        typeof raw.title === 'string'
      ) {
        entry.imdb = {
          fromSeason:
            typeof raw.fromSeason === 'number' ? raw.fromSeason : undefined,
          fromEpisode:
            typeof raw.fromEpisode === 'number' ? raw.fromEpisode : undefined,
          nonImdbEpisodes: Array.isArray(raw.nonImdbEpisodes)
            ? raw.nonImdbEpisodes.filter(
                (e): e is number => typeof e === 'number'
              )
            : undefined,
          title: typeof raw.title === 'string' ? raw.title : undefined,
        };
      }

      if (typeof fanart === 'number' && Number.isFinite(fanart)) {
        entry.fanart = { logoId: fanart };
      }

      yield entry;
    }
  },
};
