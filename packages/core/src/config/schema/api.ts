import { z } from 'zod';
import { commaSeparatedList, seconds } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

const nullableString = z.string().nullable();

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const aliasEntry = z.object({
  uuid: z.string().regex(UUID_REGEX, 'Invalid UUID'),
  password: z.string(),
});

/**
 * Accepts either:
 * - a `Record<string, { uuid, password }>` (DB-stored shape), or
 * - the comma-separated env string format `alias:uuid:password,alias:uuid:password,...`.
 */
const aliasedConfigurations = z.union([
  z.record(z.string(), aliasEntry),
  z.string().transform((value, ctx) => {
    const out: Record<string, { uuid: string; password: string }> = {};
    if (!value.trim()) return out;
    for (const entry of value.split(',').map((e) => e.trim())) {
      if (!entry) continue;
      const [alias, uuid, password] = entry.split(':');
      if (!alias || !uuid || !password) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid alias entry "${entry}". Expected alias:uuid:password.`,
        });
        return z.NEVER;
      }
      if (!UUID_REGEX.test(uuid)) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid UUID for alias "${alias}".`,
        });
        return z.NEVER;
      }
      out[alias] = { uuid, password };
    }
    return out;
  }),
]);

const provideStreamData = z.union([
  z.boolean(),
  z.array(z.string()),
  z.null(),
  z.string().transform((value) => {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
    return value
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0);
  }),
]);

export const apiSchema = {
  authRequired: {
    schema: z.boolean(),
    default: false,
    label: 'Require authentication for the config page',
    description:
      'When true, /stremio/configure requires a valid login session (any user in AIOSTREAMS_AUTH) and the config-write gate (CONFIG_ACCESS_KEY) is enforced. When false, the config page is public.',
    env: 'AIOSTREAMS_AUTH_REQUIRED',
    requiresRestart: false,
    secret: false,
  },
  configAccessKey: {
    schema: nullableString,
    default: null,
    label: 'Config access key',
    description:
      'Single key embedded in a config and checked on create/update/serve. If unset while authRequired is true, one is generated and persisted automatically. Rotating it invalidates every existing config until re-saved.',
    env: 'CONFIG_ACCESS_KEY',
    requiresRestart: false,
    secret: true,
  },
  sessionTtlSeconds: {
    schema: seconds,
    default: 86400,
    label: 'Session lifetime',
    description:
      'Lifetime of a login session before the user must log in again. Defaults to 24 hours (1d).',
    env: 'SESSION_TTL_SECONDS',
    requiresRestart: false,
    secret: false,
  },
  aliasedConfigurations: {
    schema: aliasedConfigurations,
    default: {} as Record<string, { uuid: string; password: string }>,
    label: 'Aliased configurations',
    description:
      'Map of aliases to {uuid, password} accessible at /stremio/u/<alias>/manifest.json. Env-supplied form: comma-separated `alias:uuid:password` entries.',
    env: 'ALIASED_CONFIGURATIONS',
    requiresRestart: false,
    secret: true,
  },
  enableSearchApi: {
    schema: z.boolean(),
    default: true,
    label: 'Enable search API',
    description:
      'When true, the /api/search endpoint is mounted and reachable.',
    env: 'ENABLE_SEARCH_API',
    requiresRestart: true,
    secret: false,
  },
  provideStreamData: {
    schema: provideStreamData,
    default: null,
    label: 'Provide stream data',
    description:
      'Whether stream metadata is included in Stremio stream responses. `null` (default) auto-detects from User-Agent (AIOStreams/* always gets it). `true`/`false` overrides for everyone. An IP list enables it only for matching request IPs.',
    env: 'PROVIDE_STREAM_DATA',
    requiresRestart: false,
    secret: false,
  },
  exposeUserCount: {
    schema: z.boolean(),
    default: false,
    label: 'Expose user count',
    description: 'Include the total user count on the public status endpoint.',
    env: 'EXPOSE_USER_COUNT',
    requiresRestart: false,
    secret: false,
  },
  stremioAddonsConfigIssuer: {
    schema: nullableString,
    default: 'https://stremio-addons.net',
    label: 'Stremio Addons Config issuer',
    description:
      'Issuer URL declared in the manifest for the Stremio Addons Config integration.',
    env: 'STREMIO_ADDONS_CONFIG_ISSUER',
    requiresRestart: false,
    secret: false,
  },
  stremioAddonsConfigSignature: {
    schema: nullableString,
    default: null,
    label: 'Stremio Addons Config signature',
    description:
      'Signed JWT for the Stremio Addons Config integration. Both issuer and signature must be set for the manifest field to be emitted.',
    env: 'STREMIO_ADDONS_CONFIG_SIGNATURE',
    requiresRestart: false,
    secret: true,
  },

  trustedIps: {
    schema: commaSeparatedList,
    default: ['172.17.0.0/16', '127.0.0.1/32', '::1/128'],
    label: 'Trusted IPs',
    description:
      'Comma-separated list of trusted IPs / CIDR ranges. Used when determining the requesting IP. User IP is always trusted via headers regardless of this setting.',
    env: 'TRUSTED_IPS',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
