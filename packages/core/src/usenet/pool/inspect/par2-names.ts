import pLimit from 'p-limit';
import { createLogger } from '../../../logging/logger.js';
import { MultiProviderPool } from '../multi-provider-pool.js';
import { detectFileType } from '../file-type.js';
import {
  decodePar2,
  par2Md5_16k,
  PAR2_HASH_BLOCK,
  type Par2Index,
} from '../../par2/decode.js';
import { Nzb, NzbFile } from '../../nzb/model.js';
import { CommandPriority } from '../../types.js';
import { InspectOptions, InspectResult } from './types.js';

const logger = createLogger('usenet/inspect');

/** Fetch a whole (small) NZB file: segments in parallel, assembled in order. */
export async function fetchFileBytes(
  file: NzbFile,
  pool: MultiProviderPool,
  nzbHash: string,
  signal: AbortSignal | undefined
): Promise<Buffer> {
  const limit = pLimit(8);
  const parts = await Promise.all(
    file.segments.map((seg) =>
      limit(() =>
        pool.fetchSegment(
          seg,
          file.groups,
          nzbHash,
          signal,
          CommandPriority.Low
        )
      )
    )
  );
  return Buffer.concat(parts.map((d) => d.body));
}

/**
 * Fetch + decode the smallest PAR2 file (identified by name) into a descriptor
 * index. Best-effort: undefined on any failure. Used ahead of probing by the
 * chase (exact volume sizes by NAME), and reused by {@link applyPar2Names}.
 */
export async function prefetchPar2Index(
  nzb: Nzb,
  pool: MultiProviderPool,
  signal: AbortSignal | undefined
): Promise<Par2Index | undefined> {
  const par2 = nzb.files
    .filter((f) => /\.par2$/i.test(f.filename ?? '') && f.segments.length > 0)
    .sort((a, b) => a.encodedSize - b.encodedSize)[0];
  if (!par2) return undefined;
  const startedAt = Date.now();
  try {
    const bytes = await fetchFileBytes(par2, pool, nzb.hash, signal);
    const index = decodePar2(bytes);
    logger.debug(
      {
        nzbHash: nzb.hash,
        par2File: par2.filename,
        par2Bytes: bytes.length,
        descriptors: index.files.length,
        latency: Date.now() - startedAt,
      },
      'prefetched par2 index'
    );
    return index.files.length > 0 ? index : undefined;
  } catch (err) {
    logger.debug(
      { nzbHash: nzb.hash, err: (err as Error).message },
      'par2 prefetch failed'
    );
    return undefined;
  }
}

/**
 * Recover real filenames for obfuscated files via the smallest PAR2 file's
 * FileDescription packets (md5-of-first-16k → name), then reclassify renamed
 * files. Best-effort: any failure leaves the original names untouched.
 */
export async function applyPar2Names(
  nzb: Nzb,
  pool: MultiProviderPool,
  results: InspectResult[],
  opts: InspectOptions,
  prefetched?: Par2Index
): Promise<void> {
  const par2 = results
    .filter((r) => r.file.category === 'par2')
    .map((r) => ({ result: r, file: nzb.files[r.file.index] }))
    .filter((p) => p.file && p.file.segments.length > 0)
    .sort((a, b) => a.file.encodedSize - b.file.encodedSize)[0];
  if (!prefetched && !par2) {
    logger.debug(
      { nzbHash: nzb.hash },
      'no par2 file present; skipping filename recovery'
    );
    return;
  }

  const startedAt = Date.now();
  try {
    const index =
      prefetched ??
      decodePar2(await fetchFileBytes(par2!.file, pool, nzb.hash, opts.signal));
    if (!prefetched) {
      logger.debug(
        {
          nzbHash: nzb.hash,
          par2File: par2!.file.filename,
          descriptors: index.files.length,
        },
        'decoded par2 index'
      );
    }
    if (index.byMd5_16k.size === 0) return;

    let renamed = 0;
    for (const r of results) {
      if (!r.head || r.file.error) continue;
      // Heads are PROBE_HEAD_BYTES wide; the par2 hash covers exactly 16KB.
      const desc = index.byMd5_16k.get(
        par2Md5_16k(r.head.subarray(0, PAR2_HASH_BLOCK))
      );
      if (!desc) continue;
      r.file.filename = desc.filename;
      const type = detectFileType(r.head, desc.filename);
      r.file.category = type.category;
      r.file.format = type.format;
      r.file.streamable = type.streamable;
      if (desc.length > 0) {
        // PAR2 FileDescription records the real file length (exact).
        r.file.size = desc.length;
        r.file.sizeExact = true;
      }
      renamed++;
    }
    logger.debug(
      { nzbHash: nzb.hash, renamed, latency: Date.now() - startedAt },
      'applied par2 filenames'
    );
  } catch (err) {
    logger.debug(
      { nzbHash: nzb.hash, err: (err as Error).message },
      'par2 filename recovery failed'
    );
  }
}
