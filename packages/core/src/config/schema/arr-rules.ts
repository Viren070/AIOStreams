/**
 * The queue-cleanup catalogue: what a stuck Sonarr/Radarr queue item's own
 * status message means, and what to do about it by default.
 *
 * Matchers are ours, not the user's: they track phrases the arrs emit, so a
 * typo in a hand-written pattern cannot silently stop matching. Users choose
 * only whether a rule is on and which action it takes. Phrases are matched
 * case-insensitively against the item's joined status messages, and are kept
 * long enough to be unambiguous: "sample" alone would hit any release with
 * Sample in its name.
 *
 * Order matters: the first match wins. Import rules stay below the
 * already-satisfied ones, since a forced import skips the arr's upgrade checks.
 */
export interface QueueCleanupRuleDef {
  id: string;
  /** Shown in settings next to the action picker. */
  label: string;
  /** Lowercase phrase from the arr's status message. */
  phrase: string;
  action: 'remove' | 'blocklist' | 'blocklist_search' | 'import';
  /** Whether the rule ships turned on. */
  enabled: boolean;
  /** Why this action, for the settings UI. */
  note?: string;
}

export const QUEUE_CLEANUP_RULES: readonly QueueCleanupRuleDef[] = [
  {
    id: 'no_eligible_files',
    label: 'No eligible files',
    phrase: 'no files found are eligible for import',
    action: 'blocklist_search',
    enabled: true,
    note: 'Nothing in the release the arr can use. Replace it.',
  },
  {
    id: 'episodes_missing',
    label: 'Episodes missing from release',
    phrase: 'expected in this release were not imported or missing',
    action: 'blocklist_search',
    enabled: true,
    note: 'A pack that does not contain everything it claimed.',
  },
  {
    id: 'not_found_in_release',
    label: 'Not in the grabbed release',
    phrase: 'was not found in the grabbed release',
    action: 'blocklist_search',
    enabled: true,
    note: 'The file is for a different episode or movie than the one grabbed.',
  },
  {
    id: 'not_a_valid_video',
    label: 'Invalid video file',
    phrase: 'invalid video file',
    action: 'blocklist_search',
    enabled: true,
  },
  {
    id: 'no_audio',
    label: 'No audio tracks',
    phrase: 'no audio tracks detected',
    action: 'blocklist_search',
    enabled: true,
  },
  {
    id: 'found_archive',
    label: 'Archive file found',
    phrase: 'found archive file',
    action: 'blocklist_search',
    enabled: true,
    note: 'The arr will not unpack; the engine serves archives it can stream.',
  },
  {
    id: 'multi_part_movie',
    label: 'Multi-part movie',
    phrase: 'suspected multi-part file',
    action: 'blocklist_search',
    enabled: true,
    note: 'Radarr refuses CD1/CD2 style releases outright.',
  },
  {
    id: 'unable_to_parse',
    label: 'Unable to parse',
    phrase: 'unable to parse',
    action: 'blocklist_search',
    enabled: true,
  },
  {
    id: 'invalid_season_or_episode',
    label: 'Invalid season or episode',
    phrase: 'invalid season or episode',
    action: 'blocklist_search',
    enabled: true,
  },
  {
    id: 'sample',
    label: 'Sample file',
    phrase: 'unable to determine if file is a sample',
    action: 'blocklist_search',
    enabled: true,
  },
  {
    id: 'already_imported',
    label: 'Already imported',
    phrase: 'already imported',
    action: 'remove',
    enabled: true,
    note: 'Nothing wrong with the release; the queue entry is stale.',
  },
  {
    id: 'not_an_upgrade',
    label: 'Not an upgrade',
    phrase: 'upgrade for existing',
    action: 'remove',
    enabled: true,
    note:
      'The arr already has something as good, by quality, revision or ' +
      'custom format score. Do not blocklist.',
  },
  {
    id: 'title_mismatch',
    label: 'Title mismatch',
    phrase: 'title mismatch',
    action: 'import',
    enabled: true,
    note: 'The files are fine, the arr just will not match them itself.',
  },
  {
    id: 'matched_by_id',
    label: 'Matched by ID',
    phrase: 'via grab history, but release was matched to',
    action: 'import',
    enabled: true,
    note: 'The arr matched on ID but wants confirmation before importing.',
  },
  {
    id: 'episode_unexpected',
    label: 'Episode differs from release name',
    phrase: 'unexpected considering the',
    action: 'import',
    enabled: true,
    note:
      'Sonarr reads a different episode from the file name than from the ' +
      'release name and will not decide alone. Import takes the episode it ' +
      'pre-fills itself, the same one Interactive Import would show you.',
  },
  {
    id: 'full_season_file',
    label: 'Single file parsed as a season',
    phrase: 'single episode file contains all episodes',
    action: 'blocklist_search',
    enabled: false,
    note: 'Usually a naming quirk a manual import fixes, so off by default.',
  },
  {
    id: 'invalid_local_path',
    label: 'Invalid local path',
    phrase: 'is not a valid local path',
    action: 'remove',
    enabled: false,
    note:
      'Usually means the mount directory does not match what the arr sees. ' +
      'Off by default: fix the path rather than clearing the queue.',
  },
  {
    id: 'not_enough_space',
    label: 'Not enough free space',
    phrase: 'not enough free space',
    action: 'remove',
    enabled: false,
    note: 'Off by default: free up the disk rather than clearing the queue.',
  },
] as const;

export const QUEUE_CLEANUP_RULE_IDS = QUEUE_CLEANUP_RULES.map((r) => r.id) as [
  string,
  ...string[],
];

/** The shipped table, in the shape the config stores. */
export const DEFAULT_QUEUE_CLEANUP_RULES = QUEUE_CLEANUP_RULES.map((r) => ({
  id: r.id,
  enabled: r.enabled,
  action: r.action,
}));
