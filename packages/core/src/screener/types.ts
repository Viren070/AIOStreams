/**
 * Shared Screener shapes. Screener is aiostreams' community-shareable filter of bad
 * releases, keyed by a credential-free release identity (see `key.ts`). The
 * usenet subset is wire-compatible with nzbdavex (see `io.ts`).
 */

/** The class of source a release came from, derived from its key prefix. */
export type ReleaseKind = 'torrent' | 'usenet';

/** What a source says is wrong with a release. */
export type Verdict = 'dead' | 'fake' | 'mislabeled';

export const VERDICTS: readonly Verdict[] = ['dead', 'fake', 'mislabeled'];

/**
 * Severity for merge/display when sources disagree (higher wins). All verdicts
 * filter equally; severity only decides which label a release surfaces under.
 */
const VERDICT_SEVERITY: Record<Verdict, number> = {
  fake: 3,
  dead: 2,
  mislabeled: 1,
};

export function isVerdict(v: string): v is Verdict {
  return (VERDICTS as readonly string[]).includes(v);
}

/** Pick the more severe of two verdicts. */
export function moreSevere(a: Verdict, b: Verdict): Verdict {
  return VERDICT_SEVERITY[a] >= VERDICT_SEVERITY[b] ? a : b;
}

/**
 * How much a source is trusted, mirroring nzbdavex:
 *  - full        filters on its own
 *  - corroborate filters only when >= quorum sources agree
 *  - observe     never filters (kept for visibility only)
 */
export type Trust = 'full' | 'corroborate' | 'observe';

export const TRUSTS: readonly Trust[] = ['full', 'corroborate', 'observe'];

export function normaliseTrust(t: string | null | undefined): Trust {
  const v = t?.trim().toLowerCase();
  return v === 'full' || v === 'observe' ? v : 'corroborate';
}

/** The fixed id of the always-present, auto-filling local source. */
export const LOCAL_SOURCE_ID = 'local';

/** Cap on a verdict's observation count, to bound storage and merges. */
export const N_CAP = 1_000_000_000;

export type SourceKind = 'local' | 'remote' | 'imported';

/** A single stored verdict for one release, from one source. */
export interface ScreenerEntry {
  /** Release key: `btih:<hash>` or `wd1:<fingerprint>`. */
  key: string;
  verdict: Verdict;
  /** Number of times this verdict has been observed. */
  n: number;
  /** Last-seen, unix seconds. */
  lastAt: number;
  /** Usenet backbones / torrent trackers that observed it, for scoping. */
  backbones: string[];
}

/** One line of the native NDJSON interchange format. Compact keys keep it small. */
export interface ScreenerRecord {
  /** key */
  k: string;
  /** verdict */
  v: Verdict;
  /** count */
  n: number;
  /** last-seen unix seconds */
  at: number;
  /** backbones / trackers */
  bk?: string[];
}

/** A configured list a user/operator pulls verdicts from. */
export interface ScreenerSource {
  id: string;
  kind: SourceKind;
  name: string;
  url: string | null;
  enabled: boolean;
  trust: Trust;
  refreshHours: number;
  lastChecked: number;
  lastUpdated: number;
  status: string | null;
  /** Number of entries contributed by this source. */
  count: number;
}

/** Per-request knobs that decide whether a key is filtered. From UserData. */
export interface ScreenerEvalOptions {
  /** Sources must agree this many times before a `corroborate` verdict filters. */
  quorum: number;
  /** Only honour remote/imported verdicts whose backbone matches one of mine. */
  backboneScope: boolean;
  /** My usenet backbones (root domains) / trackers, for backbone scoping. */
  myBackbones: string[];
}

/** The outcome of evaluating one release key against all enabled sources. */
export interface ScreenerVerdict {
  filtered: boolean;
  verdict: Verdict | null;
  /** Short human reason, e.g. "dead (3 sources)". */
  reason: string | null;
}
