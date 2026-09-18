import type {
  UsenetIndexerLastError,
  UsenetIndexerRollup,
} from '../../db/index.js';
import { createLogger } from '../../logging/logger.js';
import { MANUAL_INDEXER_LABEL } from './grab-metrics.js';

const logger = createLogger('usenet/indexer-aliases');

/** Guards against a cycle in a hand-edited map (`A -> B`, `B -> A`). */
const MAX_ALIAS_HOPS = 8;

/** Rule keys match regardless of the casing the grab happened to be recorded under. */
function fold(label: string): string {
  return label.trim().toLowerCase();
}

export interface IndexerAliasIndex {
  /**
   * The label a group is displayed under: the canonical the user typed when a
   * rule matches, else the label exactly as recorded.
   */
  canonicalOf(label: string): string;
  /** True when no rule applies to any label. */
  readonly empty: boolean;
}

/**
 * Follow one rule's chain (`Ds -> DrunkenSlug -> Drunken Slug`) to its end.
 *
 * Returns undefined when the rules contradict — a cycle, or a chain long enough
 * to be a mistake rather than intent. Such a rule is dropped whole rather than
 * applied halfway: a half-applied chain would split one indexer across two rows
 * and, worse, make the eraser expand a merged row to the wrong member set.
 */
function resolveChain(
  startKey: string,
  rules: Map<string, string>
): string | undefined {
  let prevKey = startKey;
  let current = rules.get(startKey)!;
  for (let hop = 0; hop < MAX_ALIAS_HOPS; hop++) {
    const key = fold(current);
    // A rule that only respells its own key (`nzb.life -> Nzb.life`) ends here.
    if (key === prevKey) return current;
    const next = rules.get(key);
    if (next === undefined) return current;
    if (key === startKey) return undefined;
    prevKey = key;
    current = next;
  }
  return undefined;
}

/**
 * Build the lookup used to fold recorded indexer labels into merge groups.
 *
 * Only labels named by a rule are grouped — two spellings that merely differ in
 * case stay separate until a rule says otherwise. Exact no-ops, and rules naming
 * `Manual` (the reserved sentinel for uploads and `local-nzb://`), are dropped.
 */
export function buildIndexerAliasIndex(
  map: Record<string, string> | undefined
): IndexerAliasIndex {
  const rules = new Map<string, string>();
  for (const [variant, canonical] of Object.entries(map ?? {})) {
    const from = fold(variant);
    const to = canonical.trim();
    if (!from || !to) continue;
    // Only an exact no-op is dropped. A rule differing just in case is a
    // respelling — the whole point of merging `nzb.life` into `Nzb.life`.
    if (variant.trim() === to) continue;
    if (
      from === fold(MANUAL_INDEXER_LABEL) ||
      fold(to) === fold(MANUAL_INDEXER_LABEL)
    ) {
      logger.warn(
        { variant, canonical },
        `indexer alias rule touches the reserved "${MANUAL_INDEXER_LABEL}" label; ignored`
      );
      continue;
    }
    rules.set(from, to);
  }

  // Flatten the chains once, so a lookup is a single hit and a contradictory
  // rule set is ignored outright instead of half-applying on every read.
  const resolved = new Map<string, string>();
  for (const key of rules.keys()) {
    const canonical = resolveChain(key, rules);
    if (canonical === undefined) {
      logger.warn(
        { rule: key },
        'indexer alias rule is part of a cycle or too long a chain; ignored'
      );
      continue;
    }
    resolved.set(key, canonical);
  }

  return {
    canonicalOf: (label) => resolved.get(fold(label)) ?? label,
    empty: resolved.size === 0,
  };
}

/** A folded group, plus the recorded spellings it covers. */
export interface FoldedIndexerRollup extends UsenetIndexerRollup {
  /** Every recorded label folded into this row, most grabs first. */
  members: string[];
}

/**
 * Sum the stored counters of every rollup that resolves to the same canonical.
 *
 * Folding happens here — on `UsenetIndexerRollup`, the last shape that still
 * carries `sumGrabMs`/`grabSamples` — so the caller can recompute the means as
 * `sum / samples`. Folding further downstream could only average averages.
 */
export function foldIndexerRollups(
  rows: UsenetIndexerRollup[],
  index: IndexerAliasIndex
): FoldedIndexerRollup[] {
  if (index.empty) return rows.map((r) => ({ ...r, members: [r.indexer] }));

  const groups = new Map<string, FoldedIndexerRollup>();
  const membersOf = new Map<string, UsenetIndexerRollup[]>();
  for (const row of rows) {
    const canonical = index.canonicalOf(row.indexer);
    const existing = groups.get(canonical);
    if (!existing) {
      groups.set(canonical, { ...row, indexer: canonical, members: [] });
      membersOf.set(canonical, [row]);
      continue;
    }
    existing.ok += row.ok;
    existing.degraded += row.degraded;
    existing.failed += row.failed;
    existing.failedMissing += row.failedMissing;
    existing.failedFetch += row.failedFetch;
    existing.fetchAuth += row.fetchAuth;
    existing.fetchLimited += row.fetchLimited;
    existing.sumGrabMs += row.sumGrabMs;
    existing.grabSamples += row.grabSamples;
    existing.sumImportMs += row.sumImportMs;
    existing.importSamples += row.importSamples;
    existing.grabs = existing.ok + existing.degraded + existing.failed;
    membersOf.get(canonical)!.push(row);
  }
  for (const [canonical, group] of groups) {
    group.members = membersOf
      .get(canonical)!
      .sort((a, b) => b.grabs - a.grabs || a.indexer.localeCompare(b.indexer))
      .map((r) => r.indexer);
  }
  return [...groups.values()];
}

/**
 * Collapse the per-label last errors onto their groups, keeping the most recent
 * — `usenet_indexer_last_error` holds one row per recorded label and no history,
 * so a merged group has several candidates and order alone would pick a stale one.
 */
export function foldIndexerErrors(
  errors: UsenetIndexerLastError[],
  index: IndexerAliasIndex
): Map<string, UsenetIndexerLastError> {
  const byGroup = new Map<string, UsenetIndexerLastError>();
  for (const err of errors) {
    const canonical = index.canonicalOf(err.indexer);
    const existing = byGroup.get(canonical);
    if (!existing || err.atMs > existing.atMs) byGroup.set(canonical, err);
  }
  return byGroup;
}
