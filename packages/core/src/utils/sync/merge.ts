import { parseSyncedUrl, type SyncOverride } from './types.js';

export interface MergeOptions<T, U> {
  urls: string[];
  /** The user's current list, which may hold `<SYNCED: url>` placeholders. */
  existing: U[];
  fetched: Map<string, T[]>;
  overrides: SyncOverride[];
  findOverride: (
    item: T,
    overrides: SyncOverride[]
  ) => SyncOverride | undefined;
  applyOverride: (item: T, override: SyncOverride) => T;
  transform: (item: T) => U;
  getField: (item: U) => string;
}

/**
 * Splice synced items into a user's list. A `<SYNCED: url>` placeholder resolves
 * where it sits, a URL without one is appended, and a placeholder naming a URL
 * the caller may not use is dropped.
 */
export function mergeSynced<T, U>(opts: MergeOptions<T, U>): U[] {
  const { urls, existing, fetched, overrides } = opts;

  if (urls.length === 0) {
    const cleaned = existing.filter(
      (item) => !parseSyncedUrl(opts.getField(item))
    );
    return cleaned.length === existing.length ? existing : cleaned;
  }

  const usable = new Set(urls);
  const result: U[] = [];
  const resolvedInline = new Set<string>();

  const push = (items: T[]) => {
    for (const item of items) {
      const override = overrides.length
        ? opts.findOverride(item, overrides)
        : undefined;
      if (override?.disabled) continue;
      result.push(
        opts.transform(override ? opts.applyOverride(item, override) : item)
      );
    }
  };

  for (const item of existing) {
    const placeholder = parseSyncedUrl(opts.getField(item));
    if (placeholder) {
      if (usable.has(placeholder)) {
        resolvedInline.add(placeholder);
        push(fetched.get(placeholder) ?? []);
      }
      continue;
    }
    result.push(item);
  }

  for (const url of urls) {
    if (resolvedInline.has(url)) continue;
    push(fetched.get(url) ?? []);
  }

  return result;
}
