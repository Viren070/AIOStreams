import { createLogger } from '../../logging/logger.js';
import {
  computeNzbHash,
  Nzb,
  NzbFile,
  NzbSegment,
  sortSegments,
} from './model.js';
import { parseSubjectFilename } from './subject.js';
import {
  scanNzb,
  NzbScanError,
  type ScannedFile,
  type ScannedNzbDocument,
} from './scan.js';

const logger = createLogger('usenet/nzb');

/**
 * Parse an NZB XML document (string or Buffer) into our {@link Nzb} model.
 *
 * Parsing uses a strict byte scanner ({@link scanNzb}): anything outside the
 * NZB grammar (unknown elements, CDATA, exotic encodings, segments without a
 * message-id, files without segments) throws {@link NzbScanError}, so a
 * malformed NZB fails loudly here instead of half-working and surfacing as
 * missing articles at stream time.
 *
 * Tolerant of the common real-world variations: missing `number` attributes,
 * single-file NZBs, `<head><meta>` blocks, and segments nested directly under
 * `<file>`.
 */
export async function parseNzb(xml: string | Buffer): Promise<Nzb> {
  const startedAt = Date.now();
  let doc: ScannedNzbDocument;
  try {
    doc = scanNzb(xml);
  } catch (err) {
    if (err instanceof NzbScanError) {
      const buf = Buffer.isBuffer(xml) ? xml : Buffer.from(xml, 'utf8');
      const sample = buf
        .toString('utf8', 0, 512)
        .replace(
          /[\x00-\x1f\x7f]/g,
          (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')
        );
      logger.warn(
        { error: err.message, bytes: buf.length, sample },
        'NZB scan failed; content is not a valid NZB'
      );
    }
    throw err;
  }
  const files = doc.files.map(buildFile);
  if (files.length === 0) {
    throw new Error('Invalid NZB: no files with segments found');
  }
  const nzb: Nzb = { files, meta: doc.meta, hash: computeNzbHash(files) };
  logger.debug(
    {
      nzbHash: nzb.hash,
      files: nzb.files.length,
      segments: nzb.files.reduce((acc, f) => acc + f.segments.length, 0),
      latency: Date.now() - startedAt,
    },
    'parsed nzb'
  );
  return nzb;
}

/** Build one file: filename, encoded size, segment ordering. */
function buildFile(f: ScannedFile): NzbFile {
  if (f.segments.length === 0) {
    throw new NzbScanError(`file has no segments (subject "${f.subject}")`);
  }
  const segments: NzbSegment[] = f.segments.map((s) => ({
    messageId: s.messageId,
    number: s.number,
    bytes: s.bytes,
  }));
  // Backfill missing `number`s by document order.
  segments.forEach((seg, idx) => {
    if (!Number.isFinite(seg.number) || seg.number <= 0) {
      seg.number = idx + 1;
    }
  });
  const file: NzbFile = {
    subject: f.subject,
    poster: f.poster,
    date: f.date,
    groups: f.groups,
    segments,
    filename: parseSubjectFilename(f.subject),
    encodedSize: segments.reduce((acc, s) => acc + (s.bytes || 0), 0),
  };
  return sortSegments(file);
}
