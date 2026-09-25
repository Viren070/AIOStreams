import { playbackHost } from './hosts';
import { playOnAndroid } from './hosts/jellyfin-android';
import { ticksToMs } from './format';
import { navigate, to } from './paths';
import type { BaseItemDto, PlaybackInfoResponse, SourceInfo } from './types';

/** Versions that can play; notices from addons carry text only. */
export function playableSources(
  info: PlaybackInfoResponse | undefined
): SourceInfo[] {
  return (info?.MediaSources ?? []).filter(
    (s) => s.Type !== 'Placeholder'
  ) as SourceInfo[];
}

export function noticeSources(
  info: PlaybackInfoResponse | undefined
): SourceInfo[] {
  return (info?.MediaSources ?? []).filter(
    (s) => s.Type === 'Placeholder' && 'aiostreams' in s
  ) as SourceInfo[];
}

/** Plays an item on whatever player this page runs in. */
export function usePlay() {
  return async (
    item: BaseItemDto,
    opts: { source: SourceInfo; startMs?: number; replace?: boolean }
  ) => {
    const { source } = opts;
    if (!source.Id) throw new Error('No playable version was found');
    const startMs =
      opts.startMs ?? ticksToMs(item.UserData?.PlaybackPositionTicks);

    if (playbackHost() === 'android') {
      playOnAndroid(item, source, startMs);
      return;
    }
    navigate(to.play(item.Id!, source.Id, startMs), { replace: opts.replace });
  };
}
