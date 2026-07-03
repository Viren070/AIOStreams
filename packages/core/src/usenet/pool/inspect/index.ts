/**
 * NZB content inspection: public surface over the inspect phases:
 *   - `census.ts`     full-release STAT census (availability evidence,
 *                     per-provider STAT trust, run densification)
 *   - `probe-plan.ts` probe skipping (split-7z, lazy RAR, PAR2 decisions)
 *   - `probe.ts`      per-file first/last-segment probe
 *   - `par2-names.ts` PAR2 descriptor fetch + filename recovery
 *   - `inspect.ts`    the `inspectNzb` orchestrator
 *   - `select.ts`     best-video selection + sample-name policy
 */
export type { NzbContent, NzbContentFile, InspectOptions } from './types.js';
export { inspectNzb } from './inspect.js';
export {
  isSampleName,
  isEligibleVideoTarget,
  contentTotalSize,
  selectBestVideo,
} from './select.js';
export {
  startCensus,
  samplePointIndices,
  StatTrustCache,
  CENSUS_CONCURRENCY,
} from './census.js';
export type { CensusRun, CensusSnapshot, CensusOptions } from './census.js';
