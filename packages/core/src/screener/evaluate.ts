import type {
  Trust,
  Verdict,
  ScreenerEvalOptions,
  ScreenerVerdict,
} from './types.js';
import { moreSevere } from './types.js';

/** One source's verdict on a single release, as fed to the evaluator. */
export interface SourceVerdict {
  /** True for the always-on local source (exempt from backbone scoping). */
  isLocal: boolean;
  trust: Trust;
  verdict: Verdict;
  /** Backbones / trackers that observed this verdict (for scoping). */
  backbones: string[];
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/**
 * Collapse a host to its registrable root domain, e.g. `news.example.com` ->
 * `example.com`, `a.b.co.uk` -> `b.co.uk`. Bare IPs pass through. Ported from
 * nzbdavex's `WardenFingerprint.RootDomain` so backbone scoping agrees with it.
 */
export function rootDomain(host: string | null | undefined): string {
  if (!host) return 'unknown';
  let h = host.trim().toLowerCase();
  // IPv6 literal: bracketed `[2001:db8::1]:563` or bare `2001:db8::1`. Keep the
  // whole address; the first-colon port split below would otherwise truncate it.
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 1 ? h.slice(1, end) : 'unknown';
  }
  if ((h.match(/:/g)?.length ?? 0) >= 2) return h;
  const colon = h.indexOf(':');
  if (colon > 0) h = h.slice(0, colon);
  h = h.replace(/^\.+|\.+$/g, '');
  if (h.length === 0) return 'unknown';
  if (IPV4.test(h)) return h;

  const labels = h.split('.').filter(Boolean);
  if (labels.length <= 2) return h;
  // A 2-char TLD with a short second level (e.g. co.uk, com.au) keeps 3 labels.
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  const take = tld.length === 2 && sld.length <= 3 ? 3 : 2;
  return labels.slice(labels.length - take).join('.');
}

/**
 * True if an entry applies to one of my backbones. Mirrors davex's
 * BackboneInScope: an entry with no *known* backbones (empty, or all
 * unparseable) applies everywhere; otherwise one of its backbones must overlap
 * mine.
 */
function backboneInScope(
  backbones: readonly string[],
  myRoots: ReadonlySet<string>
): boolean {
  let known = false;
  for (const b of backbones) {
    const rb = rootDomain(b);
    if (rb === 'unknown') continue;
    known = true;
    if (myRoots.has(rb)) return true;
  }
  return !known;
}

/**
 * True if any of an entry's backbones is explicitly trusted, so a verdict from a
 * backbone that isn't mine (e.g. a same-backbone reseller I opted into) still
 * counts under scope. Empty trust set never matches.
 */
function backboneTrusted(
  backbones: readonly string[],
  trustedRoots: ReadonlySet<string>
): boolean {
  if (trustedRoots.size === 0) return false;
  for (const b of backbones) {
    const rb = rootDomain(b);
    if (rb !== 'unknown' && trustedRoots.has(rb)) return true;
  }
  return false;
}

/**
 * Reduce one release's per-source verdicts to a filter decision. Mirrors
 * nzbdavex's trust + quorum + backbone-scope rules:
 *  - `observe` sources never filter (kept for visibility only).
 *  - a `full` source filters on its own.
 *  - `corroborate` sources filter only once >= quorum of them agree.
 *  - with backbone scope on (and at least one known local backbone), a
 *    non-local source's verdict only counts when its backbones intersect mine,
 *    or it records none.
 *
 * Callers should pass only rows from enabled sources; `observe` is tolerated
 * here so the rule lives in one place.
 */
export function evaluateKey(
  rows: readonly SourceVerdict[],
  opts: ScreenerEvalOptions
): ScreenerVerdict {
  const quorum = Math.max(1, opts.quorum);
  const myRoots = opts.backboneScope
    ? new Set(
        opts.myBackbones.map(rootDomain).filter((b) => b !== 'unknown')
      )
    : new Set<string>();
  const scope = myRoots.size > 0;
  const trustedRoots = new Set(
    (opts.trustedBackbones ?? []).map(rootDomain).filter((b) => b !== 'unknown')
  );

  let agree = 0;
  let fullSource = false;
  let fullVerdict: Verdict | null = null;
  let corroborateVerdict: Verdict | null = null;

  for (const row of rows) {
    if (row.trust === 'observe') continue;
    if (
      scope &&
      !row.isLocal &&
      !backboneInScope(row.backbones, myRoots) &&
      !backboneTrusted(row.backbones, trustedRoots)
    ) {
      continue;
    }
    if (row.trust === 'full') {
      fullSource = true;
      fullVerdict = fullVerdict
        ? moreSevere(fullVerdict, row.verdict)
        : row.verdict;
    } else {
      agree++;
      corroborateVerdict = corroborateVerdict
        ? moreSevere(corroborateVerdict, row.verdict)
        : row.verdict;
    }
  }

  const quorumMet = agree >= quorum;
  const filtered = fullSource || quorumMet;
  // Full sources always set the verdict; corroborate sources only contribute
  // once they meet quorum, so a lone corroborator can't upgrade a verdict.
  let verdict: Verdict | null = fullVerdict;
  if (quorumMet && corroborateVerdict) {
    verdict = verdict ? moreSevere(verdict, corroborateVerdict) : corroborateVerdict;
  }
  if (!filtered || !verdict) {
    return { filtered: false, verdict: null, reason: null };
  }
  const reason = fullSource ? verdict : `${verdict} (${agree} sources)`;
  return { filtered: true, verdict, reason };
}
