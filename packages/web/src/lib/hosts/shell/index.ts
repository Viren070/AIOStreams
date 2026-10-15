import React from 'react';
import {
  settings,
  onSettingsChange,
  type UpdateChannelSetting,
} from '../../settings';
import { useLatest } from '../../use-latest';
import type { Host } from '..';
import { androidHost, setupAndroid } from './android';
import { appBridge, ask, bridgeStore, type ShellAnswer } from './bridge';
import { desktopHost, setupDesktop } from './desktop';
import { playerSettings } from './player';

export type UpdateState = ShellAnswer<'update-state'>;

export const useUpdateState = bridgeStore('update-state').use;

export function checkForUpdates(channel: UpdateChannelSetting): void {
  appBridge()?.send({
    type: 'update-check',
    channel: channel === 'installed' ? null : channel,
  });
}

export function applyUpdate(): void {
  appBridge()?.send({ type: 'update-apply' });
}

export const applyLabel = () =>
  appBridge()?.platform === 'android' ? 'Install' : 'Restart now';

export function updateStatus(update: UpdateState | null): string {
  const android = appBridge()?.platform === 'android';
  switch (update?.state) {
    case undefined:
      return 'Not checked yet.';
    case 'off':
      return 'This copy does not update itself.';
    case 'checking':
      return 'Checking\u2026';
    case 'downloading':
      return `Downloading version ${update.version}\u2026`;
    case 'ready':
      return android
        ? `Version ${update.version} is ready to install.`
        : `Version ${update.version} installs on the next start.`;
    case 'current':
      return 'Up to date.';
    case 'error':
      return `Could not check: ${update.error}`;
  }
}

/** Keeps the app's player in step with this device's settings and checks for updates. */
export function ShellSetup() {
  React.useEffect(() => {
    const shell = appBridge();
    if (!shell) return;
    const { updateChannel } = settings.desktop;
    let channel = updateChannel.read();
    let sent = '';
    const apply = () => {
      const next = JSON.stringify(playerSettings());
      if (next !== sent) {
        sent = next;
        shell.send({ type: 'player-settings', ...JSON.parse(next) });
      }
      if (updateChannel.read() !== channel) {
        channel = updateChannel.read();
        checkForUpdates(channel);
      }
    };
    apply();
    checkForUpdates(channel);
    const unsubscribeSettings = onSettingsChange(apply);
    const teardown =
      shell.platform === 'android' ? setupAndroid() : setupDesktop();
    shell.send({ type: 'player-sync' });
    return () => {
      unsubscribeSettings();
      teardown();
    };
  }, []);
  return null;
}

export type ExternalPlayers = ShellAnswer<'external-players'>['players'];

const externalPlayers = bridgeStore('external-players');

/** The players the desktop app can start, and where it found each. */
export function useExternalPlayers(): ExternalPlayers | null {
  React.useEffect(() => {
    appBridge()?.send({ type: 'external-players' });
  }, []);
  return externalPlayers.use()?.players ?? null;
}

export function chooseExternalPlayer(id: string): void {
  appBridge()?.send({ type: 'external-choose', player: id });
}

export type ShellInfo = ShellAnswer<'app-info'>;

export function useShellInfo(): ShellInfo | null {
  const [info, setInfo] = React.useState<ShellInfo | null>(null);
  React.useEffect(() => {
    let live = true;
    ask({ type: 'app-info' }, 'app-info')
      .then((m) => live && setInfo(m))
      .catch(() => undefined);
    return () => {
      live = false;
    };
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
  return ask(
    { type: 'diagnostics', web: __APP_COMMIT__, server },
    'diagnostics',
    { timeoutMs: 5000 }
  ).then((m) => m.text);
}

/** The AIOStreams apps. */
export function shellHost(): Host | null {
  const bridge = appBridge();
  if (bridge?.protocol !== 2) return null;
  return bridge.platform === 'android' ? androidHost : desktopHost;
}
