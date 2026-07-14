import { z } from 'zod';
import type { RuntimeConfigSection } from '../types.js';
import {
  LEGACY_LOG_LEVELS,
  LOG_LEVELS,
  normaliseLevel,
} from '../../logging/logger.js';

export const loggingSchema = {
  logLevel: {
    schema: z.enum([...LOG_LEVELS, ...LEGACY_LOG_LEVELS]),
    default: 'info',
    label: 'Log level',
    description: 'How much detail to log.',
    env: 'LOG_LEVEL',
    requiresRestart: false,
    secret: false,
    transform: normaliseLevel,
    ui: { kind: 'enum', options: [...LOG_LEVELS] },
  },
  logFormat: {
    schema: z.enum(['json', 'text']),
    default: 'json',
    label: 'Log format',
    description:
      'How log lines are printed to the console. `json` is recommended for production.',
    env: 'LOG_FORMAT',
    requiresRestart: false,
    secret: false,
  },
  logSensitiveInfo: {
    schema: z.boolean(),
    default: false,
    label: 'Log sensitive info',
    description:
      'When true, sensitive values may appear in logs. Use only for debugging.',
    env: 'LOG_SENSITIVE_INFO',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
