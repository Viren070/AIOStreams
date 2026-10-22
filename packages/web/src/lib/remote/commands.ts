import React from 'react';
import { ticksToMs } from '../format';
import type { MediaKey } from '../hosts/shell/bridge';
import { sameServer } from '../servers';
import { settings } from '../settings';
import { useLatest } from '../use-latest';

export type RemoteCommand =
  | { kind: 'show'; itemId: string; seasonId?: string }
  | {
      kind: 'play';
      itemId: string;
      startMs: number;
      sourceId?: string;
      audio?: number;
      subtitle?: number;
    }
  /** Adds to what plays next: right after what plays now, or at the end. */
  | { kind: 'queue'; itemIds: string[]; soon: boolean }
  | { kind: 'key'; key: MediaKey }
  | { kind: 'track'; type: 'audio' | 'subtitle'; index: number };

type Handler = (command: RemoteCommand) => boolean;

/** A Jellyfin id without dashes, or null for anything else, as ids go into routes and paths. */
export function plainId(id: unknown): string | null {
  const plain = String(id).replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(plain) ? plain : null;
}

function integer(value: unknown): number | undefined {
  const n = typeof value === 'string' && value ? Number(value) : value;
  return Number.isInteger(n) ? (n as number) : undefined;
}

function keyOf(command: unknown, seekTicks: unknown): MediaKey | null {
  const step = () => settings.controls.seekStep.read() * 1000;
  switch (command) {
    case 'Pause':
      return { action: 'pause' };
    case 'Unpause':
      return { action: 'play' };
    case 'PlayPause':
      return { action: 'toggle' };
    case 'Stop':
      return { action: 'stop' };
    case 'NextTrack':
      return { action: 'next' };
    case 'PreviousTrack':
      return { action: 'previous' };
    case 'Seek': {
      const ticks = integer(seekTicks);
      return ticks == null
        ? null
        : { action: 'seek', position: ticksToMs(ticks) };
    }
    case 'Rewind':
      return { action: 'skip', offset: -step() };
    case 'FastForward':
      return { action: 'skip', offset: step() };
    default:
      return null;
  }
}

export function commandOf(type: unknown, data: unknown): RemoteCommand | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<
    string,
    unknown
  >;
  if (type === 'Playstate') {
    const key = keyOf(d.Command, d.SeekPositionTicks);
    return key && { kind: 'key', key };
  }
  if (type === 'Play') {
    const ids = Array.isArray(d.ItemIds) ? d.ItemIds : [];
    const play = d.PlayCommand ?? 'PlayNow';
    if (play === 'PlayNext' || play === 'PlayLast') {
      const itemIds = ids.map(plainId).filter((id): id is string => !!id);
      return itemIds.length
        ? { kind: 'queue', itemIds, soon: play === 'PlayNext' }
        : null;
    }
    if (play !== 'PlayNow') return null;
    const itemId = plainId(ids[integer(d.StartIndex) ?? 0] ?? ids[0]);
    if (!itemId) return null;
    const sourceId = plainId(d.MediaSourceId) ?? undefined;
    return {
      kind: 'play',
      itemId,
      startMs: ticksToMs(integer(d.StartPositionTicks)),
      // The item's own id names its first version, which ids here never do.
      sourceId: sourceId === itemId ? undefined : sourceId,
      audio: integer(d.AudioStreamIndex),
      subtitle: integer(d.SubtitleStreamIndex),
    };
  }
  if (type !== 'GeneralCommand') return null;
  const args = (d.Arguments ?? {}) as Record<string, unknown>;
  switch (d.Name) {
    case 'DisplayContent': {
      const itemId = plainId(args.ItemId);
      return itemId ? { kind: 'show', itemId } : null;
    }
    case 'SetAudioStreamIndex':
    case 'SetSubtitleStreamIndex': {
      const index = integer(args.Index);
      if (index == null) return null;
      const type = d.Name === 'SetAudioStreamIndex' ? 'audio' : 'subtitle';
      return { kind: 'track', type, index };
    }
    default:
      return null;
  }
}

const handlers: Handler[] = [];
/** A show or play that came before anything could take it, such as the link that started the app. */
let waiting: { command: RemoteCommand; server?: string } | null = null;
/** Tracks a play asked for, picked once its file has loaded. */
let heldTracks: { itemId: string; audio?: number; subtitle?: number } | null =
  null;

export function sendRemote(command: RemoteCommand): void {
  for (let i = handlers.length - 1; i >= 0; i--)
    if (handlers[i](command)) return;
  holdRemote(command);
}

/** Keeps a show or play until pages open on `server`, or on any when none is named. */
export function holdRemote(command: RemoteCommand, server?: string): void {
  if (command.kind === 'show' || command.kind === 'play')
    waiting = { command, server };
}

/**
 * Takes the commands `handle` returns true for, newest first. With `base`, it
 * also takes a waiting one meant for that server, and drops one meant for
 * another.
 */
export function useRemoteHandler(handle: Handler, base?: string): void {
  const latest = useLatest(handle);
  React.useEffect(() => {
    const handler: Handler = (command) => latest.current(command);
    handlers.push(handler);
    if (waiting && base !== undefined) {
      const { command, server } = waiting;
      waiting = null;
      if (!server || sameServer(server, base)) handler(command);
    }
    return () => void handlers.splice(handlers.indexOf(handler), 1);
  }, [latest, base]);
}

export function holdTracks(command: RemoteCommand): void {
  heldTracks =
    command.kind === 'play' &&
    (command.audio != null || command.subtitle != null)
      ? command
      : null;
}

export function takeTracks(
  itemId: string
): { audio?: number; subtitle?: number } | null {
  const held = heldTracks;
  if (held?.itemId !== plainId(itemId)) return null;
  heldTracks = null;
  return held;
}
