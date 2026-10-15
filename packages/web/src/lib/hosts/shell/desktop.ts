import React from 'react';
import type { Host } from '..';
import { onSettingsChange, settings } from '../../settings';
import { appBridge, ask, bridgeStore, type ShellAnswer } from './bridge';
import { shellDownloads } from './downloads';
import { useShellPlayer } from './player';
import { soundOptions } from './sound';
import { resolveYouTube } from './youtube';

export type DiscordStatus = ShellAnswer<'discord-status'>;

export const useDiscordStatus = bridgeStore('discord-status').use;

export function checkDiscord(): void {
  appBridge()?.send({ type: 'discord-check' });
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
  let options = '';
  const sendOptions = () => {
    const next = {
      dolbyVision: settings.desktop.dolbyVision.read(),
      ...soundOptions(),
    };
    if (JSON.stringify(next) === options) return;
    options = JSON.stringify(next);
    appBridge()?.send({ type: 'player-options', ...next });
  };
  sendOptions();
  const unsubscribeSettings = onSettingsChange(sendOptions);
  const unsubscribe = appBridge()?.subscribe((m) => {
    if (m.type === 'fullscreen') windowFullscreen = m.value;
  });
  window.addEventListener('contextmenu', onContextMenu);
  return () => {
    unsubscribeSettings();
    unsubscribe?.();
    window.removeEventListener('contextmenu', onContextMenu);
  };
}

export type AudioDevice = { name: string; description: string };

/** The outputs mpv can play to, asked for each time they are shown. */
export function useAudioDevices(): AudioDevice[] | null {
  const [devices, setDevices] = React.useState<AudioDevice[] | null>(null);
  React.useEffect(() => {
    let live = true;
    ask({ type: 'audio-devices' }, 'audio-devices')
      .then((m) => live && setDevices(m.devices ?? []))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return devices;
}

export function openMpvConfig(): void {
  appBridge()?.send({ type: 'open-mpv-config' });
}

export const desktopHost: Host = {
  name: 'desktop',
  device: () => ({ name: appBridge()?.device }),
  usePlayer: useShellPlayer,
  playerFeatures: ['audio', 'chapters', 'stats', 'headers'],
  resolveYouTube,
  downloads: {
    ...shellDownloads,
    folder: {
      choose: () => appBridge()?.send({ type: 'download-folder' }),
      open: (id) =>
        appBridge()?.send({ type: 'download-open', id: id ?? null }),
    },
  },
  back: () => {
    if (!windowFullscreen) return false;
    appBridge()?.send({ type: 'fullscreen', value: false });
    return true;
  },
};
