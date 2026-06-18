import pLimit from 'p-limit';
import { createLogger } from '../../../logging/logger.js';
import { MultiProviderPool } from '../multi-provider-pool.js';
import { detectFileType } from '../file-type.js';
import { Nzb, nzbEncodedSize } from '../../nzb/model.js';
import { NzbContent, NzbContentFile } from './types.js';
import { samplePointIndices } from './availability.js';

const logger = createLogger('usenet/inspect');

/**
 * Release STAT gate: before any BODY probe, STAT a small release-wide sample,
 * anchoring at the first/last files plus an even spread across all segments,
 * and cancelling on the first definitive miss. A dead/partial release is
 * detected in one parallel STAT round instead of after megabytes of probes.
 * The gate alone never fails an import: a confirmed-missing MAIN VIDEO fails
 * fast (the probes could only re-prove it), anything else just records
 * {@link NzbContent.gateMiss} and falls through to the full probe pass, which
 * maps the damage per file.
 */
const GATE_ANCHOR_FILES = 3;
const GATE_TAIL_ANCHOR_FILES = 2;
const GATE_MIN_STATS = 8;
const GATE_MAX_STATS = 48;
/** Extra STATs to confirm a suspected-dead main video before failing fast. */
const GATE_CONFIRM_STATS = 4;
/** Encoded-size share above which a video file counts as the main feature. */
const GATE_MAIN_VIDEO_SHARE = 0.2;
/**
 * The gate is best-effort: whatever hasn't STAT'd by this deadline counts as
 * present and the import proceeds. Without it, one slow cold-pool dial holds
 * the whole sample hostage.
 */
const GATE_TIMEOUT_MS = 4_000;
/** Gate STAT parallelism cap: keeps the cold-pool dial herd small. */
export const GATE_MAX_CONCURRENCY = 16;

interface GateSegRef {
  messageId: string;
  groups: string[];
  fileIndex: number;
}

/**
 * STAT `refs` in parallel (bounded), cancelling the remainder on the first
 * definitive miss. STAT errors / aborted waits count as "present"; only an
 * all-providers 430 can mark a segment missing, so transient blips never trip
 * the gate.
 */
async function statSample(
  pool: MultiProviderPool,
  refs: GateSegRef[],
  concurrency: number,
  signal?: AbortSignal,
  timeoutMs?: number,
  nzbHash?: string
): Promise<{ sampled: number; missing?: GateSegRef }> {
  if (refs.length === 0) return { sampled: 0 };
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  // Best-effort deadline: a definitive miss can only be set BEFORE the abort
  // fires, so expiry just means "everything still pending counts as present".
  let deadline: NodeJS.Timeout | undefined;
  if (timeoutMs && timeoutMs > 0) {
    deadline = setTimeout(() => ac.abort(), timeoutMs);
    deadline.unref?.();
  }
  const limit = pLimit(Math.max(1, concurrency));
  let missing: GateSegRef | undefined;
  await Promise.all(
    refs.map((ref) =>
      limit(async () => {
        if (ac.signal.aborted) return;
        const ok = await pool
          .statSegment(ref.messageId, ref.groups, ac.signal, nzbHash)
          .catch(() => true);
        if (!ok && !missing && !ac.signal.aborted) {
          missing = ref;
          ac.abort();
        }
      })
    )
  );
  if (deadline) clearTimeout(deadline);
  if (signal) signal.removeEventListener('abort', onAbort);
  return { sampled: refs.length, missing };
}

/**
 * Pick the gate's sample: first segments of the leading/trailing files
 * (whole-release DMCA + truncation anchors) plus an even spread over the
 * global segment space, deduped by message-id and capped.
 */
