import { createLogger } from '../../../logging/logger.js';
import { MultiProviderPool } from '../multi-provider-pool.js';
import { detectFileType } from '../file-type.js';
import {
  ArticleNotFoundError,
  isProviderUnavailableError,
} from '../../nntp/errors.js';
import { YencDecodeError } from '../yenc.js';
import { NzbFile } from '../../nzb/model.js';
import { isProbablyObfuscated } from '../../nzb/obfuscation.js';
import { CommandPriority } from '../../types.js';
import { InspectOptions, InspectResult } from './types.js';

const logger = createLogger('usenet/inspect');

/**
 * Decoded bytes a probe keeps per file. Sized for the deepest magic check
 * (ISO9660's `CD001` descriptor at raw-sector offset 0x9001), with the PAR2
 * 16KB hash block comfortably inside. Everything past this drains on the wire
 * without being decoded, buffered or cached (the probe diet).
 */
export const PROBE_HEAD_BYTES = 40 * 1024;

/**
 * Score a filename candidate: obfuscated names are heavily penalized, names
 * with a recognized type (archive volume, video, par2, subtitle, including
 * obfuscated-stem `.7z.001` style) get a boost, any sane short extension a
 * small one. The base keeps subject > yEnc on ties.
 */
function nameScore(name: string | undefined, base: number): number {
  if (!name) return base - 5000;
  let score = base;
  if (isProbablyObfuscated(name)) score -= 1000;
  if (detectFileType(Buffer.alloc(0), name).category !== 'other') score += 50;
  if (/\.[A-Za-z0-9]{2,4}$/.test(name)) score += 10;
  return score;
}

/**
 * Choose between the NZB subject filename and the yEnc `=ybegin name=` header.
 * Obfuscated releases often keep REAL volume names in the yEnc headers (e.g.
 * subject `be667a...` vs a yEnc name ending `.7z.001`); without this the volumes never
 * group. PAR2 recovery still overrides the winner afterwards.
 */
function pickProbeName(
  subjectName: string | undefined,
  yencName: string | undefined
): string | undefined {
  if (!yencName || yencName === subjectName) return subjectName ?? yencName;
  return nameScore(subjectName, 2) >= nameScore(yencName, 1)
    ? subjectName
    : yencName;
}

/** Probe one file: fetch its first (and optionally last) segment head. */
export async function inspectFile(
  file: NzbFile,
  index: number,
  pool: MultiProviderPool,
  nzbHash: string,
  opts: InspectOptions
): Promise<InspectResult> {
  if (file.segments.length === 0) {
    return {
      file: {
        index,
        filename: file.filename,
        size: 0,
        category: 'other',
        streamable: false,
        error: 'open_failed',
      },
    };
  }

  try {
    const first = await pool.fetchSegmentHead(
      file.segments[0],
      file.groups,
      nzbHash,
      opts.signal,
      CommandPriority.Low,
      PROBE_HEAD_BYTES
    );
    // A part range larger than the article's ENCODED size is a lying header
    // (yEnc encoding only ever grows data; seen on broken posts claiming one
    // part spans the whole file). Take the full-fetch path so the decode error
    // classifies the post honestly instead of poisoning sizes.
    const encodedBytes = file.segments[0].bytes;
    if (
      first.byteRange &&
      encodedBytes > 0 &&
      first.byteRange[1] - first.byteRange[0] > encodedBytes * 1.1 + 4096
    ) {
      await pool.fetchSegment(
        file.segments[0],
        file.groups,
        nzbHash,
        opts.signal,
        CommandPriority.Low
      );
    }

    let size =
      first.fileSize ?? first.byteRange?.[1] ?? first.size ?? file.encodedSize;
    // Exact when the yEnc header carries the total size, or the single
    // segment's part range IS the whole file. Anything else is an estimate.
    let sizeExact =
      first.fileSize !== undefined ||
      (file.segments.length === 1 && first.byteRange !== undefined);

    if (opts.mode === 'full' && file.segments.length > 1) {
      try {
        // Header-only: the exact part range arrives in the leading lines.
        const last = await pool.fetchSegmentHead(
          file.segments[file.segments.length - 1],
          file.groups,
          nzbHash,
          opts.signal,
          CommandPriority.Low,
          0
        );
        if (last.byteRange) {
          size = last.byteRange[1];
          sizeExact = true;
        }
      } catch {
        /* non-fatal: keep first-segment size estimate */
      }
    }

    const filename = pickProbeName(file.filename, first.name);
    const type = detectFileType(first.head, filename);
    return {
      file: {
        index,
        filename,
        size,
        sizeExact,
        category: type.category,
        format: type.format,
        streamable: type.streamable,
      },
      head: first.head,
      headAligned: first.byteRange === undefined || first.byteRange[0] === 0,
    };
  } catch (err) {
    // Our own cancellation (early dead-abort / timeout): a clean skip, not a
    // probe result; don't warn and don't count it as a failure.
    if (opts.signal?.aborted) {
      return {
        file: {
          index,
          filename: file.filename,
          size: file.encodedSize,
          category: 'other',
          streamable: false,
        },
      };
    }
    // A provider/transport problem (connection limit, auth, no usable provider,
    // timeout) means we never actually inspected the content; the article was
    // NOT proven missing. Propagate so the whole inspect fails *retryably* rather
    // than mislabeling this file (which would degrade to "no streamable files"
    // and permanently mark the NZB failed). With the pool's throttle in place,
    // acquires queue under backpressure, so this only fires on real unavailability.
    if (isProviderUnavailableError(err)) {
      throw err;
    }
    const notFound = err instanceof ArticleNotFoundError;
    const decodeFailed = err instanceof YencDecodeError;
    if (!notFound) {
      logger.warn(
        {
          nzbHash,
          index,
          filename: file.filename,
          firstSegment: file.segments[0]?.messageId,
          errName: (err as Error)?.name,
          errKind: (err as { kind?: string })?.kind,
          err: (err as Error)?.message,
        },
        `file inspection failed (${decodeFailed ? 'decode_failed' : 'open_failed'})`
      );
    }
    return {
      file: {
        index,
        filename: file.filename,
        size: file.encodedSize,
        category: 'other',
        streamable: false,
        error: notFound
          ? 'article_not_found'
          : decodeFailed
            ? 'decode_failed'
            : 'open_failed',
      },
    };
  }
}
