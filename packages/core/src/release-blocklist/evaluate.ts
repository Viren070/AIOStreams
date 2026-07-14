import {
  KNOWN_BACKBONES,
  cleanHost,
  normalizeBackbone,
} from './backbone-map.js';
import type {
  BackboneGrouping,
  BlocklistEvalOptions,
  BlocklistEvalResult,
  BlocklistTrust,
  BlocklistVerdict,
} from './types.js';
import { moreSevereVerdict } from './types.js';

/** One source's verdict on a single release, as fed to the evaluator. */
export interface SourceVerdictRow {
  sourceId: string;
  /** Local rows are exempt from backbone gating. */
  isLocal: boolean;
  trust: BlocklistTrust;
  verdict: BlocklistVerdict;
  backbones: string[];
}

function normalizeSet(
  hosts: readonly string[],
  grouping: BackboneGrouping
): Set<string> {
  const set = new Set<string>();
  for (const host of hosts) {
    const normalized = normalizeBackbone(host, grouping);
    if (normalized !== 'unknown') set.add(normalized);
  }
  return set;
}

/**
 * Like `normalizeSet`, but under domain grouping a backbone id expands to
 * its known member hosts, so trusting e.g. `omicron` keeps working there.
 */
function normalizeTrustedSet(
  values: readonly string[],
  grouping: BackboneGrouping
): Set<string> {
  if (grouping !== 'domain') return normalizeSet(values, grouping);
  const set = new Set<string>();
  for (const value of values) {
    const members = KNOWN_BACKBONES[cleanHost(value)];
    for (const host of members ?? [value]) {
      const normalized = normalizeBackbone(host, grouping);
      if (normalized !== 'unknown') set.add(normalized);
    }
  }
  return set;
}

/**
 * Whether a shared verdict's backbone scope applies to this instance.
 * A row with no known backbones applies everywhere. Otherwise:
 * - `overlap`: at least one of its backbones is mine or explicitly trusted
 * - `covers`: its backbones include every one of mine, so its "missing on
 *   all my providers" claim covers this instance's whole provider set
 */
function inScope(
  rowBackbones: readonly string[],
  myRoots: ReadonlySet<string>,
  trustedRoots: ReadonlySet<string>,
  mode: 'overlap' | 'covers',
  grouping: BackboneGrouping
): boolean {
  const known = normalizeSet(rowBackbones, grouping);
  if (known.size === 0) return true;

  for (const backbone of known) {
    if (trustedRoots.has(backbone)) return true;
  }
  if (mode === 'overlap') {
    for (const backbone of known) {
      if (myRoots.has(backbone)) return true;
    }
    return false;
  }
  for (const mine of myRoots) {
    if (!known.has(mine)) return false;
  }
  return true;
}

/**
 * Reduce one release's per-source verdicts to a filter decision:
 * - `observe` rows never filter
 * - a `full` row filters on its own
 * - `corroborate` rows filter once at least `quorum` distinct sources agree
 * - non-local rows must pass the backbone gate when it is active
 *
 * Gating is inactive when the mode is `off` or this instance has no known
 * backbones.
 */
export function evaluateSourceVerdicts(
  rows: readonly SourceVerdictRow[],
  opts: BlocklistEvalOptions
): BlocklistEvalResult {
  const quorum = Math.max(1, opts.quorum);
  const myRoots =
    opts.gateMode === 'off'
      ? new Set<string>()
      : normalizeSet(opts.myBackbones, opts.grouping);
  const gateActive = opts.gateMode !== 'off' && myRoots.size > 0;
  const trustedRoots = normalizeTrustedSet(
    opts.trustedBackbones,
    opts.grouping
  );

  const corroborating = new Set<string>();
  let fullVerdict: BlocklistVerdict | null = null;
  let corroborateVerdict: BlocklistVerdict | null = null;

  for (const row of rows) {
    if (row.trust === 'observe') continue;
    if (
      gateActive &&
      !row.isLocal &&
      !inScope(
        row.backbones,
        myRoots,
        trustedRoots,
        opts.gateMode as 'overlap' | 'covers',
        opts.grouping
      )
    ) {
      continue;
    }
    if (row.trust === 'full') {
      fullVerdict = fullVerdict
        ? moreSevereVerdict(fullVerdict, row.verdict)
        : row.verdict;
    } else {
      corroborating.add(row.sourceId);
      corroborateVerdict = corroborateVerdict
        ? moreSevereVerdict(corroborateVerdict, row.verdict)
        : row.verdict;
    }
  }

  const quorumMet = corroborating.size >= quorum;
  let verdict = fullVerdict;
  if (quorumMet && corroborateVerdict) {
    verdict = verdict
      ? moreSevereVerdict(verdict, corroborateVerdict)
      : corroborateVerdict;
  }
  if (!verdict) {
    return { filtered: false, verdict: null, reason: null };
  }
  const reason = fullVerdict
    ? verdict
    : `${verdict} (${corroborating.size} sources)`;
  return { filtered: true, verdict, reason };
}
