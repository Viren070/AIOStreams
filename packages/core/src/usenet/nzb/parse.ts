import { createLogger } from '../../logging/logger.js';
import {
  computeNzbHash,
  Nzb,
  NzbFile,
  NzbSegment,
  sortSegments,
} from './model.js';
import { parseSubjectFilename, parseSubjectPartNumber } from './subject.js';
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
  const scanned = mergeSegmentPerFile(doc.files);
  const files = scanned.map(buildFile);
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

/**
 * Repair NZBs that wrap every article in its own `<file>` element instead of
 * listing a file's articles as `<segment>`s of one `<file>`.
 */
function mergeSegmentPerFile(files: ScannedFile[]): ScannedFile[] {
  if (files.length < 2) return files;

  const byName = new Map<string, ScannedFile[]>();
  for (const f of files) {
    if (f.segments.length !== 1) continue;
    const name = parseSubjectFilename(f.subject);
    if (!name) continue;
    const group = byName.get(name);
    if (group) group.push(f);
    else byName.set(name, [f]);
  }

  const merged = new Map<ScannedFile, ScannedFile>();
  const absorbed = new Set<ScannedFile>();
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const ordered = orderCompleteRun(group);
    if (!ordered) continue;
    const head = ordered[0];
    const groups = [...new Set(ordered.flatMap((f) => f.groups))];
    merged.set(head, {
      subject: head.subject,
      poster: head.poster,
      date: head.date,
      groups,
      segments: ordered.map((f) => f.segments[0]),
    });
    for (const f of ordered) if (f !== head) absorbed.add(f);
    logger.warn(
      { filename: name, parts: ordered.length },
      'nzb lists one file per article; merged the parts into a single file'
    );
  }
  if (merged.size === 0) return files;

  const out: ScannedFile[] = [];
  for (const f of files) {
    if (absorbed.has(f)) continue;
    out.push(merged.get(f) ?? f);
  }
  return out;
}

/**
 * Order single-segment files by part number, but only when those numbers form a
 * complete 1..N run
 */
function orderCompleteRun(group: ScannedFile[]): ScannedFile[] | undefined {
  for (const useSubject of [false, true]) {
    const seen = new Set<number>();
    const keyed: Array<{ file: ScannedFile; part: number }> = [];
    for (const f of group) {
      const part = useSubject
        ? parseSubjectPartNumber(f.subject)
        : f.segments[0].number;
      if (part === undefined || !Number.isFinite(part) || part < 1) break;
      if (part > group.length || seen.has(part)) break;
      seen.add(part);
      keyed.push({ file: f, part });
    }
    if (keyed.length !== group.length) continue;
    keyed.sort((a, b) => a.part - b.part);
    // Carry the resolved ordinal onto the segment so the merged file sorts by
    // it even when the `number` attributes were missing.
    for (const k of keyed) k.file.segments[0].number = k.part;
    return keyed.map((k) => k.file);
  }
  return undefined;
}

/** Build one file: filename, encoded size, segment ordering. */
function buildFile(f: ScannedFile): NzbFile {
  if (f.segments.length === 0) {
    throw new NzbScanError(`file has no segments (subject "${f.subject}")`);
  }
  const segments: NzbSegment[] = f.segments;
  let encodedSize = 0;
  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    // Backfill missing `number`s by document order.
    if (!Number.isFinite(seg.number) || seg.number <= 0) {
      seg.number = idx + 1;
    }
    encodedSize += seg.bytes || 0;
  }
  const file: NzbFile = {
    subject: f.subject,
    poster: f.poster,
    date: f.date,
    groups: f.groups,
    segments,
    filename: parseSubjectFilename(f.subject),
    encodedSize,
  };
  return sortSegments(file);
}
