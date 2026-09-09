import { randomBytes, randomInt } from 'crypto';
import { config as appConfig } from '../config/index.js';
import { Cache } from '../utils/cache.js';
import {
  decryptString,
  encryptString,
  getSimpleTextHash,
} from '../utils/crypto.js';

export interface TokenPayload {
  u: string;
  p: string;
  d?: string;
  /** Persona id; absent on tokens minted before personas existed. */
  k?: string;
  iat: number;
}

export function mintToken(payload: Omit<TokenPayload, 'iat'>): string {
  const res = encryptString(JSON.stringify({ ...payload, iat: Date.now() }));
  if (!res.success || !res.data) throw new Error('Failed to create token');
  return res.data;
}

export function readToken(token: string): TokenPayload | null {
  const res = decryptString(token);
  if (!res.success || !res.data) return null;
  try {
    const parsed = JSON.parse(res.data);
    if (
      parsed &&
      typeof parsed.u === 'string' &&
      typeof parsed.p === 'string'
    ) {
      return parsed as TokenPayload;
    }
  } catch {}
  return null;
}

/** One id for the whole instance, identical on every replica. */
export function serverId(): string {
  return getSimpleTextHash(
    `jellyfin-server:${appConfig.bootstrap.secretKey}`
  ).slice(0, 32);
}

function decodeValue(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/**
 * `Authorization: MediaBrowser Token="x", Client="y"` with quoted or unquoted
 * values in any order. Keys are lower-cased.
 */
export function parseMediaBrowserHeader(
  value: string | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value) return out;
  const body = value.replace(/^(MediaBrowser|Emby)\s+/i, '');
  const re = /([A-Za-z]+)\s*=\s*"([^"]*)"|([A-Za-z]+)\s*=\s*([^,\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const k = (m[1] ?? m[3]).toLowerCase();
    out[k] = decodeValue(m[2] ?? m[4] ?? '');
  }
  return out;
}

export interface ClientInfo {
  name: string;
  device: string;
  deviceId: string;
  version: string;
}

export interface AuthInput {
  header(name: string): string | undefined;
  query: Record<string, unknown>;
}

export function extractAuth(req: AuthInput): {
  token?: string;
  client: ClientInfo;
} {
  const mb = parseMediaBrowserHeader(
    req.header('authorization') ?? req.header('x-emby-authorization')
  );
  const q = (name: string) => {
    for (const [k, v] of Object.entries(req.query)) {
      if (k.toLowerCase() === name && typeof v === 'string' && v) return v;
    }
    return undefined;
  };
  const token =
    mb.token ||
    req.header('x-emby-token') ||
    req.header('x-mediabrowser-token') ||
    q('apikey') ||
    q('api_key');
  return {
    token: token || undefined,
    client: {
      name: mb.client || 'Unknown',
      device: mb.device || 'Unknown',
      deviceId: mb.deviceid || 'unknown',
      version: mb.version || '0',
    },
  };
}

export interface QuickConnectEntry {
  secret: string;
  code: string;
  deviceId: string;
  deviceName: string;
  appName: string;
  appVersion: string;
  dateAdded: string;
  uuid?: string;
  encryptedPassword?: string;
  persona?: string;
}

const QUICK_CONNECT_TTL = 10 * 60;
const quickConnect = Cache.getInstance<string, QuickConnectEntry>(
  'jellyfin-quickconnect',
  10_000
);

export async function quickConnectInitiate(
  client: ClientInfo
): Promise<QuickConnectEntry> {
  let code = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    if (!(await quickConnect.get(`code:${code}`).catch(() => undefined))) break;
  }
  const entry: QuickConnectEntry = {
    secret: randomBytes(24).toString('base64url'),
    code,
    deviceId: client.deviceId,
    deviceName: client.device,
    appName: client.name,
    appVersion: client.version,
    dateAdded: new Date().toISOString(),
  };
  await Promise.all([
    quickConnect.set(`secret:${entry.secret}`, entry, QUICK_CONNECT_TTL),
    quickConnect.set(`code:${code}`, entry, QUICK_CONNECT_TTL),
  ]);
  return entry;
}

export function quickConnectBySecret(
  secret: string
): Promise<QuickConnectEntry | undefined> {
  return quickConnect.get(`secret:${secret}`).catch(() => undefined);
}

export function quickConnectByCode(
  code: string
): Promise<QuickConnectEntry | undefined> {
  return quickConnect.get(`code:${code}`).catch(() => undefined);
}

export async function quickConnectAuthorize(
  code: string,
  credentials: { uuid: string; encryptedPassword: string; persona?: string }
): Promise<QuickConnectEntry | null> {
  const entry = await quickConnectByCode(code);
  if (!entry || entry.uuid) return null;
  const authorised: QuickConnectEntry = { ...entry, ...credentials };
  await Promise.all([
    quickConnect.set(`secret:${entry.secret}`, authorised, QUICK_CONNECT_TTL),
    quickConnect.set(`code:${code}`, authorised, QUICK_CONNECT_TTL),
  ]);
  return authorised;
}

/** Hands the entry over exactly once. */
export async function quickConnectConsume(
  secret: string
): Promise<QuickConnectEntry | null> {
  const entry = await quickConnectBySecret(secret);
  if (!entry?.uuid || !entry.encryptedPassword) return null;
  await Promise.all([
    quickConnect.delete(`secret:${secret}`),
    quickConnect.delete(`code:${entry.code}`),
  ]).catch(() => undefined);
  return entry;
}
