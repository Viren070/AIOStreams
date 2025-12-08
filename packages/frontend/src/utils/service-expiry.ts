import type { ServiceId } from '@aiostreams/core';

const CACHE_KEY = 'aiostreams-service-expiry-cache';
const OVERRIDES_KEY = 'aiostreams-service-expiry-overrides';
export const EXPIRY_OVERRIDE_EVENT = 'aiostreams:expiry-override-changed';
export const CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours

export type ServiceExpirySource = 'api' | 'cache' | 'manual';

export type ExpiryMode = 'auto' | 'manual' | 'hidden';

export interface ExpiryPreference {
  mode: ExpiryMode;
  date?: string;
  updatedAt?: number;
}

export interface CachedExpiryEntry {
  expiresAt: string;
  timestamp: number;
}

type LegacyManualExpiryEntry = {
  date: string;
  updatedAt?: number;
};

type StoredPreferenceEntry = ExpiryPreference | LegacyManualExpiryEntry;

type PreferenceStore = Partial<Record<ServiceId, StoredPreferenceEntry>>;

export type CachedExpiryMap = Partial<Record<ServiceId, CachedExpiryEntry>>;

export const TRACKED_SERVICE_IDS: ServiceId[] = [
  'realdebrid',
  'alldebrid',
  'premiumize',
  'debridlink',
  'torbox',
  'easynews',
  'nzbdav',
  'stremio_nntp',
  'altmount',
];

export function isTrackedService(serviceId: ServiceId): boolean {
  return TRACKED_SERVICE_IDS.includes(serviceId);
}

export const AUTO_FETCH_SERVICE_IDS: ServiceId[] = [
  'realdebrid',
  'alldebrid',
  'premiumize',
  'debridlink',
  'torbox',
];

export function canServiceAutoFetch(serviceId: ServiceId): boolean {
  return AUTO_FETCH_SERVICE_IDS.includes(serviceId);
}

function safeParseJSON<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function readCache(): CachedExpiryMap {
  if (typeof window === 'undefined') return {};
  const stored = safeParseJSON<CachedExpiryMap>(
    window.localStorage.getItem(CACHE_KEY)
  );
  return stored ?? {};
}

function writeCache(map: CachedExpiryMap): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(map));
}

export function getCachedExpiry(
  serviceId: ServiceId
): (CachedExpiryEntry & { daysRemaining: number | null }) | null {
  const cache = readCache();
  const entry = cache[serviceId];
  if (!entry) return null;
  const isFresh = Date.now() - entry.timestamp < CACHE_DURATION_MS;
  if (!isFresh) {
    delete cache[serviceId];
    writeCache(cache);
    return null;
  }
  const daysRemaining = calculateDaysRemaining(entry.expiresAt);
  return {
    ...entry,
    daysRemaining,
  };
}

export function setCachedExpiry(serviceId: ServiceId, expiresAt: string): void {
  if (typeof window === 'undefined') return;
  const cache = readCache();
  cache[serviceId] = {
    expiresAt,
    timestamp: Date.now(),
  };
  writeCache(cache);
}

export function clearCachedExpiry(serviceId: ServiceId): void {
  if (typeof window === 'undefined') return;
  const cache = readCache();
  if (cache[serviceId]) {
    delete cache[serviceId];
    writeCache(cache);
  }
}

function readOverrides(): PreferenceStore {
  if (typeof window === 'undefined') return {};
  const stored = safeParseJSON<PreferenceStore>(
    window.localStorage.getItem(OVERRIDES_KEY)
  );
  return stored ?? {};
}

function writeOverrides(map: PreferenceStore): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map));
}

