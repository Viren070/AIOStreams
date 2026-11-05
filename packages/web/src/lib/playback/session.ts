import React from 'react';
import { currentHost } from '../hosts';
import { appBridge } from '../hosts/shell/bridge';
import { goBack, goBackInApp, navigate, to } from '../paths';
import { settings } from '../settings';
import { chosenPlayer } from './player-choice';

/** The title the player plays, which plays on in the mini player while pages open over it. */
export interface Playback {
  itemId: string;
  sourceId: string;
  startMs: number;
  playlist?: string;
}

/** `docked` when it plays in a page's preview, which Back from the player returns to. */
let current: (Playback & { mini: boolean; docked?: boolean }) | null = null;
/** A channel zapped to in the player keeps the preview Back returns to. */
let zapping = false;
/** What leaving the player's page does, when the player itself chose. */
let leaving: 'keep' | 'stop' | null = null;
const listeners = new Set<() => void>();

function set(next: typeof current) {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const usePlayback = () =>
  React.useSyncExternalStore(subscribe, () => current);

export const playbackNow = () => current;

const onPlayerPage = () => /^#\/play\/(?!trailer\/)/.test(window.location.hash);

/** Apps that can draw their video small over the page, and the page's own video. */
function framed(): boolean {
  const host = currentHost();
  return host.player ? !!appBridge()?.miniPlayer : !host.play;
}

export const canMinimise = (): boolean => !currentHost().tv && framed();

/** A page's preview, which TVs show too, needs the app's own player. */
export const canPreview = (): boolean =>
  framed() && chosenPlayer().kind === 'app';

/** The player's page opened: the same title grows back, any other starts afresh. */
export function openPlayback(next: Playback): void {
  if (
    current?.itemId === next.itemId &&
    current.sourceId === next.sourceId &&
    current.playlist === next.playlist
  ) {
    if (current.mini) set({ ...current, mini: false });
    return;
  }
  set({ ...next, mini: false, docked: zapping || undefined });
  zapping = false;
}

/**
 * The player's page closed: a title plays on in the mini player when the
 * player asked to, else after a page opened from it, or after Back where the
 * setting says so.
 */
export function leftPlayback(how: 'back' | 'forward' | 'replace'): void {
  const chosen = leaving;
  leaving = null;
  if (!current) return;
  const keep =
    chosen === 'keep' ||
    (chosen === null && !launched && how === 'back' && !!current.docked) ||
    (chosen === null &&
      canMinimise() &&
      !launched &&
      (how === 'forward' ||
        (how === 'back' && settings.player.back.read() === 'minimise')));
  set(keep ? { ...current, mini: true } : null);
}

/** A player launched outside the page, which has no video for the mini player. */
let launched = false;

export function setLaunched(on: boolean): void {
  launched = on;
}

export function minimisePlayback(fallback: string): void {
  leaving = 'keep';
  goBackInApp(fallback);
}

/** Leaves the player's page and stops, whatever Back does. */
export function stopPlayback(fallback: string): void {
  leaving = 'stop';
  goBack(fallback);
}

export function closePlayback(): void {
  set(null);
}

export function expandPlayback(): void {
  if (!current) return;
  const { itemId, sourceId, startMs, playlist } = current;
  navigate(to.play(itemId, sourceId, startMs, playlist));
}

/** A title the player moves on to lists its versions on its page; in the mini player, it stops. */
export function listVersionsFromPlayer(path: string): void {
  if (onPlayerPage()) navigate(path, { replace: true });
  else closePlayback();
}

/** Plays in the page's preview; the title already there opens full screen. */
export function playDocked(next: Playback): void {
  if (current?.docked && current.itemId === next.itemId)
    return expandPlayback();
  set({ ...next, mini: true, docked: true });
}

export function zapTo(next: Playback): void {
  zapping = !!current?.docked && onPlayerPage();
  playOn(next);
}

/** A title the player moves on to: its page shows it, or the mini player plays it on. */
export function playOn(next: Playback): void {
  if (onPlayerPage())
    navigate(to.play(next.itemId, next.sourceId, next.startMs, next.playlist), {
      replace: true,
    });
  else set({ ...next, mini: true, docked: current?.docked });
}
