import { z } from 'zod';
import { seconds } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

export const linkedAccountsSchema = {
  enabled: {
    schema: z.boolean(),
    default: true,
    label: 'Linked accounts',
    description:
      'Let users link a Stremio account or an AIOManager instance and push their addon to it when their configuration changes. Turning this off hides the feature and rejects every request to it; existing links are kept but never used.',
    env: 'LINKED_ACCOUNTS_ENABLED',
    requiresRestart: false,
    secret: false,
  },
  maxPerUser: {
    schema: z.number().int().min(1),
    default: 10,
    label: 'Max linked accounts per configuration',
    description:
      'How many accounts a single configuration may link. Links already over the limit are kept, but no new ones can be added until some are removed.',
    env: 'LINKED_ACCOUNTS_MAX_PER_USER',
    requiresRestart: false,
    secret: false,
    ui: { min: 1 },
  },
  parentPushDelay: {
    schema: seconds,
    default: 30,
    label: 'Parent change push delay',
    description:
      'How long to wait after a configuration is saved before pushing the configurations that inherit from it, for links that opted in (accepts e.g. "30s", "2m"). Saves within the wait are pushed once.',
    env: 'LINKED_ACCOUNTS_PARENT_PUSH_DELAY',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' },
  },
  parentPushMaxLinks: {
    schema: z.number().int().min(1),
    default: 100,
    label: 'Max links pushed per parent change',
    description:
      'How many links of inheriting configurations one save may push. Links past the limit are skipped and logged, so one widely inherited configuration cannot start a large burst of pushes.',
    env: 'LINKED_ACCOUNTS_PARENT_PUSH_MAX_LINKS',
    requiresRestart: false,
    secret: false,
    ui: { min: 1 },
  },
} as const satisfies RuntimeConfigSection;
