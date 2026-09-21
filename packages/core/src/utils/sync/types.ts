import z from 'zod';

export interface SyncFetcherConfig {
  /** Unique cache key prefix for this fetcher */
  cacheKey: string;
  /** Max items in the cache */
  maxCacheSize: number;
  /** Zod schema to validate items fetched from URLs */
  itemSchema: z.ZodType<any>;
  /** Convert a plain string from a `values` array into a typed item */
  convertValue: (value: string) => any;
}

/**
 * A raw item as fetched from a sync URL.
 * All sync URLs must return either:
 *   - An array of objects matching the itemSchema
 *   - An object with a `values` array of strings
 */
export type RawSyncItem =
  | { name: string; pattern: string; score?: number }
  | {
      expression: string;
      name?: string;
      score?: number;
    };

/**
 * Result of fetching items from a single URL, including any error.
 */
export interface FetchResult<T> {
  url: string;
  items: T[];
  error?: string;
}

export interface SyncOverride {
  /** For regex overrides */
  pattern?: string;
  /** For SEL overrides */
  expression?: string;
  name?: string;
  score?: number;
  originalName?: string;
  /** Extracted names from SEL expression comments, used for matching */
  exprNames?: string[];
  disabled?: boolean;
}

export type SyncKind = 'regex' | 'sel';

/** `settings` is the runtime list, `community` the admin-trusted uploads. */
export type AllowlistSource = 'settings' | 'templates' | 'community';

export type DenyReason = 'disabled' | 'not-vouched' | 'unsafe-address';

/** A user-scoped URL is permitted by who asked, not by the instance. */
export interface UrlPartition {
  /**
   * Every URL the caller may fetch, in the order given. Sort order of the
   * resulting items follows it, so it must not be rebuilt from the two lists
   * below.
   */
  allowed: string[];
  vouched: string[];
  userScoped: string[];
  denied: Array<{ url: string; reason: DenyReason }>;
}

export function allowedUrls(partition: UrlPartition): string[] {
  return partition.allowed;
}

/** No address check: an operator may legitimately vouch for a LAN host. */
export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Parse a `<SYNCED: url>` placeholder, returning the URL or null. */
export function parseSyncedUrl(value: string): string | null {
  if (!value.startsWith('<SYNCED: ') || !value.endsWith('>')) return null;
  const url = value.slice(9, -1).trim();
  return url.length > 0 ? url : null;
}

export function denyMessage(kind: SyncKind, reason: DenyReason): string {
  switch (reason) {
    case 'disabled':
      return kind === 'regex'
        ? 'Regex sync is disabled on this instance.'
        : 'Stream expression sync is disabled on this instance.';
    case 'unsafe-address':
      return 'That URL points somewhere this server will not connect to. It must be a public http(s) address.';
    case 'not-vouched':
      return 'This URL is not in the allowed list. Contact the instance owner to whitelist it, or ask to be marked as a trusted user.';
  }
}
