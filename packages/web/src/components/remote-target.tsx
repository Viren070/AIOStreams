import React from 'react';
import { t } from '@lingui/core/macro';
import { toast } from 'sonner';
import type { MediaKey } from '../lib/hosts/shell/bridge';
import { itemPath, navigate, to } from '../lib/paths';
import type { PlayerController } from '../lib/playback/controller';
import { useFetchItem } from '../lib/queries';
import {
  holdTracks,
  takeTracks,
  useRemoteHandler,
  type RemoteCommand,
} from '../lib/remote/commands';
import { trackForIndex, type TrackKind } from '../lib/remote/tracks';
import { useSession } from '../lib/session';
import type { BaseItemDto, SourceInfo } from '../lib/types';
import { useLatest } from '../lib/use-latest';
import { useVersionPicker } from './version-picker';

/** Opens a title, or plays one as Play would here. */
export function useOpenRemote(opts: { replace?: boolean } = {}) {
  const picker = useVersionPicker();
  const fetchItem = useFetchItem();
  return (command: Extract<RemoteCommand, { kind: 'show' | 'play' }>) => {
    if (command.kind === 'play') holdTracks(command);
    fetchItem(command.itemId).then(
      (item) => {
        if (command.kind === 'show')
          navigate(
            command.seasonId && item.Type === 'Series'
              ? `${to.item(item.Id!)}?season=${command.seasonId}`
              : itemPath(item)
          );
        else
          picker.play(item, {
            startMs: command.startMs,
            version: command.sourceId,
            replace: opts.replace,
          });
      },
      () => toast.error(t`That title could not be opened`)
    );
  };
}

/** Takes what other devices and links open while no player is up. */
export function RemoteTarget() {
  const { client } = useSession();
  const open = useOpenRemote();
  useRemoteHandler((command) => {
    if (command.kind !== 'show' && command.kind !== 'play') return false;
    open(command);
    return true;
  }, client.base);
  return null;
}

/**
 * Takes everything sent while this player is up. A new title takes its
 * place; showing one never interrupts it. `queue` adds to what plays next,
 * where it can.
 */
export function useRemotePlayer(
  player: PlayerController,
  item: BaseItemDto,
  source: SourceInfo,
  act: (key: MediaKey) => void,
  queue?: (itemIds: string[], soon: boolean) => void
) {
  const open = useOpenRemote({ replace: true });
  const setTrack = useLatest((kind: TrackKind, index: number) => {
    const tracks =
      kind === 'audio' ? player.audioTracks : player.subtitleTracks;
    const id = trackForIndex(source.MediaStreams ?? [], tracks, kind, index);
    if (kind === 'subtitle' && id !== undefined) player.setSubtitle(id);
    else if (kind === 'audio' && id) player.setAudio(id);
  });
  useRemoteHandler((command) => {
    if (command.kind === 'key') act(command.key);
    else if (command.kind === 'track')
      setTrack.current(command.type, command.index);
    else if (command.kind === 'play') open(command);
    else if (command.kind === 'queue') queue?.(command.itemIds, command.soon);
    return true;
  });
  const { loaded } = player.state;
  React.useEffect(() => {
    if (!loaded) return;
    const held = takeTracks(item.Id!);
    if (held?.audio != null) setTrack.current('audio', held.audio);
    if (held?.subtitle != null) setTrack.current('subtitle', held.subtitle);
  }, [loaded, item.Id, setTrack]);
}
