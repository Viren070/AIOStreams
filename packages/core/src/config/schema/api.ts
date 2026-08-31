import { z } from 'zod';
import { byteSize, commaSeparatedList, seconds } from './helpers.js';
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
  configSessionsEnabled: {
    schema: z.boolean(),
    default: true,
    label: 'Remembered configuration sign-ins',
    description:
      'Lets someone stay signed in to their configuration after closing the tab, using a cookie the browser cannot read rather than a stored password. Turn it off to require the UUID and password every time.',
    env: 'CONFIG_SESSIONS_ENABLED',
    requiresRestart: false,
    secret: false,
  },
  configSessionTtlSeconds: {
    schema: seconds,
    default: 2592000,
    label: 'Remembered sign-in lifetime',
    description:
      'How long a remembered sign-in survives without being used. Every use pushes it forward again. Defaults to 30 days (30d).',
    env: 'CONFIG_SESSION_TTL_SECONDS',
    requiresRestart: false,
    secret: false,
  },
  configSessionMaxTtlSeconds: {
    schema: seconds,
    default: 7776000,
    label: 'Remembered sign-in maximum lifetime',
    description:
      'Hard cap on a remembered sign-in, counted from when it was created and never extended by use. Defaults to 90 days (90d).',
    env: 'CONFIG_SESSION_MAX_TTL_SECONDS',
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
      'When true, the /api/v1/search endpoint is mounted and reachable.',
    env: 'ENABLE_SEARCH_API',
    requiresRestart: true,
    secret: false,
  },
  enableNabApi: {
    schema: z.boolean(),
    default: true,
    label: 'Enable newznab/torznab API',
    description:
      'When true, the per-user /api/v1/newznab/api and /api/v1/torznab/api endpoints are mounted and reachable. These expose a user’s stream results to newznab/torznab clients (Prowlarr, Sonarr, Radarr) as an indexer, supporting ID and season/episode lookups only.',
    env: 'ENABLE_NAB_API',
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
    default: ['loopback', 'linklocal', 'uniquelocal'],
    label: 'Trusted IPs',
    description:
      'Comma-separated list of trusted IPs, CIDR ranges, or the named ranges loopback, linklocal and uniquelocal (the default trusts any proxy on the same host or a private network). Forwarded headers (X-Forwarded-For, X-Forwarded-Proto, X-Forwarded-Host) are only honoured from these addresses, which decides the requesting IP used for rate limiting and whether session cookies are marked Secure. User IP is always trusted via headers regardless of this setting.',
    env: 'TRUSTED_IPS',
    requiresRestart: false,
    secret: false,
  },
  maxJsonBodySize: {
    schema: byteSize,
    default: 256 * 1024,
    label: 'Max JSON request body',
    description:
      'Largest JSON request body the API accepts, which bounds saved configurations and uploaded templates. Raise it if large templates are refused with a 413.',
    env: 'MAX_JSON_BODY_SIZE',
    requiresRestart: true,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
