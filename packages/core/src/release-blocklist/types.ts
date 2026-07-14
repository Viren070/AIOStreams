/** Which transport a release key identifies. */
export type ReleaseKeyKind = 'torrent' | 'usenet';

export type BlocklistVerdict = 'dead' | 'defective' | 'fake' | 'mislabeled';

export const BLOCKLIST_VERDICTS: readonly BlocklistVerdict[] = [
  'dead',
  'defective',
  'fake',
  'mislabeled',
];

export function isBlocklistVerdict(value: string): value is BlocklistVerdict {
  return (BLOCKLIST_VERDICTS as readonly string[]).includes(value);
}

/**
 * All verdicts filter identically; severity only picks the displayed label
 * when sources disagree about the same release.
 */
const VERDICT_SEVERITY: Record<BlocklistVerdict, number> = {
  fake: 4,
  mislabeled: 3,
  dead: 2,
  defective: 1,
};

export function moreSevereVerdict(
  a: BlocklistVerdict,
  b: BlocklistVerdict
): BlocklistVerdict {
  return VERDICT_SEVERITY[a] >= VERDICT_SEVERITY[b] ? a : b;
}

/**
 * How far a source's verdicts are believed:
 * - `full` filters on its own
 * - `corroborate` filters once at least `quorum` corroborate sources agree
 * - `observe` never filters
 */
export type BlocklistTrust = 'full' | 'corroborate' | 'observe';

export const BLOCKLIST_TRUSTS: readonly BlocklistTrust[] = [
  'full',
  'corroborate',
  'observe',
];

export type BlocklistSourceKind = 'local' | 'remote' | 'imported';

/** Fixed id of the always-present source that holds this instance's own verdicts. */
export const LOCAL_SOURCE_ID = 'local';

/** Cap on a verdict's observation count, bounding storage and merge maths. */
export const N_CAP = 1_000_000_000;

/** How shared verdicts are scoped against this instance's usenet backbones. */
export type BackboneGateMode = 'off' | 'overlap' | 'covers';

export const BACKBONE_GATE_MODES: readonly BackboneGateMode[] = [
  'off',
  'overlap',
  'covers',
];

/**
 * How verdict hosts are canonicalized before scope comparison: `backbone`
 * collapses resellers of the same backbone into one group, `domain` keeps
 * each provider domain distinct.
 */
export type BackboneGrouping = 'backbone' | 'domain';

export const BACKBONE_GROUPINGS: readonly BackboneGrouping[] = [
  'backbone',
  'domain',
];

/** One stored verdict for one release, from one source. */
export interface BlocklistEntry {
  key: string;
  kind: ReleaseKeyKind;
  verdict: BlocklistVerdict;
  /** Times this verdict has been observed. */
  n: number;
  /** Last observation, unix seconds. */
  lastAt: number;
  /** Backbone root domains that observed it; empty means it applies everywhere. */
  backbones: string[];
}

/** One line of the NDJSON interchange format. */
export interface BlocklistRecord {
  /** Release key. */
  k: string;
  v: BlocklistVerdict;
  /** Observation count. */
  n: number;
  /** Last observation, unix seconds. */
  at: number;
  /** Backbone root domains. */
  bk?: string[];
}

export interface BlocklistSource {
  id: string;
  kind: BlocklistSourceKind;
  name: string;
  url: string | null;
  enabled: boolean;
  trust: BlocklistTrust;
  refreshSeconds: number;
  etag: string | null;
  /** Unix seconds of the last refresh attempt. */
  lastChecked: number;
  /** Unix seconds of the last successful content change. */
  lastUpdated: number;
  status: string | null;
  sort: number;
  /** Entries contributed by this source. */
  count: number;
}

export interface BlocklistEvalOptions {
  /** Distinct corroborate sources required before their shared verdict filters. */
  quorum: number;
  gateMode: BackboneGateMode;
  grouping: BackboneGrouping;
  /** This instance's backbone root domains. */
  myBackbones: string[];
  /** Extra backbones honoured under scope even though they are not mine. */
  trustedBackbones: string[];
}

/** Outcome of evaluating one release key against all enabled sources. */
export interface BlocklistEvalResult {
  filtered: boolean;
  verdict: BlocklistVerdict | null;
  /** Short human-readable reason, e.g. "dead (3 sources)". */
  reason: string | null;
}
