import { seconds, secondsAllowingDisabled } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

/**
 * Background maintenance task schedules and retention.
 *
 * Subsections:
 * - `pruning`: removing inactive users
 *
 * (Stream precache/preload behaviour now lives under `resources`; analytics
 * retention has moved to the dedicated `analytics` section.)
 */
export const tasksSchema = {
  pruning: {
    interval: {
      schema: seconds,
      default: 86400,
      label: 'Pruning interval',
      description:
        'How often to run the inactive-user pruning task (accepts e.g. "12h", "1d").',
      env: 'PRUNE_INTERVAL',
      requiresRestart: true,
      secret: false,
      ui: { kind: 'duration' },
    },
    maxDays: {
      schema: secondsAllowingDisabled,
      default: -1,
      label: 'Pruning max days',
      description:
        'Days of inactivity before a user is pruned. Use -1 to disable pruning entirely.',
      env: 'PRUNE_MAX_DAYS',
      requiresRestart: false,
      secret: false,
      ui: { kind: 'number', min: -1 },
    },
  },
} as const satisfies RuntimeConfigSection;
