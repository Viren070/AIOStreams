import { t } from '@lingui/core/macro';
import { storage } from './storage';
import { currentHost } from './hosts';
import { reached, unreachable } from './connection';
import { appBridge } from './hosts/shell/bridge';

// The apps are their own clients, on the device they run on.
const shell = appBridge();
const CLIENT_NAME = clientName();
const CLIENT_VERSION = shell?.version ?? '1.0.0';
const DEVICE_KEY = 'aiostreams-web-device';

type QueryValue = string | number | boolean | string[] | null | undefined;
export type Query = Record<string, QueryValue>;

/** Everything before `/web`, so the app works under any mount of the API. */
export function apiBase(): string {
  const { origin, pathname } = window.location;
  const mount = pathname.replace(/\/web(\/(index\.html)?)?$/i, '');
  return origin + (mount && mount !== pathname ? mount : '/jellyfin');
}

/* eslint-disable lingui/no-unlocalized-strings -- names the server lists devices by */
function clientName(): string {
  if (!shell) {
    const host = currentHost().name;
    if (host === 'webos') return 'AIOStreams webOS';
    if (host === 'tizen') return 'AIOStreams Tizen';
    return 'AIOStreams Web';
  }
  if (shell.platform !== 'android') return 'AIOStreams Desktop';
  return shell.tv ? 'AIOStreams Android TV' : 'AIOStreams Android';
}

function deviceId(): string {
  const app = currentHost().device?.()?.id;
  if (app) return app;
  const stored = storage.get<string>(DEVICE_KEY);
  if (stored) return stored;
  // randomUUID needs a secure context, which a LAN http address is not.
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
  storage.set(DEVICE_KEY, id);
  return id;
}

const SYSTEM_NAMES: Record<string, string> = {
  windows: 'Windows',
  android: 'Android',
  ios: 'iOS',
  macos: 'macOS',
  linux: 'Linux',
};

function deviceName(): string {
  const app = currentHost().device?.()?.name;
  if (app) return app;
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = SYSTEM_NAMES[browserSystem() ?? ''];
  return os ? `${browser} on ${os}` : browser;
}
/* eslint-enable lingui/no-unlocalized-strings */

function browserSystem(): string | undefined {
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return 'android';
  // iPadOS asks for pages as a Mac does.
  if (
    /iPhone|iPad/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  )
    return 'ios';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac OS X/.test(ua)) return 'macos';
  if (/Linux/.test(ua)) return 'linux';
  return undefined;
}

export class JellyfinError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** How long the server asks to wait before trying again, where it says. */
    readonly retryAfterMs?: number
  ) {
    super(message);
  }
}

/** No answer from the server itself: offline, or a proxy in front of it says it is down. */
export class ConnectionError extends Error {
  constructor() {
    super(t`Can't reach the server`);
  }
}

const requestFailed = (status: number) => t`Request failed (${status})`;

export type Purpose = 'download';

/** Servers whose CORS takes the hint headers; an older one refuses every request carrying them. */
const hinted = new Set<string>();

export function allowHints(base: string, allowed: boolean): void {
  if (allowed) hinted.add(base);
  else hinted.delete(base);
}

/** The headers variant conditions read, with the values the docs list. */
function hints(device: string, purpose?: Purpose): Record<string, string> {
  const host = currentHost();
  const headers: Record<string, string> = {
    'X-AIOStreams-Client': CLIENT_NAME,
    // A header carries only Latin-1, which fetch enforces by throwing.
    'X-AIOStreams-Device': device.replace(/[^\x20-\x7e]/gu, encodeURIComponent),
  };
  const system =
    shell?.platform ??
    (host.name === 'webos' || host.name === 'tizen'
      ? host.name
      : browserSystem());
  if (system) headers['X-AIOStreams-Platform'] = system;
  const network = (navigator as { connection?: { type?: string } }).connection
    ?.type;
  if (network && network !== 'unknown')
    headers['X-AIOStreams-Network'] = network;
  if (purpose) headers['X-AIOStreams-Purpose'] = purpose;
  return headers;
}

const GATEWAY_DOWN = new Set([502, 504, 520, 521, 522, 523, 524, 530]);

/** A minimal client for the Jellyfin API this server speaks. */
export class JellyfinClient {
  readonly deviceId = deviceId();
  readonly deviceName = deviceName();

  constructor(
    readonly base: string,
    readonly token: string | null = null
  ) {}

  withToken(token: string): JellyfinClient {
    return new JellyfinClient(this.base, token);
  }

  get authorization(): string {
    const parts = [
      `Client="${CLIENT_NAME}"`,
      `Device="${encodeURIComponent(this.deviceName)}"`,
      `DeviceId="${this.deviceId}"`,
      `Version="${CLIENT_VERSION}"`,
    ];
    if (this.token) parts.push(`Token="${this.token}"`);
    return `MediaBrowser ${parts.join(', ')}`;
  }

  url(path: string, query?: Query): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    const qs = params.toString();
    return `${this.base}${path}${qs ? `?${qs}` : ''}`;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    init: {
      query?: Query;
      body?: unknown;
      keepalive?: boolean;
      purpose?: Purpose;
      signal?: AbortSignal;
    } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: this.authorization,
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (hinted.has(this.base))
      Object.assign(headers, hints(this.deviceName, init.purpose));
    let res: Response;
    try {
      res = await fetch(this.url(path, init.query), {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        keepalive: init.keepalive,
        signal: init.signal,
      });
    } catch (error) {
      // Dropped by the app, which says nothing about the server.
      if (init.signal?.aborted) throw error;
      unreachable();
      throw new ConnectionError();
    }
    if (GATEWAY_DOWN.has(res.status)) {
      unreachable();
      throw new ConnectionError();
    }
    reached();
    if (!res.ok) {
      const message = await res
        .json()
        .then((body: { Message?: string }) => body?.Message)
        .catch(() => undefined);
      const retryAfter = Number(res.headers.get('Retry-After') ?? NaN);
      throw new JellyfinError(
        res.status,
        message || requestFailed(res.status),
        Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined
      );
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
    return this.request<T>('GET', path, { query, signal });
  }

  post<T>(
    path: string,
    body?: unknown,
    query?: Query,
    purpose?: Purpose
  ): Promise<T> {
    return this.request<T>('POST', path, { body, query, purpose });
  }

  delete<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('DELETE', path, { query });
  }
}
