import { z } from 'zod';
import {
  addonProxyConfigMap,
  urlOrUrlList,
  userAgentMap,
  userAgentString,
} from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

const stringRecord = z.record(z.string(), z.string());

export const httpSchema = {
  defaultUserAgent: {
    schema: userAgentString,
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
    default: {} as Record<string, string>,
    label: 'Hostname user-agent overrides',
    description:
      'Per-hostname User-Agent overrides. Env shape: `host1:ua1,host2:ua2,...`. Takes priority over the default user agents.',
    env: 'HOSTNAME_USER_AGENT_OVERRIDES',
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
      'Per-hostname proxy enablement / index. Env shape: `host1:bool|index,host2:bool|index,...`. Index references `addonProxy` when configured as a list.',
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
