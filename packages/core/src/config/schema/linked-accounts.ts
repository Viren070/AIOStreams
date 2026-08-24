import { z } from 'zod';
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
  allowPrivateUrls: {
    schema: z.boolean(),
    default: false,
    label: 'Allow private linked account URLs',
    description:
      'Allow linking an AIOManager instance on a private or loopback address, such as `http://aiomanager:1610` on a Docker network. This lets anyone who can create a configuration make this server send requests to your internal network, so only enable it on a trusted, non-public instance.',
    env: 'LINKED_ACCOUNTS_ALLOW_PRIVATE_URLS',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
