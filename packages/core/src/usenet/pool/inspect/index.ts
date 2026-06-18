/**
 * NZB content inspection: public surface over the inspect phases:
 *   - `gate.ts`       pre-probe release STAT gate (fast-fail dead releases)
 *   - `probe-plan.ts` probe skipping (split-7z, lazy RAR, PAR2 decisions)
 *   - `probe.ts`      per-file first/last-segment probe
 *   - `par2-names.ts` PAR2 descriptor fetch + filename recovery
 *   - `inspect.ts`    the `inspectNzb` orchestrator
 *   - `select.ts`     best-video selection + sample-name policy
 *   - `availability.ts` begin/middle/end STAT sampling of the chosen target
 */
export type { NzbContent, NzbContentFile, InspectOptions } from './types.js';
export { inspectNzb } from './inspect.js';
export {
  isSampleName,
  isEligibleVideoTarget,
  contentTotalSize,
  selectBestVideo,
} from './select.js';
export { sampleTargetAvailability } from './availability.js';
