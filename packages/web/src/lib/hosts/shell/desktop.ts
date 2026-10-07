import React from 'react';
import type { Host } from '..';
import { appBridge, type ShellMessage } from './bridge';
import { shellDownloads } from './downloads';
import { useShellPlayer } from './player';

export type DiscordStatus = Extract<ShellMessage, { type: 'discord-status' }>;

let discordStatus: DiscordStatus | null = null;
const discordListeners = new Set<() => void>();

function subscribeDiscord(listener: () => void): () => void {
  discordListeners.add(listener);
  return () => discordListeners.delete(listener);
}

export function useDiscordStatus(): DiscordStatus | null {
  return React.useSyncExternalStore(subscribeDiscord, () => discordStatus);
}

export function checkDiscord(): void {
  appBridge()?.send({ type: 'discord-check' });
}

function onDiscordStatus(next: DiscordStatus) {
  discordStatus = next;
  for (const listener of discordListeners) listener();
}

/** The browser's own menu only where it edits or copies; Shift still opens it. */
function onContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  const editable = target?.closest('input, textarea, [contenteditable="true"]');
  if (e.shiftKey || editable || !!window.getSelection()?.toString()) return;
  e.preventDefault();
}

let windowFullscreen = false;

/** Follows the window's full screen and Discord, and keeps the browser's menu off the page. */
export function setupDesktop(): () => void {
  const unsubscribe = appBridge()?.subscribe((m) => {
    if (m.type === 'fullscreen') windowFullscreen = m.value;
    else if (m.type === 'discord-status') onDiscordStatus(m);
  });
  window.addEventListener('contextmenu', onContextMenu);
  return () => {
    unsubscribe?.();
    window.removeEventListener('contextmenu', onContextMenu);
  };
}

export function openMpvConfig(): void {
  appBridge()?.send({ type: 'open-mpv-config' });
}

export const desktopHost: Host = {
  name: 'desktop',
  device: () => ({ name: appBridge()?.device }),
  usePlayer: useShellPlayer,
  playerFeatures: ['audio', 'chapters', 'stats'],
  downloads: shellDownloads,
  back: () => {
    if (!windowFullscreen) return false;
    appBridge()?.send({ type: 'fullscreen', value: false });
    return true;
  },
};
