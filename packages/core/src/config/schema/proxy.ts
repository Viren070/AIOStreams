import { z } from 'zod';
import { forcedPort, positiveInt, urlString } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

const nullableString = z.string().nullable();
const nullableUrl = z.union([urlString, z.null()]);

/**
 * List of serviceIds that should be proxied. Accepts an array or a
 * JSON-encoded array (env shape). The legacy env shape was a JSON object;
 * we accept that too and use only its truthy keys.
 */
const proxiedServicesList = z.union([
  z.array(z.string()),
  z.null(),
  z.string().transform((value, ctx) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
        return parsed as string[];
      }
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return Object.entries(parsed as Record<string, unknown>)
          .filter(([, v]) => v === true)
          .map(([k]) => k);
      }
      throw new Error('bad shape');
    } catch {
      ctx.addIssue({
        code: 'custom',
        message:
          'Proxied services must be a JSON array of serviceIds (legacy: `{serviceId:bool}` object).',
      });
      return z.NEVER;
    }
  }),
]);

/**
 * Frontend proxy settings. Subsections (UI order):
 * - `encryption`: per-proxy URL encryption flags.
 * - `default`: default proxy used when the user hasn't picked one.
 * - `force`: proxy that overrides whatever the user picked.
 * - `public`: forced public host/port/protocol surfaced to clients.
 * - `ip`: resolved-proxy-IP cache TTL.
 */
export const proxySchema = {
  encryption: {
    mediaflow: {
      schema: z.boolean(),
      default: true,
      label: 'Encrypt MediaFlow URLs',
      description: 'Encrypt MediaFlow proxy URLs surfaced to clients.',
      env: 'ENCRYPT_MEDIAFLOW_URLS',
      requiresRestart: false,
      secret: false,
    },
    stremthru: {
      schema: z.boolean(),
      default: true,
      label: 'Encrypt StremThru URLs',
      description: 'Encrypt StremThru proxy URLs surfaced to clients.',
      env: 'ENCRYPT_STREMTHRU_URLS',
      requiresRestart: false,
      secret: false,
    },
  },
  default: {
    enabled: {
      schema: z.union([z.boolean(), z.null()]),
      default: null,
      label: 'Default proxy enabled',
      description:
        'When set, used as the default proxy enabled state for new users.',
      env: 'DEFAULT_PROXY_ENABLED',
      requiresRestart: false,
      secret: false,
    },
    id: {
      schema: nullableString,
      default: null,
      label: 'Default proxy ID',
      description: 'Default proxy service identifier.',
      env: 'DEFAULT_PROXY_ID',
      requiresRestart: false,
      secret: false,
    },
    url: {
      schema: nullableUrl,
      default: null,
      label: 'Default proxy URL',
      description: 'Default proxy URL.',
      env: 'DEFAULT_PROXY_URL',
      requiresRestart: false,
      secret: false,
    },
    publicUrl: {
      schema: nullableUrl,
      default: null,
      label: 'Default proxy public URL',
      description:
        'Public-facing default proxy URL surfaced to clients (when different from the internal one).',
      env: 'DEFAULT_PROXY_PUBLIC_URL',
      requiresRestart: false,
      secret: false,
    },
    credentials: {
      schema: nullableString,
      default: null,
      label: 'Default proxy credentials',
      description: 'Credentials for the default proxy.',
      env: 'DEFAULT_PROXY_CREDENTIALS',
      requiresRestart: false,
      secret: true,
    },
    publicIp: {
      schema: nullableString,
      default: null,
      label: 'Default proxy public IP',
      description: 'Public IP of the default proxy.',
      env: 'DEFAULT_PROXY_PUBLIC_IP',
      requiresRestart: false,
      secret: false,
    },
    proxiedServices: {
      schema: proxiedServicesList,
      default: null as string[] | null,
      label: 'Default proxied services',
      description:
        'List of serviceIds to proxy by default. JSON array of strings.',
      env: 'DEFAULT_PROXY_PROXIED_SERVICES',
      requiresRestart: false,
      secret: false,
    },
  },
  force: {
    enabled: {
      schema: z.union([z.boolean(), z.null()]),
      default: null,
      label: 'Force proxy enabled',
      description: 'Override user choice of whether the proxy is enabled.',
      env: 'FORCE_PROXY_ENABLED',
      requiresRestart: false,
      secret: false,
    },
    id: {
      schema: nullableString,
      default: null,
      label: 'Force proxy ID',
      description: 'Override user choice of proxy service identifier.',
      env: 'FORCE_PROXY_ID',
      requiresRestart: false,
      secret: false,
    },
    url: {
      schema: nullableUrl,
      default: null,
      label: 'Force proxy URL',
      description: 'Override user choice of proxy URL.',
      env: 'FORCE_PROXY_URL',
      requiresRestart: false,
      secret: false,
    },
    publicUrl: {
      schema: nullableUrl,
      default: null,
      label: 'Force proxy public URL',
      description: 'Override user choice of proxy public URL.',
      env: 'FORCE_PROXY_PUBLIC_URL',
      requiresRestart: false,
      secret: false,
    },
    credentials: {
      schema: nullableString,
      default: null,
      label: 'Force proxy credentials',
      description: 'Override user choice of proxy credentials.',
      env: 'FORCE_PROXY_CREDENTIALS',
      requiresRestart: false,
      secret: true,
    },
    publicIp: {
      schema: nullableString,
      default: null,
      label: 'Force proxy public IP',
      description: 'Override user choice of proxy public IP.',
      env: 'FORCE_PROXY_PUBLIC_IP',
      requiresRestart: false,
      secret: false,
    },
    disableProxiedAddons: {
      schema: z.boolean(),
      default: false,
      label: 'Disable proxied addons',
      description:
        'When forcing a proxy, also disable any addons that already proxy themselves.',
      env: 'FORCE_PROXY_DISABLE_PROXIED_ADDONS',
      requiresRestart: false,
      secret: false,
    },
    proxiedServices: {
      schema: proxiedServicesList,
      default: null as string[] | null,
      label: 'Forced proxied services',
      description: 'List of serviceIds to force-proxy. JSON array of strings.',
      env: 'FORCE_PROXY_PROXIED_SERVICES',
      requiresRestart: false,
      secret: false,
    },
  },
  ip: {
    cacheTtl: {
      schema: positiveInt,
      default: 900,
      label: 'Proxy IP cache TTL (s)',
      description: 'Cache TTL for resolved proxy IPs (seconds).',
      env: 'PROXY_IP_CACHE_TTL',
      requiresRestart: false,
      secret: false,
    },
  },
} as const satisfies RuntimeConfigSection;
