import { UsenetLibraryRepository } from '../../db/index.js';
import { appConfig } from '../../utils/index.js';
import type { ArrInstance } from '../../arr/types.js';

/** SABnzbd's own presets, in its order, plus the two arr defaults. */
const PRESET_CATEGORIES = [
  '*',
  'movies',
  'tv',
  'audio',
  'software',
  'sonarr',
  'radarr',
];

/**
 * Every category the SABnzbd API advertises: the presets, what enabled arr
 * instances claim, and anything a job was ever assigned. An arr refuses a
 * download client whose category is missing here, and stats the folder the
 * category names, so `completed/` exposes one per entry. Raw names; the
 * folder is `sanitizeShareName(name)`.
 */
export async function advertisedCategories(): Promise<string[]> {
  const instances = (appConfig.arr.instances ?? []) as ArrInstance[];
  const claimed = instances
    .filter((i) => i.enabled !== false)
    .flatMap((i) => i.categories ?? []);
  const assigned = (await UsenetLibraryRepository.distinctCategories()).sort();
  const names = new Set<string>();
  for (const name of [...PRESET_CATEGORIES, ...claimed, ...assigned]) {
    const trimmed = name.trim();
    if (trimmed) names.add(trimmed);
  }
  return [...names];
}
