import { ArticleNotFoundError } from '../../../nntp/errors.js';
import { ArchiveKind } from '../archive-volume.js';
import { VolumeSet, Volume } from '../usenet-fs.js';
import { ArchiveEntry } from '../types.js';
import { RarReader, RarVolumeError } from '../rar/index.js';
import { RarEncryptedError, RarBadPasswordError } from '../crypto/rar-kdf.js';
import { parse7z } from '../sevenzip/parse.js';
import { FileOpener } from './layout.js';

/** Default open/parse concurrency when the caller doesn't specify one. */
export const DEFAULT_OPEN_CONCURRENCY = 8;

/** Options for the archive header parse (RAR per-volume walk). */
export interface ParseEntriesOptions {
  /** Per-volume parallelism for the RAR header walk. */
  concurrency?: number;
  /** Probed decoded heads, index-aligned with the set's volumes. */
  heads?: (Buffer | undefined)[];
  /**
   * The set is a raw numeric-split concatenation, not per-volume archives:
   * parse it as ONE byte stream (single range) instead of per-volume ranges.
   */
  joined?: boolean;
  /** Lazy mode (exact sizes, sparse heads); see RarParseOptions.lazy. */
  lazy?: boolean;
  signal?: AbortSignal;
}

/** Parse an opened archive (RAR or 7z) into its inner-file listing. */
export async function parseArchiveEntries(
  vs: VolumeSet,
  kind: ArchiveKind,
  password = '',
  opts: ParseEntriesOptions = {}
): Promise<{ entries: ArchiveEntry[]; volumeErrors: RarVolumeError[] }> {
  if (kind === '7z') {
    return { entries: await parse7z(vs, password), volumeErrors: [] };
  }
  const reader = new RarReader(vs, opts.joined ? undefined : vs.volumeRanges());
  const entries = await reader.parse({
    concurrency: opts.concurrency,
    heads: opts.heads,
    lazy: opts.lazy,
    password,
    signal: opts.signal,
  });
  return { entries, volumeErrors: reader.volumeErrors };
}

/** Whether an archive-parse failure means "articles gone", incl. cause chain. */
export function isArticleNotFound(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause as Error | undefined) {
    if (e instanceof ArticleNotFoundError) return true;
  }
  return false;
}

/** Classify a RAR5 header-encryption failure from a parse error, if any. */
export function cryptFailure(
  err: unknown
): 'encrypted' | 'bad_password' | undefined {
  for (let e = err; e instanceof Error; e = e.cause as Error | undefined) {
    if (e instanceof RarBadPasswordError) return 'bad_password';
    if (e instanceof RarEncryptedError) return 'encrypted';
  }
  return undefined;
}

/** Open a set's member volumes as one concatenated {@link VolumeSet}. */
export async function openVolumeSet(
  set: { kind: ArchiveKind; memberIndices: number[] },
  opener: FileOpener,
  knownSizes?: (number | undefined)[],
  concurrency = DEFAULT_OPEN_CONCURRENCY
): Promise<VolumeSet> {
  const volumes: Volume[] = set.memberIndices.map((index, i) => ({
    filename: `vol-${index}`,
    open: (knownSize, memo) => opener(index, knownSize, memo),
    knownSize: knownSizes?.[i],
  }));
  const vs = new VolumeSet(volumes);
  await vs.open(concurrency);
  return vs;
}