function normalisePreference(
  entry: StoredPreferenceEntry | undefined
): ExpiryPreference | null {
  if (!entry || typeof entry !== 'object') return null;
  const maybePreference = entry as ExpiryPreference;
  if (maybePreference.mode === 'auto') {
    return { mode: 'auto' };
  }
  if (maybePreference.mode === 'manual' || maybePreference.mode === 'hidden') {
    return {
      mode: maybePreference.mode,
      date:
        typeof maybePreference.date === 'string'
          ? maybePreference.date
          : undefined,
      updatedAt:
        typeof maybePreference.updatedAt === 'number'
          ? maybePreference.updatedAt
          : undefined,
    };
  }

  const legacy = entry as LegacyManualExpiryEntry;
  if (typeof legacy.date === 'string') {
    return {
      mode: 'manual',
      date: legacy.date,
      updatedAt:
        typeof legacy.updatedAt === 'number' ? legacy.updatedAt : undefined,
    };
  }
  return null;
}

export function getExpiryPreference(serviceId: ServiceId): ExpiryPreference {
  const overrides = readOverrides();
  const normalised = normalisePreference(overrides[serviceId]);
  return normalised ?? { mode: 'auto' };
}

export function setExpiryPreference(
  serviceId: ServiceId,
  preference: ExpiryPreference | null
): void {
  if (typeof window === 'undefined') return;
  const overrides = readOverrides();
  const existing = normalisePreference(overrides[serviceId]);

  if (!preference || preference.mode === 'auto') {
    if (overrides[serviceId]) {
      delete overrides[serviceId];
      writeOverrides(overrides);
    } else {
      writeOverrides(overrides);
    }
  } else {
    const next: ExpiryPreference = {
      mode: preference.mode,
      date:
        preference.mode === 'manual'
          ? (preference.date ?? existing?.date)
          : undefined,
      updatedAt:
        preference.mode === 'manual'
          ? preference.date
            ? Date.now()
            : existing?.updatedAt
          : undefined,
    };
    overrides[serviceId] = next;
    writeOverrides(overrides);
  }
  clearCachedExpiry(serviceId);
  window.dispatchEvent(
    new CustomEvent(EXPIRY_OVERRIDE_EVENT, { detail: { serviceId } })
  );
}

function normaliseExpiryDate(dateString: string): Date | null {
  if (!dateString) return null;
  let candidate = dateString.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    candidate = `${candidate}T23:59:59`;
  }
  let parsed = new Date(candidate);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  parsed = new Date(candidate.replace(' ', 'T'));
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  return null;
}

export function calculateDaysRemaining(dateString: string): number | null {
  const expiryDate = normaliseExpiryDate(dateString);
  if (!expiryDate) return null;
  const diff = expiryDate.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function getBadgeColors(daysRemaining: number): {
  background: string;
  foreground: string;
} {
  if (daysRemaining <= 0) {
    return { background: '#ef4444', foreground: '#ffffff' };
  }
  if (daysRemaining <= 7) {
    return { background: '#f97316', foreground: '#ffffff' };
  }
  if (daysRemaining <= 15) {
    return { background: '#eab308', foreground: '#000000' };
  }
  return { background: '#22c55e', foreground: '#ffffff' };
}

export function formatExpiryTitle(params: {
  serviceName: string;
  expiresAt?: string;
  source: ServiceExpirySource;
  updatedAt?: number | null;
}): string {
  const { serviceName, expiresAt, source, updatedAt } = params;
  const parts: string[] = [];
  if (expiresAt) {
    const parsed = normaliseExpiryDate(expiresAt);
    const formatted = parsed ? parsed.toLocaleString() : expiresAt;
    parts.push(`Expires on ${formatted}`);
  }
  switch (source) {
    case 'manual':
      parts.push('Manual override');
      break;
    case 'cache':
      parts.push('Cached result');
      break;
    case 'api':
      parts.push('Fetched from provider API');
      break;
  }
  if (updatedAt) {
    parts.push(`Last updated ${new Date(updatedAt).toLocaleString()}`);
  }
  return `${serviceName}: ${parts.join(' • ')}`;
}
