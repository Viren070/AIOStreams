import { createLogger } from '../../../../logging/logger.js';
import { SeekableStream } from '../../file-stream.js';
import { RandomAccess } from '../random-access.js';
import { ArchiveKind, archiveKindOf } from '../archive-volume.js';
import { ArchiveEntry } from '../types.js';
import { NotStreamableError } from '../errors.js';
import { ArchiveStreamOptions } from '../inner-stream.js';
import { entrySource } from './descriptor.js';
import { FileOpener } from './layout.js';
import {
  DEFAULT_OPEN_CONCURRENCY,
  parseArchiveEntries,
  openVolumeSet,
} from './parse.js';
import {
  MAX_NEST_DEPTH,
  groupNestedArchives,
  buildNestedVolumeSet,
  entryReason,
  pickBestVideo,
} from './nesting.js';

const logger = createLogger('usenet/archive');

export interface OpenInnerOptions {
  /** Pre-known decoded sizes for each member volume (index-aligned). */
  knownSizes?: (number | undefined)[];
  /** Archive password (7z AES), e.g. from the NZB `<meta type="password">`. */
  password?: string;
  /**
   * Parallelism for the per-volume header parse AND the final inner stream's
   * concurrent read windows (both = the per-stream connection budget).
   */
  concurrency?: number;
  /** Final inner stream: read-window granularity in bytes. */
  windowBytes?: number;
  /** Final inner stream: read-ahead depth in windows. */
  prefetchWindows?: number;
}

/** Build the playback tuning passed to the final inner {@link ArchiveInnerStream}. */
function streamOptsFrom(opts: OpenInnerOptions): ArchiveStreamOptions {
  return {
    concurrency: opts.concurrency,
    windowBytes: opts.windowBytes,
    prefetchWindows: opts.prefetchWindows,
  };
}

export interface OpenedInner {
  stream: SeekableStream;
  path: string;
  size: number;
}

/**
 * Open a stored inner file as a {@link SeekableStream}. When `innerPath` is
 * omitted, picks the largest stored video. Handles one level of nesting
 * (rar-in-rar) unless `failNested` is set.
 */
export async function openArchiveInner(
  set: { kind: ArchiveKind; memberIndices: number[]; index: number },
  opener: FileOpener,
  innerPath: string | undefined,
  opts: OpenInnerOptions
): Promise<OpenedInner> {
  const startedAt = Date.now();
  const concurrency = opts.concurrency ?? DEFAULT_OPEN_CONCURRENCY;
  const vs = await openVolumeSet(set, opener, opts.knownSizes, concurrency);
  const { entries } = await parseArchiveEntries(
    vs,
    set.kind,
    opts.password ?? '',
    {
      concurrency,
    }
  );
  const opened = await resolveInner(vs, entries, innerPath, opts, 0);
  logger.debug(
    {
      index: set.index,
      volumes: set.memberIndices.length,
      path: opened.path,
      size: opened.size,
      latency: Date.now() - startedAt,
    },
    'opened archive inner stream'
  );
  return opened;
}

async function resolveInner(
  source: RandomAccess,
  entries: ArchiveEntry[],
  innerPath: string | undefined,
  opts: OpenInnerOptions,
  depth: number
): Promise<OpenedInner> {
  // 1. A real (non-archive) file at this level: an explicit path match, or the
  //    largest video when auto-picking.
  const direct = innerPath
    ? entries.find(
        (e) => !e.isDir && e.name === innerPath && !archiveKindOf(e.name)
      )
    : pickBestVideo(entries);
  if (direct) {
    const reason = entryReason(direct);
    if (reason) {
      throw new NotStreamableError(
        reason,
        `inner file not streamable (${reason})`
      );
    }
    const stream = entrySource(
      source,
      direct,
      opts.password ?? '',
      streamOptsFrom(opts)
    );
    return { stream, path: direct.name, size: stream.size() };
  }

  // 2. Descend one level into nested archive volume sets (rar-in-rar,
  //    rar-in-7z, ...) to find the target / a video inside them.
  if (depth < MAX_NEST_DEPTH) {
    for (const g of groupNestedArchives(entries)) {
      if (!g.allStored) continue;
      try {
        const vs = buildNestedVolumeSet(source, g.members, opts.password ?? '');
        await vs.open();
        const { entries: nestedEntries } = await parseArchiveEntries(
          vs,
          g.kind,
          opts.password ?? '',
          { concurrency: opts.concurrency ?? DEFAULT_OPEN_CONCURRENCY }
        );
        return await resolveInner(
          vs,
          nestedEntries,
          innerPath,
          opts,
          depth + 1
        );
      } catch (err) {
        if (err instanceof NotStreamableError) continue; // try next group
        throw err;
      }
    }
  }

  throw new NotStreamableError(
    'archive_no_video',
    innerPath
      ? `inner file not found in archive (${innerPath})`
      : 'no streamable video in archive'
  );
}
