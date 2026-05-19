import { positiveInt, seconds } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

export const recursionSchema = {
  thresholdLimit: {
    schema: positiveInt,
    default: 60,
    label: 'Recursion threshold limit',
    description:
      'Maximum number of requests to the same URL within the threshold window before marking the chain as recursive.',
    env: 'RECURSION_THRESHOLD_LIMIT',
    requiresRestart: false,
    secret: false,
  },
  thresholdWindow: {
    schema: seconds,
    default: 10,
    label: 'Recursion threshold window',
    description:
      'Time window for the recursion threshold (seconds; accepts e.g. "30s", "1m").',
    env: 'RECURSION_THRESHOLD_WINDOW',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
