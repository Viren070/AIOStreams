/* eslint-disable lingui/no-unlocalized-strings -- values the statistics keep, never shown */
import { i18n } from '@lingui/core';
import { currentHost } from '@/lib/hosts';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { settings } from '@/lib/settings';
import { storage } from '@/lib/storage';

const SENT_KEY = 'aiostreams-web-usage-stats-sent';

type Target = { appKey: string; host: string; appVersion: string };

const COMMIT = __APP_COMMIT__.split(' ')[0];

function appName(): string | null {
  const shell = appBridge();
  if (shell) {
    if (shell.platform !== 'android') return 'desktop';
    return shell.tv ? 'android-tv' : 'android';
  }
  const host = currentHost().name;
  return host === 'webos' || host === 'tizen' ? host : null;
}

function target(): Target | null {
  const build = __USAGE_STATS__;
  if (!build || !appName()) return null;
  const appVersion = appBridge()?.version ?? __APP_VERSION__ ?? __APP_COMMIT__;
  return { ...build, appVersion };
}

export const usageStatsOffered = (): boolean => target() !== null;

/** The user's answer, from the notice or Settings; either way they've seen what it sends. */
export function chooseUsageStats(on: boolean): void {
  settings.app.usageStatsNoticed.write(true);
  settings.app.usageStats.write(on);
}

interface System {
  name: string;
  version: string;
  model: string;
}

async function clientHints(): Promise<{
  platformVersion?: string;
  model?: string;
}> {
  const data = (
    navigator as {
      userAgentData?: {
        getHighEntropyValues(hints: string[]): Promise<{
          platformVersion?: string;
          model?: string;
        }>;
      };
    }
  ).userAgentData;
  try {
    return (
      (await data?.getHighEntropyValues(['platformVersion', 'model'])) ?? {}
    );
  } catch {
    return {};
  }
}

const SYSTEM_NAMES: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
};

async function system(platform: string): Promise<System> {
  const host = currentHost().system?.();
  if (host) return host;
  const ua = navigator.userAgent;
  const hints = await clientHints();
  const name = SYSTEM_NAMES[platform] ?? platform;
  if (platform === 'android')
    return {
      name,
      version: /Android (\d+(?:\.\d+)?)/.exec(ua)?.[1] ?? '',
      model: hints.model || (/; ([^;]+?) Build\//.exec(ua)?.[1] ?? ''),
    };
  if (platform === 'windows') {
    // The user agent says 10 on 11 too.
    const major = parseInt(hints.platformVersion ?? '', 10);
    return {
      name,
      version: major >= 13 ? '11' : major > 0 ? '10' : '',
      model: '',
    };
  }
  return { name, version: '', model: '' };
}

function engine(): { name: string; version: string } {
  const ua = navigator.userAgent;
  // Tizen's user agent gives Chromium's version without its name.
  const chromium = /Chrome\/(\d+)/.exec(ua) ?? /\) (\d+)(?:\.\d+)+\//.exec(ua);
  if (chromium) return { name: 'Chromium', version: chromium[1] };
  return {
    name: 'WebKit',
    version: /Version\/(\d+(?:\.\d+)?)/.exec(ua)?.[1] ?? '',
  };
}

function today(): { day: string; month: string } {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return { day: `${month}-${String(now.getDate()).padStart(2, '0')}`, month };
}

type Sent = Partial<ReturnType<typeof today>>;

/**
 * A new session each send and no id, so nothing ties the counts to a device.
 * Posted directly, as the web SDK can't send the system and model.
 */
async function send(): Promise<void> {
  const to = target();
  const app = appName();
  if (
    !to ||
    !app ||
    !settings.app.usageStatsNoticed.read() ||
    !settings.app.usageStats.read()
  )
    return;
  const now = today();
  const sent = storage.get<Sent>(SENT_KEY) ?? {};
  const due = (
    [
      ['daily_active', 'day'],
      ['monthly_active', 'month'],
    ] as const
  ).filter(([, period]) => sent[period] !== now[period]);
  if (!due.length) return;
  const os = await system(appBridge()?.platform ?? currentHost().name);
  const browser = engine();
  const sessionId = `${Math.floor(Date.now() / 1000)}${String(
    Math.floor(Math.random() * 1e8)
  ).padStart(8, '0')}`;
  for (const [eventName, period] of due) {
    const res = await fetch(`${to.host}/api/v0/event`, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'App-Key': to.appKey,
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        sessionId,
        eventName,
        systemProps: {
          osName: os.name,
          osVersion: os.version,
          deviceModel: os.model,
          engineName: browser.name,
          engineVersion: browser.version,
          locale: i18n.locale,
          appVersion: to.appVersion,
          appBuildNumber: COMMIT,
          isDebug: import.meta.env.DEV,
          sdkVersion: 'aiostreams-web',
        },
        props: { app },
      }),
    });
    if (!res.ok) return;
    sent[period] = now[period];
    storage.set(SENT_KEY, sent);
  }
}

let sending: Promise<void> | null = null;

/** A failed send is tried again on the next call. */
export function sendUsageStats(): Promise<void> {
  sending ??= send()
    .catch(() => undefined)
    .finally(() => (sending = null));
  return sending;
}
