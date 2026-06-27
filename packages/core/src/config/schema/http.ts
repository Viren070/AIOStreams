import { z } from 'zod';
import {
  addonProxyConfigMap,
  applyUserAgentMapTemplates,
  applyUserAgentTemplate,
  urlOrUrlList,
  userAgentMap,
  userAgentString,
} from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

const stringRecord = z.record(z.string(), z.string());

export const httpSchema = {
  defaultUserAgent: {
    schema: userAgentString,
    transform: applyUserAgentTemplate,
    default: 'AIOStreams/{version}',
    label: 'Default user agent',
    description:
      'Default User-Agent header for outbound HTTP requests. Supports `{version}` and `{random}` placeholders.',
    env: 'DEFAULT_USER_AGENT',
    requiresRestart: true,
    secret: false,
  },
  aiostreamsUserAgent: {
    schema: userAgentString,
    transform: applyUserAgentTemplate,
    default: 'AIOStreams/{version}',
    label: 'AIOStreams user agent',
    description:
      'User-Agent identifying AIOStreams to upstream services. Supports `{version}` and `{random}` placeholders.',
    env: 'AIOSTREAMS_USER_AGENT',
    requiresRestart: true,
    secret: false,
  },
  hostnameUserAgentOverrides: {
    schema: userAgentMap,
    transform: applyUserAgentMapTemplates,
    default: {} as Record<string, string>,
    label: 'Request header overrides',
    description:
      'Per-key request header overrides. A key is a hostname (`host`, `*.host`, ' +
      '`*`) or a `[context]` label for a request purpose - `[nzb_grabs]`, ' +
      '`[torrent_grabs]`, `[newznab]`, `[torznab]`. A value is a literal ' +
      'User-Agent (which may use the `{version}` / `{random}` placeholders, like ' +
      '`DEFAULT_USER_AGENT`) or a `{preset}` reference to a built-in header set ' +
      '(`{sabnzbd}`, `{nzbget}`, `{sonarr}`, `{radarr}`, `{prowlarr}`, ' +
      '`{nzbhydra2}`, `{chrome}`). Env shape: `key1:value1,key2:value2,...`. When several keys ' +
      'match a request the most specific one wins - exact host, then wildcard ' +
      'host (`*.host`), then `[context]`, then global `*` - and the chosen value ' +
      'overrides the default user agent. Example: ' +
      '`[nzb_grabs]:{sabnzbd},indexer.com:{prowlarr}`',
    env: ['REQUEST_HEADER_OVERRIDES', 'HOSTNAME_USER_AGENT_OVERRIDES'],
    requiresRestart: false,
    secret: false,
  },
  addonProxy: {
    schema: urlOrUrlList,
    default: [] as string[],
    label: 'Addon proxy URL(s)',
    description:
      'Outbound HTTP proxy URL(s) used when fetching addon endpoints.',
    env: 'ADDON_PROXY',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'list' },
  },
  addonProxyConfig: {
    schema: addonProxyConfigMap,
    default: {} as Record<string, boolean | number>,
    label: 'Addon proxy config',
    description:
      'Per-key proxy enablement / index. A key is a hostname (`host`, `*.host`, ' +
      '`*`) or a `[context]` label (`[nzb_grabs]`, `[torrent_grabs]`, ' +
      '`[newznab]`, `[torznab]`). Env shape: `key1:bool|index,...` - `true`/' +
      '`false` enable/disable, an index selects an `addonProxy` entry. When ' +
      'several keys match the most specific one wins - exact host, then wildcard ' +
      'host (`*.host`), then `[context]`, then global `*`. Example: ' +
      '`[newznab]:true`.',
    env: 'ADDON_PROXY_CONFIG',
    requiresRestart: false,
    secret: false,
  },
  requestUrlMappings: {
    schema: z.union([stringRecord, z.string()]).transform((value) => {
      if (typeof value === 'object') return value;
      const trimmed = value.trim();
      if (!trimmed) return {} as Record<string, string>;
      const parsed = JSON.parse(trimmed) as Record<string, string>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const ku = new URL(k.replace(/\/$/, ''));
        const vu = new URL(v.replace(/\/$/, ''));
        out[ku.origin] = vu.origin;
      }
      return out;
    }),
    default: {} as Record<string, string>,
    label: 'Request URL mappings',
    description:
      'Origin-level URL rewrites applied to outbound requests. JSON object of `{origin: replacement}` URLs.',
    env: 'REQUEST_URL_MAPPINGS',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
