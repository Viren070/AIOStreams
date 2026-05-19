import { z } from 'zod';
import type { RuntimeConfigSection } from '../types.js';

export const loggingSchema = {
  logSensitiveInfo: {
    schema: z.boolean(),
    default: false,
    label: 'Log sensitive info',
    description:
      'When true, sensitive values may appear in logs. Use only for debugging.',
    env: 'LOG_SENSITIVE_INFO',
    requiresRestart: true,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
