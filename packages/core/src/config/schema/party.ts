import { z } from 'zod';
import { optionalUrlString } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

/** Watch parties: SyncPlay for Jellyfin apps, and the relay the AIOStreams apps use. */
export const partySchema = {
  relay: {
    schema: z.enum(['off', 'users', 'public']),
    default: 'off',
    label: 'Relay',
    description:
      "Who else may use this server's watch party relay, besides its own users. **off**: only users of this server start and join parties. **users**: users of this server start parties, and anyone with an invite joins from any server. It needs `AIOSTREAMS_AUTH_REQUIRED`, since a public config page would let anyone make a configuration and start parties. **public**: anyone starts and joins parties, for a relay meant for everyone.",
    env: 'PARTY_RELAY',
    requiresRestart: false,
    secret: false,
  },
  scope: {
    schema: z.enum(['configuration', 'instance']),
    default: 'configuration',
    label: 'Who sees parties',
    description:
      "Which users of this server see each other's parties without an invite. **configuration**: the users of one configuration. **instance**: every user of this server, for a private server shared with friends. On a public server that would show strangers what others watch.",
    env: 'PARTY_SCOPE',
    requiresRestart: false,
    secret: false,
  },
  defaultRelay: {
    schema: optionalUrlString,
    default: 'https://aiostreams.viren070.me',
    label: 'Default relay',
    description:
      "A relay the apps offer for parties with people on other servers, when this server's own relay is off: the address of an AIOStreams server whose relay is open to them. Leave it empty to offer none.",
    env: 'PARTY_DEFAULT_RELAY',
    requiresRestart: false,
    secret: false,
  },
  maxParties: {
    schema: z.number().int().min(1),
    default: 1000,
    label: 'Max parties',
    description:
      "Parties held at once, its users' and the relay's together. Each takes a few kilobytes and its members' connections.",
    env: 'PARTY_MAX_PARTIES',
    requiresRestart: false,
    secret: false,
    ui: { min: 1 },
  },
} as const satisfies RuntimeConfigSection;
