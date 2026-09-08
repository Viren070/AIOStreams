import { createLogger } from '../../logging/logger.js';
import { appConfig } from '../../utils/index.js';
import {
  UsenetLibraryRepository,
  type UsenetLibraryEntry,
  type UsenetLibraryFile,
} from '../../db/index.js';
import { detectFileType, isMediaCategory } from '../pool/file-type.js';
import { libraryFileName, libraryFileToken } from './library.js';
import { openUsenetStream } from './stream-session.js';

const logger = createLogger('usenet/verify');

/**
 * Does this file actually contain what its name says it does?
 *
 * The article census proves every segment is still on the providers, not
 * that they assemble into the file the release claims: an obfuscated post
 * can be reassembled against the wrong NZB, and a poster can simply have
 * uploaded something else. Both look perfect to a STAT sweep and fail the
 * moment someone presses play. Reading the head through the normal streaming
 * path settles it for about one article per file, cheap enough to run at
 * import as well as on rechecks.
 */

/** Enough for every signature we know, ISO's volume descriptor included. */
const HEAD_BYTES = 40 * 1024;

export type ContentVerdict = 'ok' | 'bad' | 'inconclusive';

/** Extensions whose container we can positively identify from the head. */
const KNOWN_CONTAINERS = new Set([
  'mkv',
  'webm',
  'mka',
  'mp4',
  'm4v',
  'mov',
  'avi',
  'ts',
  'm2ts',
  'iso',
  'img',
  'm4a',
  'm4b',
  'flac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'aiff',
]);

function extensionOf(name: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match?.[1]?.toLowerCase();
}

async function readHead(
  entry: UsenetLibraryEntry,
  file: UsenetLibraryFile,
  signal?: AbortSignal
): Promise<Buffer | undefined> {
  const opened = await openUsenetStream(libraryFileToken(entry, file), {
    start: 0,
    end: Math.min(HEAD_BYTES, file.size),
    signal,
  });
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of opened.stream) {
      // Serve-path chunks are views into pooled slots; copy before keeping.
      chunks.push(Buffer.from(chunk as Buffer));
      total += (chunk as Buffer).length;
      if (total >= HEAD_BYTES) break;
    }
  } finally {
    opened.stream.destroy();
  }
  return total > 0 ? Buffer.concat(chunks) : undefined;
}

/**
 * Check one file's head. A head that matches any container we recognise
 * passes: a `.mkv` that is really an MP4 is mislabelled, not damaged, and the
 * players we serve do not care. Only a file whose extension promises a
 * container we know, whose head matches nothing at all, is condemned.
 */
async function verifyFile(
  entry: UsenetLibraryEntry,
  file: UsenetLibraryFile,
  signal?: AbortSignal
): Promise<ContentVerdict> {
  const name = libraryFileName(entry, file);
  const ext = extensionOf(name);
  if (!ext || !KNOWN_CONTAINERS.has(ext)) return 'inconclusive';

  const head = await readHead(entry, file, signal);
  if (!head || head.length < 12) return 'inconclusive';

  const detected = detectFileType(head, name);
  if (isMediaCategory(detected.category)) return 'ok';
  // Archives and par2 blocks are legitimate members of a release, just not
  // of a file calling itself an .mkv: that is the assembly going wrong.
  logger.warn(
    {
      nzbHash: entry.nzbHash,
      file: name,
      detected: detected.format ?? detected.category,
    },
    'file head is not the container its name claims'
  );
  return 'bad';
}

/**
 * Verify an entry's media files. Stops at the first bad one: a release with
 * one wrongly-assembled file is already not what it claims to be.
 */
export async function verifyEntryContent(
  entry: UsenetLibraryEntry,
  opts: { signal?: AbortSignal } = {}
): Promise<ContentVerdict> {
  if (!appConfig.usenet.verifyContent || !entry.nzbUrl) return 'inconclusive';
  const files = entry.files.filter(
    (f) => f.streamable !== false && f.index !== undefined
  );
  if (files.length === 0) return 'inconclusive';

  let sawAnswer = false;
  for (const file of files) {
    try {
      const verdict = await verifyFile(entry, file, opts.signal);
      if (verdict === 'bad') return 'bad';
      if (verdict === 'ok') sawAnswer = true;
    } catch (err) {
      // A read that could not complete says nothing about the content; the
      // census is the authority on whether the articles are there.
      logger.debug(
        { nzbHash: entry.nzbHash, err: (err as Error)?.message },
        'content verification could not read a file'
      );
    }
  }
  return sawAnswer ? 'ok' : 'inconclusive';
}

/**
 * Run the check for an entry the article audit was happy with, and fail it if
 * the bytes disagree. Deliberately does not touch the release blocklist: a
 * wrongly-assembled file is a claim about this NZB, not evidence that the
 * release is dead everywhere, and the blocklist is shared.
 */
export async function verifyEntryContentAndMark(
  nzbHash: string,
  opts: { signal?: AbortSignal } = {}
): Promise<ContentVerdict> {
  if (!appConfig.usenet.verifyContent) return 'inconclusive';
  const entry = await UsenetLibraryRepository.get(nzbHash);
  if (!entry) return 'inconclusive';
  const verdict = await verifyEntryContent(entry, opts);
  if (verdict === 'bad') {
    await UsenetLibraryRepository.markFailed(
      nzbHash,
      'File contents do not match the release: the articles are all there, ' +
        'but they do not assemble into the media this claims to be',
      entry.name,
      'content_mismatch'
    );
    logger.warn(
      { nzbHash, name: entry.name },
      'failed an entry whose articles are present but whose contents are wrong'
    );
  }
  return verdict;
}
