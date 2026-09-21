import { z } from 'zod';
import { seconds, urlString } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

export const remuxdbSchema = {
  enabled: {
    schema: z.boolean(),
    default: true,
    label: 'RemuxDB',
    description:
      'Let users fill in missing stream details from RemuxDB. Lookups are sent from this server, so turning this off hides the setting and stops all lookups.',
    env: 'REMUXDB_ENABLED',
    requiresRestart: false,
    secret: false,
  },
  baseUrl: {
    schema: urlString,
    default: 'https://remuxdb.1632022.xyz',
    label: 'RemuxDB base URL',
    description: 'RemuxDB instance to query.',
    env: 'REMUXDB_BASE_URL',
    requiresRestart: false,
    secret: false,
  },
  cacheTtl: {
    schema: seconds,
    default: 6 * 60 * 60,
    label: 'RemuxDB cache TTL (s)',
    description: 'How long to cache a successful lookup.',
    env: 'REMUXDB_CACHE_TTL',
    requiresRestart: false,
    secret: false,
  },
  negativeCacheTtl: {
    schema: seconds,
    default: 30 * 60,
    label: 'RemuxDB negative cache TTL (s)',
    description: 'How long to cache a "nothing found" result.',
    env: 'REMUXDB_NEGATIVE_CACHE_TTL',
    requiresRestart: false,
    secret: false,
  },
  errorCacheTtl: {
    schema: seconds,
    default: 60,
    label: 'RemuxDB error cache TTL (s)',
    description:
      'How long to wait before retrying a lookup that failed (timeout or error response).',
    env: 'REMUXDB_ERROR_CACHE_TTL',
    requiresRestart: false,
    secret: false,
  },
  minimumBackgroundRefreshInterval: {
    schema: seconds,
    default: 30 * 60,
    label: 'RemuxDB minimum background refresh interval (s)',
    description:
      'Minimum interval between background refreshes of a cached lookup.',
    env: 'REMUXDB_MINIMUM_BACKGROUND_REFRESH_INTERVAL',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
