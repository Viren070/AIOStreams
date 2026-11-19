import { config as appConfig } from '../../config/index.js';
import { resolveHeaderPreset } from './header-presets.js';

/**
 * The "context" a fetch runs within. Surfaced as a `[context]` key in
 * `hostnameUserAgentOverrides` / `addonProxyConfig`, so per-purpose requests can
 * be tuned.
 */
export type FetchContext =
  'nzb_grabs' | 'torrent_grabs' | 'newznab' | 'torznab';

/**
 * Pick the most specific value from a host / `[context]`-keyed override map for a
 * request. Used by the request-header overrides (`hostnameUserAgentOverrides`)
 * and the addon-proxy config (`addonProxyConfig`), both of which key entries by
 * either a hostname pattern or a `[context]` label.
 *
 * When several keys match, the most specific wins, in this order:
 *   1. exact hostname (`example.com`)
 *   2. wildcard hostname suffix (`*.example.com`)
 *   3. `[context]` label (e.g. `[nzb_grabs]`)
 *   4. global `*`
 *
 * Returns the matched value, or `undefined` when nothing matches.
 */
export function matchOverride<T>(
  map: Record<string, T>,
  hostname: string,
  context?: string
): T | undefined {
  const contextKey = context ? `[${context}]` : undefined;
  let exact: T | undefined;
  let wildcard: T | undefined;
  let ctx: T | undefined;
  let global: T | undefined;
  for (const [key, value] of Object.entries(map)) {
    if (key === hostname) {
      exact = value;
    } else if (key === '*') {
      global = value;
    } else if (key.length > 1 && key.startsWith('*')) {
      if (hostname.endsWith(key.slice(1))) wildcard = value;
    } else if (contextKey && key === contextKey) {
      ctx = value;
    }
  }
  if (exact !== undefined) return exact;
  if (wildcard !== undefined) return wildcard;
  if (ctx !== undefined) return ctx;
  return global;
}

/**
 * Resolve the override headers to apply to a request for `url` in an optional
 * `context`. Reads `hostnameUserAgentOverrides`: the matched value is either a
 * literal user-agent (→ `{ 'User-Agent': value }`) or a `{preset}` reference
 * expanded to its full header set (see `header-presets.ts`). Returns an empty
 * object when nothing matches.
 */
export function resolveOverrideHeaders(
  url: URL,
  context?: string
): Record<string, string> {
  const map = appConfig.http.hostnameUserAgentOverrides;
  if (!map || Object.keys(map).length === 0) return {};
  const value = matchOverride(map, url.hostname, context);
  if (value === undefined || value === '') return {};
  return resolveHeaderPreset(value) ?? { 'User-Agent': value };
}
