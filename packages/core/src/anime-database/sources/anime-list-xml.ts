/**
 * Anime-Lists `anime-list-master.xml`: anidb to tvdb/tmdb season mappings with
 * episode offsets, used to disambiguate which cour of a multi-season show a
 * given (season, episode) request belongs to.
 *
 * The dataset is XML, parsed via xml2js, and small enough (a few MB) to read
 * whole.
 */
import path from 'path';
import fs from 'fs/promises';
import { parseXmlCompat } from '../../index.js';
import { config as appConfig } from '../../config/index.js';
import {
  AnimeType,
  type AnimeListMapping,
  type SourceEntry,
} from '../types.js';
import { ANIME_DATABASE_PATH } from '../storage/paths.js';
import type { AnimeSource } from './base.js';

interface RawAttrs {
  anidbid?: string;
  tvdbid?: string;
  defaulttvdbseason?: string;
  episodeoffset?: string;
  tmdbtv?: string;
  tmdbseason?: string;
  tmdboffset?: string;
  tmdbid?: string;
  imdbid?: string;
}

interface RawMappingEntryAttrs {
  anidbseason?: string;
  tvdbseason?: string;
  tmdbseason?: string;
  start?: string;
  end?: string;
  offset?: string;
}

interface RawXmlAnime {
  $?: RawAttrs;
  before?: string[];
  ['mapping-list']?: Array<{
    mapping?: Array<{ $?: RawMappingEntryAttrs; _?: string }>;
  }>;
}

function parseNum(val: string | undefined): number | null {
  if (val === undefined || val === null || val === '') return null;
  if (['unknown', 'hentai', 'a'].includes(val.toLowerCase())) return null;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : null;
}

function parseSeason(val: string | undefined): number | 'a' | null {
  if (val === undefined || val === null || val === '') return null;
  if (val === 'a' || val === 'A') return 'a';
  return parseNum(val);
}

export const animeListXmlSource: AnimeSource = {
  id: 'anime-list-xml',
  name: 'Anime Lists XML',
  url: 'https://raw.githubusercontent.com/Anime-Lists/anime-lists/refs/heads/master/anime-list-master.xml',
  filePath: path.join(ANIME_DATABASE_PATH, 'anime-list-master.xml'),
  refreshIntervalMs() {
    return appConfig.metadata.animeDb.refresh.animeList * 1000;
  },
  async *parse(filePath: string): AsyncIterable<SourceEntry> {
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = parseXmlCompat(text);
    const list = parsed?.['anime-list']?.anime;
    if (!Array.isArray(list)) return;

    for (const raw of list as RawXmlAnime[]) {
      const attrs = raw.$;
      if (!attrs) continue;
      const anidbId = parseNum(attrs.anidbid);
      if (anidbId === null) continue;

      const tvdbId = parseNum(attrs.tvdbid);
      const defaultTvdbSeason = parseSeason(attrs.defaulttvdbseason);
      const episodeOffset = parseNum(attrs.episodeoffset);
      const tmdbTv = parseNum(attrs.tmdbtv);
      const tmdbSeason = parseNum(attrs.tmdbseason);
      const tmdbOffset = parseNum(attrs.tmdboffset);
      const tmdbId = parseNum(attrs.tmdbid);
      const imdbId =
        attrs.imdbid && attrs.imdbid !== '' ? attrs.imdbid : undefined;

      const mappings: AnimeListMapping[] = [];
      const mappingList = raw['mapping-list']?.[0]?.mapping;
      if (Array.isArray(mappingList)) {
        for (const m of mappingList) {
          const mAttrs = m.$;
          if (!mAttrs) continue;
          const anidbSeason = parseNum(mAttrs.anidbseason);
          if (anidbSeason === null) continue;
          const mapping: AnimeListMapping = {
            anidbSeason,
            tvdbSeason: parseNum(mAttrs.tvdbseason) ?? undefined,
            tmdbSeason: parseNum(mAttrs.tmdbseason) ?? undefined,
            start: parseNum(mAttrs.start) ?? undefined,
            end: parseNum(mAttrs.end) ?? undefined,
            offset: parseNum(mAttrs.offset) ?? undefined,
          };
          if (typeof m._ === 'string') mapping.episodes = m._;
          mappings.push(mapping);
        }
      }

      const entry: SourceEntry = {
        type: AnimeType.UNKNOWN,
        ids: { anidbId },
      };
      if (tvdbId !== null) entry.ids.thetvdbId = tvdbId;
      if (imdbId) entry.ids.imdbId = imdbId;
      // tmdbid wins over tmdbtv when present.
      const tmdb = tmdbId ?? tmdbTv;
      if (tmdb !== null && tmdb !== undefined) entry.ids.themoviedbId = tmdb;

      if (
        defaultTvdbSeason !== null ||
        episodeOffset !== null ||
        mappings.length > 0
      ) {
        entry.tvdb = {
          seasonNumber: defaultTvdbSeason,
          fromEpisode: episodeOffset !== null ? episodeOffset + 1 : null,
          episodeMappings: mappings.length > 0 ? mappings : undefined,
        };
      }
      if (tmdbSeason !== null || tmdbOffset !== null) {
        entry.tmdb = {
          seasonNumber: tmdbSeason,
          fromEpisode: tmdbOffset !== null ? tmdbOffset + 1 : null,
        };
      }

      yield entry;
    }
  },
};
