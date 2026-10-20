import { useQueryClient } from '@tanstack/react-query';
import { TICKS_PER_MS } from '../format';
import { REMOTE_DEVICES } from '../queries';
import { useSession } from '../session';
import type { BaseItemDto } from '../types';
import type { TrackKind } from './tracks';

export type RemotePlaystate =
  | 'Pause'
  | 'Unpause'
  | 'Stop'
  | 'NextTrack'
  | 'PreviousTrack'
  | 'Rewind'
  | 'FastForward'
  | 'Seek';

/** A device reports what a command changed a moment after taking it. */
const SETTLE_MS = 1_000;

const ticks = (ms: number) => Math.round(ms) * TICKS_PER_MS;

/** Commands to another device's session, standard to Jellyfin servers. */
export function useRemoteControl() {
  const { client } = useSession();
  const queryClient = useQueryClient();
  const sent = () =>
    setTimeout(
      () =>
        void queryClient.invalidateQueries({
          predicate: (q) => q.queryKey.includes(REMOTE_DEVICES),
        }),
      SETTLE_MS
    );
  const post = (
    path: string,
    body?: unknown,
    query?: Parameters<typeof client.post>[2]
  ) => client.post(path, body, query).then(sent);
  return {
    play: (
      sessionId: string,
      item: BaseItemDto,
      opts: { startMs: number; version?: string }
    ) =>
      post(`/Sessions/${sessionId}/Playing`, undefined, {
        playCommand: 'PlayNow',
        itemIds: item.Id,
        startPositionTicks: ticks(opts.startMs),
        mediaSourceId: opts.version,
      }),
    playstate: (sessionId: string, command: RemotePlaystate, seekMs?: number) =>
      post(
        `/Sessions/${sessionId}/Playing/${command}`,
        undefined,
        seekMs == null ? undefined : { seekPositionTicks: ticks(seekMs) }
      ),
    track: (sessionId: string, kind: TrackKind, index: number) =>
      post(`/Sessions/${sessionId}/Command`, {
        Name:
          kind === 'audio' ? 'SetAudioStreamIndex' : 'SetSubtitleStreamIndex',
        Arguments: { Index: String(index) },
      }),
  };
}
