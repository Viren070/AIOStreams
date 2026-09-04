import { z } from 'zod';
import type { RuntimeConfigSection } from '../types.js';
import {
  QUEUE_CLEANUP_RULE_IDS,
  DEFAULT_QUEUE_CLEANUP_RULES,
} from './arr-rules.js';

export const arrInstanceSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  type: z.enum(['sonarr', 'radarr']),
  url: z.string().url(),
  apiKey: z.string(),
  enabled: z.boolean().optional(),
  categories: z.array(z.string()).optional(),
});

/** What to do with a queue item the arr could not import. */
export const queueCleanupActions = [
  'remove',
  'blocklist',
  'blocklist_search',
  'import',
] as const;

export const queueCleanupRuleSchema = z.object({
  id: z.enum(QUEUE_CLEANUP_RULE_IDS),
  enabled: z.boolean(),
  action: z.enum(queueCleanupActions),
});

/**
 * Sonarr/Radarr "download client" integration, shared by every transport
 * that can act as one (the usenet engine today).
 */
export const arrSchema = {
  mountDir: {
    schema: z.string(),
    default: '',
    label: 'Mount directory',
    description:
      'Absolute path at which Sonarr/Radarr (and your media server) see the ' +
      'rclone mount of `/webdav`, e.g. `/mnt/aiostreams`. It is reported ' +
      'back through the SABnzbd API as the completed-download folder and ' +
      'used as the target of the symlinks the arr imports, so it must be ' +
      'the same absolute path in every container that reads the mount. ' +
      'Leave empty to keep the SABnzbd API metadata-only (grabs work, ' +
      'imports do not).',
    env: 'ARR_MOUNT_DIR',
    requiresRestart: false,
    secret: false,
  },
  importMode: {
    schema: z.enum(['symlink', 'strm', 'content']),
    default: 'symlink',
    label: 'Import mode',
    description:
      'What the arr finds in the completed folder. `symlink` serves ' +
      '`.rclonelink` files that an rclone mount with `--links` turns into ' +
      'symlinks to the streamed file (Plex, Jellyfin and Emby all follow ' +
      'them). `strm` serves `.strm` files holding a stream URL, for Jellyfin ' +
      'and Emby without FUSE. `content` exposes the media bytes directly; ' +
      'the arr then copies the whole release through usenet on import.',
    env: 'ARR_IMPORT_MODE',
    requiresRestart: false,
    secret: false,
  },
  instances: {
    schema: z.array(arrInstanceSchema),
    default: [],
    label: 'Sonarr / Radarr instances',
    description: {
      ui:
        'Instances AIOStreams may call back: to refresh their queue as soon ' +
        'as a grab completes, and to replace a release the library recheck ' +
        'found dead (the file record is removed and the grab marked failed, ' +
        'so the arr blocklists it and searches again).',
      env:
        'JSON array of `{ "id", "name", "type": "sonarr"|"radarr", "url", ' +
        '"apiKey", "enabled", "categories" }` objects. `categories` limits ' +
        'the instance to those download-client categories; omit for any.',
    },
    env: 'ARR_INSTANCES',
    requiresRestart: false,
    secret: true,
    ui: { kind: 'json', hidden: true },
  },
  searchAfterRepair: {
    schema: z.boolean(),
    default: false,
    label: 'Search after repair',
    description:
      'After marking a dead release failed, ask the arr to search for a ' +
      'replacement. Turn this on if you have the arr’s own "Redownload ' +
      'Failed" setting off but still want dead releases replaced, or if you ' +
      'grab interactively — the arr does not automatically redownload those. ' +
      'With "Redownload Failed" on, the arr already searches and this would ' +
      'be a second, identical search.',
    env: 'ARR_SEARCH_AFTER_REPAIR',
    requiresRestart: false,
    secret: false,
  },
  autoRepair: {
    schema: z.boolean(),
    default: true,
    label: 'Repair automatically',
    description:
      'Act on a dead release: remove the file record the import produced and ' +
      'mark the grab failed, so the arr blocklists it and looks again. Off ' +
      'still marks entries failed and shows them in the library, but leaves ' +
      'your arr untouched — useful to watch what this would do before letting ' +
      'it, or if you would rather handle replacements yourself. The library ' +
      'entry’s "Retry repair" button works either way.',
    env: 'ARR_AUTO_REPAIR',
    requiresRestart: false,
    secret: false,
  },
  maxRepairsPerItem: {
    schema: z.number().int().min(0),
    default: 3,
    label: 'Repair attempts per item',
    description:
      'How many dead releases to replace for the same episode or movie ' +
      'before giving up on it. Every replacement is a fresh grab, so a title ' +
      'whose releases all come from one dead poster would otherwise churn ' +
      'indefinitely and burn indexer grabs. At the limit the release is ' +
      'blocklisted without another search and the item is unmonitored, so ' +
      'the arr stops re-grabbing it. Counting resets once something imports ' +
      'and stays healthy. 0 disables the limit.',
    env: 'ARR_MAX_REPAIRS_PER_ITEM',
    requiresRestart: false,
    secret: false,
  },
  queueCleanup: {
    enabled: {
      schema: z.boolean(),
      default: false,
      label: 'Clean up stuck queue items',
      description:
        'Watch the queues of your configured Sonarr/Radarr instances for ' +
        'downloads of ours they could not import, and act on the reason they ' +
        'gave: replace a bad release, nudge an import through, or clear a ' +
        'stale entry. Without this, a failed import sits in the arr’s queue ' +
        'until someone notices. Only items AIOStreams handed over are ever ' +
        'touched.',
      env: 'ARR_QUEUE_CLEANUP_ENABLED',
      requiresRestart: false,
      secret: false,
    },
    graceMinutes: {
      schema: z.number().int().min(0),
      default: 5,
      label: 'Grace period (minutes)',
      description:
        'How long an item must stay stuck before anything is done to it, so ' +
        'a warning the arr clears on its own is left alone. Stale entries ' +
        'for downloads that are already imported skip the wait.',
      env: 'ARR_QUEUE_CLEANUP_GRACE_MINUTES',
      requiresRestart: false,
      secret: false,
    },
    rules: {
      schema: z.array(queueCleanupRuleSchema),
      default: DEFAULT_QUEUE_CLEANUP_RULES,
      label: 'Queue cleanup rules',
      description: {
        ui:
          'What to do for each reason an arr gives for a failed import. ' +
          '`Replace` blocklists the release and searches again, `Blocklist` ' +
          'blocklists without searching, `Import` pushes the import through ' +
          'manually, and `Remove` just clears the queue entry.',
        env:
          'JSON array of `{ "id", "enabled", "action" }`, where `action` is ' +
          '`remove`, `blocklist`, `blocklist_search` or `import`. Omitted ' +
          'rules keep their shipped defaults.',
      },
      env: 'ARR_QUEUE_CLEANUP_RULES',
      requiresRestart: false,
      secret: false,
      ui: { kind: 'json', hidden: true },
    },
  },
} as const satisfies RuntimeConfigSection;
