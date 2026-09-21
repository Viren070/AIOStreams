import { z } from 'zod';
import { nonNegativeInt, seconds, urlOrUrlList } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

const moderationMode = z.enum(['off', 'open', 'approval']);

export type CommunityModerationMode = z.infer<typeof moderationMode>;

/**
 * Community sharing: formatters and templates that users upload to this
 * instance for everyone else to browse, like and install.
 */
export const communitySchema = {
  formatters: {
    schema: moderationMode,
    default: 'approval' as CommunityModerationMode,
    label: 'Community formatters',
    description:
      'Whether users can share formatters with everyone on this instance. **off** hides the feature, **open** publishes submissions immediately, **approval** holds them until an admin approves them in the dashboard. Names, descriptions and tags are free text shown to everyone, so approval is the safe default.',
    env: 'COMMUNITY_FORMATTERS',
    requiresRestart: false,
    secret: false,
  },
  templates: {
    schema: moderationMode,
    default: 'approval' as CommunityModerationMode,
    label: 'Community templates',
    description:
      'Whether users can share configuration templates with everyone on this instance. **off** hides the feature, **open** publishes submissions immediately, **approval** holds them until an admin reviews them in the dashboard. Templates can point addons at arbitrary hosts, so approval is the safe default.',
    env: 'COMMUNITY_TEMPLATES',
    requiresRestart: false,
    secret: false,
  },
  minAccountAge: {
    schema: seconds,
    default: 86400,
    label: 'Minimum account age',
    description:
      'How old a configuration must be before it can submit or like community items. Raises the cost of creating throwaway configurations to skew likes.',
    env: 'COMMUNITY_MIN_ACCOUNT_AGE',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' },
  },
  maxSubmissionsPerDay: {
    schema: nonNegativeInt,
    default: 10,
    label: 'Max submissions per day',
    description:
      'How many community items (new or updated) one configuration may submit within 24 hours. 0 blocks submissions entirely while keeping the browser available.',
    env: 'COMMUNITY_MAX_SUBMISSIONS_PER_DAY',
    requiresRestart: false,
    secret: false,
  },
  remoteSources: {
    schema: urlOrUrlList,
    default: [] as string[],
    label: 'Remote community sources',
    description:
      'Other AIOStreams instances whose approved community items are shown here read-only. Give the instance URL or its `/community/export.json` directly. Items from remote sources cannot be liked.',
    env: 'COMMUNITY_REMOTE_SOURCES',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'list' },
  },
  remoteRefreshInterval: {
    schema: seconds,
    default: 86400,
    label: 'Remote community refresh interval',
    description:
      'How often remote community sources are re-fetched. Set to 0 to disable automatic refresh.',
    env: 'COMMUNITY_REMOTE_REFRESH_INTERVAL',
    requiresRestart: false,
    secret: false,
    ui: { kind: 'duration' },
  },
  publicExport: {
    schema: z.boolean(),
    default: true,
    label: 'Public community export',
    description:
      "Serve this instance's approved community items at `/community/export.json` so other instances can list them as a remote source.",
    env: 'COMMUNITY_PUBLIC_EXPORT',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
