/**
 * Manami offline anime database: large catalogue of titles and per-anime
 * metadata (season, year, synonyms, studios, ...) keyed by source URL.
 */
import path from 'path';
import { config as appConfig } from '../../config/index.js';
import {
  AnimeSeason,
  AnimeStatus,
  AnimeType,
  type IdValue,
  type SourceEntry,
} from '../types.js';
import { ANIME_DATABASE_PATH } from '../storage/paths.js';
import { streamJsonLines } from '../storage/streaming.js';
import type { IdType } from '../../utils/id-parser.js';
import type { AnimeSource } from './base.js';

interface ManamiRaw {
  sources: string[];
  title: string;
  type: string;
  episodes: number;
  status: string;
  animeSeason?: { season?: string; year?: number | null };
  picture?: string | null;
  thumbnail?: string | null;
  duration?: { value: number; unit: string } | null;
  score?: unknown;
  synonyms?: string[];
  studios?: string[];
  producers?: string[];
  relatedAnime?: string[];
  tags?: string[];
}

const URL_EXTRACTORS: Partial<Record<IdType, (url: string) => IdValue | null>> =
  {
    anidbId: (url) => {
      const m = url.match(/anidb\.net\/anime\/(\d+)/);
      return m ? Number(m[1]) : null;
    },
    anilistId: (url) => {
      const m = url.match(/anilist\.co\/anime\/(\d+)/);
      return m ? Number(m[1]) : null;
    },
    animePlanetId: (url) => {
      const m = url.match(/anime-planet\.com\/anime\/([\w-]+)/);
      return m ? m[1] : null;
    },
    animecountdownId: (url) => {
      const m = url.match(/animecountdown\.com\/(\d+)/);
      return m ? Number(m[1]) : null;
    },
    anisearchId: (url) => {
      const m = url.match(/anisearch\.com\/anime\/(\d+)/);
      return m ? Number(m[1]) : null;
    },
    kitsuId: (url) => {
      const m = url.match(/kitsu\.app\/anime\/(\d+)/);
      return m ? Number(m[1]) : null;
    },
    livechartId: (url) => {
      const m = url.match(/livechart\.me\/anime\/(\d+)/);
      return m ? Number(m[1]) : null;
    },
    malId: (url) => {
      const m = url.match(/myanimelist\.net\/anime\/(\d+)/);
      return m ? Number(m[1]) : null;
    },
    notifyMoeId: (url) => {
      const m = url.match(/notify\.moe\/anime\/([\w-]+)/);
      return m ? m[1] : null;
    },
    simklId: (url) => {
      const m = url.match(/simkl\.com\/anime\/(\d+)/);
      return m ? Number(m[1]) : null;
    },
  };

function toAnimeType(v: unknown): AnimeType {
  if (
    typeof v === 'string' &&
    (Object.values(AnimeType) as string[]).includes(v.toUpperCase())
  ) {
    return v.toUpperCase() as AnimeType;
  }
  return AnimeType.UNKNOWN;
}

function toAnimeSeason(v: unknown): AnimeSeason {
  if (
    typeof v === 'string' &&
    (Object.values(AnimeSeason) as string[]).includes(v.toUpperCase())
  ) {
    return v.toUpperCase() as AnimeSeason;
  }
  return AnimeSeason.UNDEFINED;
}

export const manamiSource: AnimeSource = {
  id: 'manami',
  name: 'Manami DB',
  url: 'https://github.com/manami-project/anime-offline-database/releases/download/latest/anime-offline-database.jsonl',
  filePath: path.join(ANIME_DATABASE_PATH, 'manami-db.jsonl'),
  refreshIntervalMs() {
    return appConfig.metadata.animeDb.refresh.manamiDb * 1000;
  },
  async *parse(filePath: string): AsyncIterable<SourceEntry> {
    for await (const raw of streamJsonLines<ManamiRaw>(filePath)) {
      const entry = parseRaw(raw);
      if (entry) yield entry;
    }
  },
};

function parseRaw(raw: ManamiRaw): SourceEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.sources)) return null;
  if (typeof raw.title !== 'string') return null;
  const type = toAnimeType(raw.type);
  if (
    raw.status &&
    !(Object.values(AnimeStatus) as string[]).includes(
      String(raw.status).toUpperCase()
    )
  ) {
    return null;
  }

  const ids: SourceEntry['ids'] = {};
  for (const url of raw.sources) {
    if (typeof url !== 'string') continue;
    for (const [idType, extractor] of Object.entries(URL_EXTRACTORS)) {
      if (ids[idType as IdType] !== undefined) continue;
      const value = extractor!(url);
      if (value !== null) ids[idType as IdType] = value;
    }
  }
  if (Object.keys(ids).length === 0) return null;

  const animeSeason = raw.animeSeason
    ? {
        season: toAnimeSeason(raw.animeSeason.season),
        year:
          typeof raw.animeSeason.year === 'number'
            ? raw.animeSeason.year
            : null,
      }
    : undefined;

  const synonyms = Array.isArray(raw.synonyms)
    ? raw.synonyms.filter((s): s is string => typeof s === 'string')
    : undefined;

  const entry: SourceEntry = {
    type,
    ids,
    title: raw.title,
    synonyms,
    animeSeason,
  };

  return entry;
}
