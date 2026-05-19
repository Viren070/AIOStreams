import { z } from 'zod';
import { positiveInt } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

export const analyticsSchema = {
  enabled: {
    schema: z.boolean(),
    default: true,
    label: 'Enable analytics',
    description:
      'When false, all request analytics collection is disabled — zero events are written.',
    env: 'ANALYTICS_ENABLED',
    requiresRestart: false,
    secret: false,
  },
  userAnalyticsEnabled: {
    schema: z.boolean(),
    default: false,
    label: 'Per-user analytics enabled',
    description:
      'When enabled, the configure-page "Stats" tab is available to every authenticated user. Adds one event per addon per stream request.',
    env: 'USER_ANALYTICS_ENABLED',
    requiresRestart: false,
    secret: false,
  },
  eventRetentionDays: {
    schema: positiveInt,
    default: 7,
    label: 'Analytics raw-event retention (days)',
    description:
      'How many days of raw per-request analytics events to keep before the rollup task prunes them. The per-user Stats tab is limited to this window.',
    env: 'ANALYTICS_EVENT_RETENTION_DAYS',
    requiresRestart: false,
    secret: false,
  },
  dailyRetentionDays: {
    schema: positiveInt,
    default: 90,
    label: 'Analytics daily-rollup retention (days)',
    description: 'How many days of aggregated daily analytics to keep.',
    env: 'ANALYTICS_DAILY_RETENTION_DAYS',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
