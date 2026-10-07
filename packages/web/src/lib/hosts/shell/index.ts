import React from 'react';
import { toast } from 'sonner';
import {
  settings,
  onSettingsChange,
  type UpdateChannelSetting,
} from '../../settings';
import { useLatest } from '../../use-latest';
import type { Host } from '..';
import { androidHost, setupAndroid } from './android';
import { appBridge, type ShellMessage } from './bridge';
import { desktopHost, setupDesktop } from './desktop';
import { applyDesktopSettings } from './player';

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
  appBridge()?.send({
    type: 'update-check',
    channel: channel === 'installed' ? null : channel,
  });
}

export function applyUpdate(): void {
  appBridge()?.send({ type: 'update-apply' });
}

function onUpdateState(next: UpdateState) {
  const announced = updateState?.state === 'ready';
  updateState = next;
  for (const listener of updateListeners) listener();
  if (next.state !== 'ready' || announced) return;
  const android = appBridge()?.platform === 'android';
  toast('Update ready', {
    description: android
      ? `Version ${next.version} is ready to install.`
      : `Version ${next.version} installs on the next start.`,
    action: {
      label: android ? 'Install' : 'Restart now',
      onClick: applyUpdate,
    },
    duration: Infinity,
  });
}

/** Keeps mpv in step with this device's settings and checks for updates. */
export function ShellSetup() {
  React.useEffect(() => {
    const shell = appBridge();
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
      if (m.type === 'update-state') onUpdateState(m);
      else if (m.type === 'external-players') onExternalPlayers(m.players);
    });
    const teardown =
      shell.platform === 'android' ? setupAndroid() : setupDesktop();
    shell.send({ type: 'mpv-sync' });
    return () => {
      unsubscribeSettings();
      unsubscribe();
      teardown();
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
    appBridge()?.send({ type: 'external-players' });
  }, []);
  return React.useSyncExternalStore(
    subscribeExternalPlayers,
    () => externalPlayers
  );
}

export function chooseExternalPlayer(id: string): void {
  appBridge()?.send({ type: 'external-choose', player: id });
}

function onExternalPlayers(next: ExternalPlayers) {
  externalPlayers = next;
  for (const listener of externalPlayerListeners) listener();
}

export type ShellInfo = Extract<ShellMessage, { type: 'app-info' }>;

export function useShellInfo(): ShellInfo | null {
  const [info, setInfo] = React.useState<ShellInfo | null>(null);
  React.useEffect(() => {
    const shell = appBridge();
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
    const shell = appBridge();
    if (!shell) return;
    const unsubscribe = shell.subscribe((m) => {
      if (m.type === 'link') latest.current(m.url);
    });
    shell.send({ type: 'links-ready' });
    return unsubscribe;
  }, [latest]);
}

export function openLogs(): void {
  appBridge()?.send({ type: 'open-logs' });
}

/** Versions, paths and the recent log, for a bug report. */
export function requestDiagnostics(server: string | null): Promise<string> {
  const shell = appBridge();
  if (!shell)
    return Promise.reject(
      new Error('Only the desktop and Android apps have these')
    );
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

/** The AIOStreams apps, which play in mpv. */
export function shellHost(): Host | null {
  const bridge = appBridge();
  if (bridge?.protocol !== 1) return null;
  return bridge.platform === 'android' ? androidHost : desktopHost;
}
