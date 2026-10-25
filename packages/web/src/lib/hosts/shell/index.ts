import { t } from '@lingui/core/macro';
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
  appBridge()?.platform === 'android' ? t`Install` : t`Restart now`;

export function updateStatus(update: UpdateState | null): string {
  const android = appBridge()?.platform === 'android';
  switch (update?.state) {
    case undefined:
      return t`Not checked yet.`;
    case 'off':
      return t`This copy does not update itself.`;
    case 'checking':
      return t`Checking…`;
    case 'downloading': {
      const version = update.version ?? '';
      return t`Downloading version ${version}…`;
    }
    case 'ready': {
      const version = update.version ?? '';
      return android
        ? t`Version ${version} is ready to install.`
        : t`Version ${version} installs on the next start.`;
    }
    case 'current':
      return t`Up to date.`;
    case 'error': {
      const error = update.error ?? '';
      return t`Could not check: ${error}`;
    }
  }
}

/** Keeps the app's player in step with this device's settings and checks for updates. */
export function ShellSetup() {
  React.useEffect(() => {
    const shell = appBridge();
    if (!shell) return;
    const { updateChannel } = settings.app;
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
  const name = id;
  appBridge()?.send({
    type: 'external-choose',
    player: id,
    title: t`Choose ${name}`,
  });
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

export interface CrashReport {
  at: number;
  /** What fits on a screen, for a photo. */
  summary: string;
  details: string;
  /** Only the page restarted; the app stayed open. */
  page?: boolean;
}

/** How the Android app's last run ended, if it crashed or was closed while in use and nobody has seen it yet. */
export function requestCrashReport(): Promise<CrashReport | null> {
  if (appBridge()?.platform !== 'android') return Promise.resolve(null);
  return ask({ type: 'crash-report' }, 'crash-report', {
    timeoutMs: 15000,
  }).then(({ at, summary, details, page }) =>
    at && summary ? { at, summary, details: details ?? summary, page } : null
  );
}

export function crashReportSeen(at: number): void {
  appBridge()?.send({ type: 'crash-seen', at });
}

/** The AIOStreams apps. */
export function shellHost(): Host | null {
  const bridge = appBridge();
  if (bridge?.protocol !== 2) return null;
  return bridge.platform === 'android' ? androidHost : desktopHost;
}
