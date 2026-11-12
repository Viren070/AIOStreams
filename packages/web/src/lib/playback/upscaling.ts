import React from 'react';
import { useItem } from '@/lib/jellyfin/queries';
import { settings } from '@/lib/settings';
import type { BaseItemDto } from '@/lib/jellyfin/types';

// eslint-disable-next-line lingui/no-unlocalized-strings -- Jellyfin's names
const ANIME_IDS = ['AniList', 'Kitsu', 'MyAnimeList', 'AniDB'];

const isAnime = (item: BaseItemDto | undefined) =>
  ANIME_IDS.some((key) => !!item?.ProviderIds?.[key]) ||
  [...(item?.Genres ?? []), ...(item?.Tags ?? [])].some(
    (name) => name.toLowerCase() === 'anime'
  );

let anime = false;
/** The shortcut's choice for what plays, over the setting. */
let picked: boolean | null = null;
const listeners = new Set<() => void>();

function changed() {
  listeners.forEach((l) => l());
}

export function onUpscalingChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const upscalingOn = () =>
  picked ?? (anime && settings.video.upscaling.read());

export function pickUpscaling(on: boolean): void {
  picked = on;
  changed();
}

/**
 * Before the file loads, so the app's player starts with the right picture. An episode also goes by
 * its season, which carries anime ids from the server's anime database when its show has none.
 */
export function usePlayingAnime(item: BaseItemDto): void {
  const season = useItem(item.SeasonId ?? '');
  const show = useItem(item.SeriesId ?? '');
  const value = isAnime(item) || isAnime(season.data) || isAnime(show.data);
  React.useLayoutEffect(() => {
    picked = null;
    changed();
  }, [item.Id]);
  React.useLayoutEffect(() => {
    anime = value;
    changed();
    return () => {
      anime = false;
      picked = null;
      changed();
    };
  }, [value]);
}
