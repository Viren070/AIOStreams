import { z } from 'zod';
import { commaSeparatedList, positiveInt } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

const PUBLIC_EXPORT_UI = { hidden: true } as const;

export const releaseBlocklistSchema = {
  quorum: {
    schema: positiveInt.refine((n) => n <= 20, {
      message: 'Quorum must be between 1 and 20.',
    }),
    default: 2,
    label: 'Corroboration quorum',
    description:
      'How many **corroborate**-trust sources must flag the same release before their shared verdict filters it. **full**-trust sources always filter on their own. If you have fewer corroborate sources than this number, their verdicts never filter anything.',
    env: 'RELEASE_BLOCKLIST_QUORUM',
    requiresRestart: false,
    secret: false,
  },
  backboneScope: {
    schema: z.enum(['off', 'overlap', 'covers']),
    default: 'overlap' as const,
    label: 'Backbone scope',
    description:
      'How shared dead-release verdicts are matched against the backbones your usenet providers use. A release missing on one backbone can still be intact on another, so **overlap** applies a verdict observed on at least one backbone you use, **covers** only applies one observed on every backbone you use, and **off** skips the check and applies every verdict. Verdicts recorded by this instance itself always apply.',
    env: 'RELEASE_BLOCKLIST_BACKBONE_SCOPE',
    requiresRestart: false,
    secret: false,
  },
  backboneGrouping: {
    schema: z.enum(['backbone', 'domain']),
    default: 'backbone' as const,
    label: 'Backbone grouping',
    description:
      'How provider hosts are compared during the backbone scope check. **backbone** treats every provider reselling the same backbone as one group, which fits takedowns: those remove an article from the shared storage for all of them at once. **domain** only matches verdicts recorded on the same provider domain. Backbones enforce retention per reseller, so an old article can be expired on a short-retention brand yet intact on a full-retention one riding the same backbone; **domain** stops such verdicts from crossing brands, at the cost of far fewer shared verdicts applying to you. Backbone ids in the trusted backbones list keep working in either mode.',
    env: 'RELEASE_BLOCKLIST_BACKBONE_GROUPING',
    requiresRestart: false,
    secret: false,
  },
  trustedBackbones: {
    schema: commaSeparatedList,
    default: [],
    label: 'Trusted backbones',
    description:
      'Extra backbones, as root domains or backbone ids (e.g. **omicron**), whose verdicts you accept as if your own providers used them. Useful when your providers are on a small or unrecognized backbone, where shared verdicts would otherwise never pass the backbone scope check.',
    env: 'RELEASE_BLOCKLIST_TRUSTED_BACKBONES',
    requiresRestart: false,
    secret: false,
  },
  publicExport: {
    schema: z.boolean(),
    default: false,
    label: 'Public export endpoint',
    description:
      "Serve this instance's blocklist at `/blocklist/export` so other instances can subscribe to it. The list contains only release digests and backbone root domains.",
    env: 'RELEASE_BLOCKLIST_PUBLIC_EXPORT',
    requiresRestart: false,
    secret: false,
    ui: PUBLIC_EXPORT_UI,
  },
  publicExportScope: {
    schema: z.enum(['local', 'all']),
    default: 'local' as const,
    label: 'Public export scope',
    description:
      'The most the public export is allowed to serve. With **local**, subscribers only ever receive verdicts this instance recorded first-hand, even if they ask for more. **all** additionally allows `?scope=all` requests, which also serve everything collected from your subscribed and imported lists, including ones you do not trust yourself, so enable it only if you mean to re-publish them.',
    env: 'RELEASE_BLOCKLIST_PUBLIC_EXPORT_SCOPE',
    requiresRestart: false,
    secret: false,
    ui: PUBLIC_EXPORT_UI,
  },
  publicExportPassword: {
    schema: z.string(),
    default: '',
    label: 'Public export password',
    description:
      'When set, the public export requires `?key=<value>` in the URL. Share the full URL with instances you want to allow; a missing or wrong key gets the same 404 as a disabled export, so the endpoint stays invisible.',
    env: 'RELEASE_BLOCKLIST_PUBLIC_EXPORT_PASSWORD',
    requiresRestart: false,
    secret: true,
    ui: PUBLIC_EXPORT_UI,
  },
} as const satisfies RuntimeConfigSection;

/** The `releaseBlocklist.*` keys managed by the publishing page's editor. */
export const PUBLIC_EXPORT_SETTING_KEYS = [
  'releaseBlocklist.publicExport',
  'releaseBlocklist.publicExportScope',
  'releaseBlocklist.publicExportPassword',
] as const;

export type PublicExportSettingKey =
  (typeof PUBLIC_EXPORT_SETTING_KEYS)[number];

export function isPublicExportSettingKey(
  key: string
): key is PublicExportSettingKey {
  return (PUBLIC_EXPORT_SETTING_KEYS as readonly string[]).includes(key);
}
