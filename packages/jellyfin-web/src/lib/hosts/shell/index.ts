import React from 'react';
import { toast } from 'sonner';
import {
  settings,
  onSettingsChange,
  type UpdateChannelSetting,
} from '../../settings';
import { useLatest } from '../../use-latest';
import type { Host } from '..';
import type { ShellMessage } from './bridge';
import { applyDesktopSettings, useShellPlayer } from './player';

export type UpdateState = Extract<ShellMessage, { type: 'update-state' }>;

/* The last report, for a settings page opened after it came. */
let updateState: UpdateState | null = null;
const updateListeners = new Set<() => void>();

function subscribeUpdates(listener: () => void): () => void {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

export function useUpdateState(): UpdateState | null {
  return React.useSyncExternalStore(subscribeUpdates, () => updateState);
}

export function checkForUpdates(channel: UpdateChannelSetting): void {
  window.aiostreamsDesktop?.send({
    type: 'update-check',
    channel: channel === 'installed' ? null : channel,
  });
}

export function applyUpdate(): void {
  window.aiostreamsDesktop?.send({ type: 'update-apply' });
}

function onUpdateState(next: UpdateState) {
  const announced = updateState?.state === 'ready';
  updateState = next;
  for (const listener of updateListeners) listener();
  if (next.state === 'ready' && !announced)
    toast('Update ready', {
      description: `Version ${next.version} installs on the next start.`,
      action: { label: 'Restart now', onClick: applyUpdate },
      duration: Infinity,
    });
}

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
  window.aiostreamsDesktop?.send({ type: 'discord-check' });
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

/** Keeps mpv in step with this device's settings, checks for updates, and handles right clicks. */
export function ShellSetup() {
  React.useEffect(() => {
    const shell = window.aiostreamsDesktop;
    if (!shell) return;
    const { updateChannel } = settings.desktop;
    let channel = updateChannel.read();
    const apply = () => {
      applyDesktopSettings();
      if (updateChannel.read() !== channel) {
        channel = updateChannel.read();
        checkForUpdates(channel);
      }
    };
    apply();
    checkForUpdates(channel);
    const unsubscribeSettings = onSettingsChange(apply);
    const unsubscribe = shell.subscribe((m) => {
      if (m.type === 'fullscreen') windowFullscreen = m.value;
      else if (m.type === 'update-state') onUpdateState(m);
      else if (m.type === 'discord-status') onDiscordStatus(m);
      else if (m.type === 'external-players') onExternalPlayers(m.players);
    });
    window.addEventListener('contextmenu', onContextMenu);
    shell.send({ type: 'mpv-sync' });
    return () => {
      unsubscribeSettings();
      unsubscribe();
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);
  return null;
}

export type ExternalPlayers = Extract<
  ShellMessage,
  { type: 'external-players' }
>['players'];

let externalPlayers: ExternalPlayers | null = null;
const externalPlayerListeners = new Set<() => void>();

function subscribeExternalPlayers(listener: () => void): () => void {
  externalPlayerListeners.add(listener);
  return () => externalPlayerListeners.delete(listener);
}

/** The players the desktop app can start, and where it found each. */
export function useExternalPlayers(): ExternalPlayers | null {
  React.useEffect(() => {
    window.aiostreamsDesktop?.send({ type: 'external-players' });
  }, []);
  return React.useSyncExternalStore(
    subscribeExternalPlayers,
    () => externalPlayers
  );
}

export function chooseExternalPlayer(id: string): void {
  window.aiostreamsDesktop?.send({ type: 'external-choose', player: id });
}

function onExternalPlayers(next: ExternalPlayers) {
  externalPlayers = next;
  for (const listener of externalPlayerListeners) listener();
}

export type ShellInfo = Extract<ShellMessage, { type: 'app-info' }>;

export function useShellInfo(): ShellInfo | null {
  const [info, setInfo] = React.useState<ShellInfo | null>(null);
  React.useEffect(() => {
    const shell = window.aiostreamsDesktop;
    if (!shell) return;
    const unsubscribe = shell.subscribe((m) => {
      if (m.type === 'app-info') setInfo(m);
    });
    shell.send({ type: 'app-info' });
    return unsubscribe;
  }, []);
  return info;
}

/** The `aiostreams://` links the app is opened with, including the one that started it. */
export function useShellLinks(onLink: (url: string) => void): void {
  const latest = useLatest(onLink);
  React.useEffect(() => {
    const shell = window.aiostreamsDesktop;
    if (!shell) return;
    const unsubscribe = shell.subscribe((m) => {
      if (m.type === 'link') latest.current(m.url);
    });
    shell.send({ type: 'links-ready' });
    return unsubscribe;
  }, [latest]);
}

export function openMpvConfig(): void {
  window.aiostreamsDesktop?.send({ type: 'open-mpv-config' });
}

export function openLogs(): void {
  window.aiostreamsDesktop?.send({ type: 'open-logs' });
}

/** Versions, paths and the recent log, for a bug report. */
export function requestDiagnostics(server: string | null): Promise<string> {
  const shell = window.aiostreamsDesktop;
  if (!shell)
    return Promise.reject(new Error('Only the desktop app has these'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('The app did not answer'));
    }, 5000);
    const unsubscribe = shell.subscribe((m) => {
      if (m.type !== 'diagnostics') return;
      clearTimeout(timer);
      unsubscribe();
      resolve(m.text);
    });
    shell.send({ type: 'diagnostics', web: __APP_COMMIT__, server });
  });
}

const host: Host = {
  name: 'desktop',
  device: () => ({ name: window.aiostreamsDesktop?.device }),
  usePlayer: useShellPlayer,
  playerFeatures: ['audio', 'chapters', 'stats'],
  back: () => {
    if (!windowFullscreen) return false;
    window.aiostreamsDesktop?.send({ type: 'fullscreen', value: false });
    return true;
  },
};

/** The AIOStreams desktop app, which plays in mpv. */
export function shellHost(): Host | null {
  return window.aiostreamsDesktop?.protocol === 1 ? host : null;
}