function pickGateSample(nzb: Nzb): GateSegRef[] {
  const out: GateSegRef[] = [];
  const seen = new Set<string>();
  const add = (fileIndex: number, segIndex: number): void => {
    const f = nzb.files[fileIndex];
    const seg = f?.segments[segIndex];
    if (!seg?.messageId || seen.has(seg.messageId)) return;
    seen.add(seg.messageId);
    out.push({ messageId: seg.messageId, groups: f.groups, fileIndex });
  };

  const n = nzb.files.length;
  for (let i = 0; i < Math.min(GATE_ANCHOR_FILES, n); i++) add(i, 0);
  for (let i = Math.max(0, n - GATE_TAIL_ANCHOR_FILES); i < n; i++) add(i, 0);

  // Even spread across the flattened segment space, located via prefix sums.
  const prefix: number[] = new Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    prefix[i] = total;
    total += nzb.files[i].segments.length;
  }
  // Scale with release size (~1 STAT per 10k segments), bounded.
  const target = Math.min(
    GATE_MAX_STATS,
    Math.max(GATE_MIN_STATS, Math.round(total / 10_000))
  );
  for (const g of samplePointIndices(total, Math.max(0, target - out.length))) {
    // Binary search the owning file.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (prefix[mid] <= g) lo = mid;
      else hi = mid - 1;
    }
    add(lo, g - prefix[lo]);
  }
  return out;
}

/**
 * Run the release STAT gate. Returns `failFast` (a fully-formed fail verdict)
 * when a confirmed-missing main video makes probing pointless; otherwise
 * `gateMiss` records whether a non-fatal miss was found (which disables
 * evidence-reducing probe skips downstream).
 */
export async function runReleaseGate(
  nzb: Nzb,
  pool: MultiProviderPool,
  concurrency: number,
  startedAt: number,
  signal?: AbortSignal
): Promise<{ gateMiss: boolean; failFast?: NzbContent }> {
  const gate = await statSample(
    pool,
    pickGateSample(nzb),
    Math.min(concurrency, GATE_MAX_CONCURRENCY),
    signal,
    GATE_TIMEOUT_MS,
    nzb.hash
  );
  if (!gate.missing) return { gateMiss: false };

  const owner = nzb.files[gate.missing.fileIndex];
  const ownerType = detectFileType(Buffer.alloc(0), owner?.filename);
  const share = owner
    ? owner.encodedSize / Math.max(1, nzbEncodedSize(nzb))
    : 0;
  logger.debug(
    {
      nzbHash: nzb.hash,
      sampled: gate.sampled,
      messageId: gate.missing.messageId,
      file: owner?.filename,
      category: ownerType.category,
      share: Number(share.toFixed(3)),
      latency: Date.now() - startedAt,
    },
    'release gate found a missing segment'
  );
  // A missing MAIN VIDEO is the one case probes could only re-prove:
  // confirm with a few spread STATs on that file and fail fast. A missing
  // archive volume may doom only one episode of a pack, and a sidecar
  // dooms nothing: those fall through to the full probe pass.
  if (ownerType.category === 'video' && share >= GATE_MAIN_VIDEO_SHARE) {
    const idxs = samplePointIndices(owner.segments.length, GATE_CONFIRM_STATS);
    const confirm = await statSample(
      pool,
      idxs.map((s) => ({
        messageId: owner.segments[s].messageId,
        groups: owner.groups,
        fileIndex: gate.missing!.fileIndex,
      })),
      Math.min(concurrency, GATE_MAX_CONCURRENCY),
      signal,
      GATE_TIMEOUT_MS,
      nzb.hash
    );
    if (confirm.missing) {
      const files: NzbContentFile[] = nzb.files.map((f, index) => {
        const type = detectFileType(Buffer.alloc(0), f.filename);
        return {
          index,
          filename: f.filename,
          size: f.encodedSize,
          sizeExact: false,
          category: type.category,
          format: type.format,
          streamable: false,
          error:
            index === gate.missing!.fileIndex
              ? ('article_not_found' as const)
              : undefined,
        };
      });
      logger.debug(
        {
          nzbHash: nzb.hash,
          file: owner.filename,
          sampled: gate.sampled + confirm.sampled,
          latency: Date.now() - startedAt,
        },
        'release gate: main video missing on all providers; failing fast'
      );
      return {
        gateMiss: true,
        failFast: {
          files,
          streamable: false,
          availability: {
            sampled: gate.sampled + confirm.sampled,
            missing: 2,
          },
        },
      };
    }
  }
  return { gateMiss: true };
}
