import type { ParsedMeta } from '../db/schemas.js';
import { Cache } from '../utils/cache.js';
import { getSimpleTextHash } from '../utils/crypto.js';
import type { ContentRef } from '../watch-state/types.js';
import { groupSeasons } from './dto.js';
import { firstWriteOf } from './write-once.js';

/** The episodes a show's played state counts; specials never do. */
export interface ShowEpisodes {
  type: string;
  id: string;
  episodes: [videoId: string, season: number, episode: number, airs: number][];
}

/* Kept so a list can mark a show without fetching every meta on the page. */
const shows = Cache.getInstance<string, ShowEpisodes>(
  'jellyfin-show-episodes',
  10_000
);
const SHOW_EPISODES_TTL = 24 * 60 * 60;

export function showEpisodesOf(meta: ParsedMeta): ShowEpisodes {
  const episodes: ShowEpisodes['episodes'] = [];
  for (const group of groupSeasons(meta)) {
    if (group.season === 0) continue;
    for (const v of group.videos) {
      const airs = v.released ? Date.parse(v.released) : NaN;
      episodes.push([
        v.id,
        group.season,
        v.episode ?? 0,
        Number.isFinite(airs) ? airs : 0,
      ]);
    }
  }
  return { type: meta.type, id: meta.id, episodes };
}

function showKey(scope: string, type: string, id: string): string {
  return `${scope}|${type}|${id}`;
}

/** Keyed by the id the show was opened under, which is the id its list card carries. */
export function rememberShowEpisodes(
  scope: string,
  type: string,
  id: string,
  meta: ParsedMeta
): void {
  const value = showEpisodesOf(meta);
  if (!value.episodes.length) return;
  const key = showKey(scope, type, id);
  if (!firstWriteOf(`show:${key}:${getSimpleTextHash(JSON.stringify(value))}`))
    return;
  void shows.set(key, value, SHOW_EPISODES_TTL).catch(() => undefined);
}

export async function rememberedShowEpisodes(
  scope: string,
  type: string,
  id: string
): Promise<ShowEpisodes | undefined> {
  return shows.get(showKey(scope, type, id)).catch(() => undefined);
}

export function airedEpisodeRefs(
  show: ShowEpisodes,
  now: number
): ContentRef[] {
  return show.episodes
    .filter(([, , , airs]) => !(airs > now))
    .map(([videoId, season, episode]) => ({
      kind: 'episode',
      type: show.type,
      baseId: show.id,
      season,
      episode,
      videoId,
    }));
}
