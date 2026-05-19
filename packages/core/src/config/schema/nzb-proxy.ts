import { z } from 'zod';
import { byteSize, positiveInt, urlString } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

export const nzbProxySchema = {
  publicEnabled: {
    schema: z.boolean(),
    default: false,
    label: 'Public NZB proxy enabled',
    description:
      'Enable the public/generic NZB proxy endpoint. Disabled by default for security.',
    env: 'NZB_PROXY_PUBLIC_ENABLED',
    requiresRestart: true,
    secret: false,
  },
  easynewsEnabled: {
    schema: z.boolean(),
    default: false,
    label: 'Easynews NZB proxy enabled',
    description: 'Enable the Easynews-specific NZB proxy endpoint.',
    env: 'NZB_PROXY_EASYNEWS_ENABLED',
    requiresRestart: true,
    secret: false,
  },
  maxSize: {
    schema: byteSize,
    default: 20 * 1000 * 1000,
    label: 'Max NZB size',
    description:
      'Maximum size of NZBs that can be proxied. Accepts plain bytes or `20MB`-style strings.',
    env: 'NZB_PROXY_MAX_SIZE',
    requiresRestart: false,
    secret: false,
  },
  rateLimitWindow: {
    schema: positiveInt,
    default: 3600,
    label: 'NZB proxy rate-limit window (s)',
    description: 'Sliding window for the NZB proxy rate limit (seconds).',
    env: 'NZB_PROXY_RATE_LIMIT_WINDOW',
    requiresRestart: true,
    secret: false,
  },
  rateLimitPerUser: {
    schema: positiveInt,
    default: 100,
    label: 'NZB proxy max requests per user',
    description: 'Maximum NZB proxy requests per user per window.',
    env: 'NZB_PROXY_RATE_LIMIT_PER_USER',
    requiresRestart: true,
    secret: false,
  },
  zyclopsHealthProxyEndpoint: {
    schema: urlString,
    default: 'https://zyclops.elfhosted.com',
    label: 'Zyclops health proxy endpoint',
    description:
      'Base URL of the Zyclops health proxy used by the Newznab preset.',
    env: 'ZYCLOPS_HEALTH_PROXY_ENDPOINT',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
