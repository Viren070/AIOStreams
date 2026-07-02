import { createHash } from 'node:crypto';

/**
 * A single article/segment of an NZB file. `messageId` is stored WITHOUT the
 * surrounding angle brackets (`<>`); add them when issuing NNTP commands.
 */
export interface NzbSegment {
  /** 1-based part number as declared in the NZB. */
  number: number;
  /** Declared on-the-wire byte size of the (yEnc-encoded) article. */
  bytes: number;
  /** Message-ID without angle brackets. */
  messageId: string;
}

/**
 * A logical file within an NZB, reconstructed from one or more segments.
 */
export interface NzbFile {
  /** Raw `subject` attribute from the NZB. */
  subject: string;
  /** Poster (`poster` attribute), if present. */
  poster?: string;
  /** Unix epoch seconds (`date` attribute), if present. */
  date?: number;
  /** Newsgroups this file was posted to. */
  groups: string[];
  /** Segments ordered by `number` ascending. */
  segments: NzbSegment[];
  /** Best-effort filename parsed from the subject. */
  filename?: string;
  /** Sum of declared segment byte sizes (encoded size, not decoded). */
  encodedSize: number;
}

export interface Nzb {
  files: NzbFile[];
  /** Optional `<head><meta>` values keyed by their `type` attribute. */
  meta: Record<string, string>;
  /**
   * Stable content hash derived from the sorted set of all segment message
   * IDs. Identifies "the same content" across re-posts of the same NZB and is
   * used for caching, stats, and known-dead persistence.
   */
  hash: string;
}

/** Total declared (encoded) size across all files. */
export function nzbEncodedSize(nzb: Nzb): number {
  return nzb.files.reduce((acc, f) => acc + f.encodedSize, 0);
}

/**
 * Compute a stable content hash for an NZB from the sorted, de-duplicated set
 * of segment message IDs. This is independent of file/segment ordering so the
 * same physical posting always hashes identically.
 */
export function computeNzbHash(files: NzbFile[]): string {
  const ids: string[] = [];
  for (const file of files) {
    for (const seg of file.segments) {
      if (seg.messageId) ids.push(seg.messageId);
    }
  }
  ids.sort();
  // Chunked joins must feed the hash the exact "<id>\n" byte stream that
  // per-id updates would; existing hashes depend on it.
  const hash = createHash('sha1');
  const chunk: string[] = [];
  let prev: string | undefined;
  for (const id of ids) {
    if (id === prev) continue;
    prev = id;
    chunk.push(id);
    if (chunk.length === 4096) {
      hash.update(chunk.join('\n') + '\n');
      chunk.length = 0;
    }
  }
  if (chunk.length) hash.update(chunk.join('\n') + '\n');
  return hash.digest('hex');
}

/**
 * Sort an NzbFile's segments by part number ascending (in place) and return it.
 */
export function sortSegments(file: NzbFile): NzbFile {
  file.segments.sort((a, b) => a.number - b.number);
  return file;
}
