import { playbackHost } from './hosts';
import { TICKS_PER_MS, ticksToMs } from './format';
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
    opts: { source: SourceInfo; startMs?: number }
  ) => {
    const host = playbackHost();
    const { source } = opts;
    if (!source.Id) throw new Error('No playable version was found');
    const startMs =
      opts.startMs ?? ticksToMs(item.UserData?.PlaybackPositionTicks);

    if (host === 'android') {
      window.NativePlayer!.loadPlayer(
        JSON.stringify({
          ids: [item.Id],
          mediaSourceId: source.Id,
          startIndex: 0,
          startPositionTicks: startMs * TICKS_PER_MS,
        }),
        JSON.stringify({
          maxStreamingBitrateLocal: 120_000_000,
          maxStreamingBitrateRemote: 120_000_000,
        })
      );
      return;
    }
    navigate(to.play(item.Id!, source.Id, startMs));
  };
}
