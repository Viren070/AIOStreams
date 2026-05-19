import { positiveInt } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

export const posterSchema = {
  apiKeyValidityCacheTtl: {
    schema: positiveInt,
    default: 7 * 24 * 60 * 60,
    label: 'Poster API key validity cache TTL (s)',
    description:
      'How long an RPDB / poster-API key validity check is cached (seconds).',
    env: 'POSTER_API_KEY_VALIDITY_CACHE_TTL',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
