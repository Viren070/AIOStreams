import pLimit from 'p-limit';
import { createLogger } from '../../../../logging/logger.js';
import { detectFileType, FileCategory } from '../../file-type.js';
import { RandomAccess } from '../random-access.js';
import { ArchiveKind, groupVolumeSets } from '../archive-volume.js';
import { ArchiveEntry } from '../types.js';
import { ArchiveErrorCode } from '../errors.js';
import {
  InnerDescriptor,
  descriptorOf,
  hasPendingFragments,
} from './descriptor.js';
import { ArchiveStreamLayout, FileOpener } from './layout.js';
import {
  DEFAULT_OPEN_CONCURRENCY,
  parseArchiveEntries,
  openVolumeSet,
  isArticleNotFound,
  cryptFailure,
} from './parse.js';
import {
  MAX_NEST_DEPTH,
  groupNestedArchives,
  buildNestedVolumeSet,
  entryReason,
} from './nesting.js';

const logger = createLogger('usenet/archive');

export interface ArchiveInnerEntry {
  /** Inner file path within the archive. */
  path: string;
  size: number;
  category: FileCategory;
  format?: string;
  /** Whether the inner file can be streamed (stored, unencrypted, non-solid). */
  streamable: boolean;
  /** Reason it is not streamable, when applicable. */
  reason?: ArchiveErrorCode;
  /**
   * Rebuild recipe captured during inspection so a later stream open skips the
   * archive header fetch + parse entirely. Only set for streamable inner files.
   */
  layout?: ArchiveStreamLayout;
}

/** Outer-archive context threaded through {@link listInnerRecursive} for layout. */
interface LayoutOuter {
  kind: ArchiveKind;
  memberIndices: number[];
  memberSizes: (number | undefined)[];
}

/** A set of NZB files to be parsed as one archive. */
export interface ArchiveSetSpec {
  kind: ArchiveKind;
  /** Representative NZB file index (volume 0). */
  index: number;
  memberIndices: number[];
  /**
   * The members are a raw numeric split (`x.001...`) of ONE archive byte
   * stream rather than real per-volume archives; parse the concatenation as
   * a single range.
   */
  joined?: boolean;
}

export interface ArchiveSetInfo {
  kind: ArchiveKind;
  /** Representative NZB file index (volume 0). */
  index: number;
  memberIndices: number[];
  inner: ArchiveInnerEntry[];
  /**
   * Set when the archive yielded no streamable inner files because of a parse
   * failure, distinguishing "articles gone from providers" from a genuinely
   * unstreamable archive so the import verdict stays honest. `encrypted` /
   * `bad_password` are RAR5 header-encryption failures (no/incorrect password).
   */
  failure?: 'article_not_found' | 'parse_failed' | 'encrypted' | 'bad_password';
  /**
   * The set's middle volumes were never probed (lazy parse); its
   * availability evidence is thinner, so the caller widens target STAT
   * sampling.
   */
  chased?: boolean;
}

export interface ContentFileRef {
  index: number;
  filename?: string;
  /** Pre-known decoded size; forwarded to VolumeSet for lazy volume opening. */
  size?: number;
  /**
   * The size was INFERRED (split-7z middle volume = volume 1's size), not read
   * from a yEnc/PAR2 record. A parse failure on a set with inferred sizes
   * triggers one retry that drops them (so {@link VolumeSet.open} probes the
   * real sizes in parallel).
   */
  inferred?: boolean;
  /** Segment count of the backing NZB file (duplicate-volume resolution). */
  segments?: number;
  /** `number=` of the file's first segment (1 for a complete post). */
  firstSegmentNumber?: number;
}

/**
 * Group NZB content files into RAR / 7z volume sets, one set per distinct
 * archive base name (so a release with several archives is not merged).
 */
export function groupArchiveSets(
  files: ContentFileRef[]
): Array<{ kind: ArchiveKind; memberIndices: number[]; index: number }> {
  return groupVolumeSets(files).map((set) => ({
    kind: set.kind,
    memberIndices: set.members.map((m) => m.index),
    index: set.members[0].index,
  }));
}

/** A synthetic non-streamable inner entry so an empty-on-failure set still
 *  carries its reason to the verdict classifier. */
function failureInner(
  set: { kind: ArchiveKind; index: number },
  reason: ArchiveErrorCode
): ArchiveInnerEntry {
  return {
    path: `archive#${set.index}`,
    size: 0,
    category: 'other',
    streamable: false,
    reason,
  };
}

/** Map one archive entry to an inner-listing entry. */
function toInnerOne(e: ArchiveEntry): ArchiveInnerEntry {
  const type = detectFileType(Buffer.alloc(0), e.name);
  const reason = entryReason(e);
  return {
    path: e.name,
    size: e.size,
    category: type.category,
    format: type.format,
    streamable: reason === undefined,
    reason,
  };
}

/**
 * Recursively list an archive's inner files, descending one level into nested
 * archive volume sets (rar-in-rar, rar-in-7z, ...) so the real inner video shows
 * up in the listing rather than just the nested archive's volume parts.
 */
async function listInnerRecursive(
  source: RandomAccess,
  entries: ArchiveEntry[],
  depth: number,
  password: string,
  outer: LayoutOuter,
  parentLevels: InnerDescriptor[][] = [],
  parseConcurrency = DEFAULT_OPEN_CONCURRENCY,
  signal?: AbortSignal
): Promise<ArchiveInnerEntry[]> {
  const groups = depth >= MAX_NEST_DEPTH ? [] : groupNestedArchives(entries);
  const nestedMembers = new Set(
    groups.flatMap((g) => g.members.map((m) => m.name))
  );

  const out: ArchiveInnerEntry[] = [];
  for (const e of entries) {
    if (e.isDir) continue;
    // Members of a nested set are surfaced via expansion below, not as-is.
    if (nestedMembers.has(e.name)) continue;
    const one = toInnerOne(e);
    // Capture the rebuild recipe for streamable files (the only ones a later
    // open will reconstruct); non-streamable parts never get streamed.
    if (one.streamable) {
      one.layout = {
        kind: outer.kind,
        memberIndices: outer.memberIndices,
        memberSizes: outer.memberSizes,
        nestedLevels: parentLevels,
        target: descriptorOf(e),
      };
    }
    out.push(one);
  }

  for (const g of groups) {
    if (!g.allStored) {
      // Can't open it (compressed/encrypted volume); keep the parts visible.
      for (const m of g.members) out.push(toInnerOne(m));
      continue;
    }
    try {
      const vs = buildNestedVolumeSet(source, g.members, password);
      await vs.open();
      const { entries: nestedEntries } = await parseArchiveEntries(
        vs,
        g.kind,
        password,
        { concurrency: parseConcurrency, signal }
      );
      out.push(
        ...(await listInnerRecursive(
          vs,
          nestedEntries,
          depth + 1,
          password,
          outer,
          [...parentLevels, g.members.map(descriptorOf)],
          parseConcurrency,
          signal
        ))
      );
    } catch (err) {
      logger.warn(
        {
          kind: g.kind,
          volumes: g.members.length,
          err: (err as Error).message,
        },
        'nested archive expansion failed; keeping parts'
      );
      for (const m of g.members) out.push(toInnerOne(m));
    }
  }
  return out;
}

/** Max archive sets inspected concurrently (a season pack is one set per episode). */
const MAX_PARALLEL_SETS = 4;

/**
 * Inspect every archive set in an NZB and return their inner-file listings.
 */
export async function inspectArchiveSets(
  files: ContentFileRef[],
  opener: FileOpener,
  opts: {
    password?: string;
    /** Parallelism for volume-size probing + final stream read windows. */
    concurrency?: number;
    /** Parallelism for the per-volume header walk (idle import budget). */
    parseConcurrency?: number;
    /** Probed decoded heads by NZB file index; most header reads hit these. */
    heads?: Map<number, Buffer>;
    /** Extra sets beyond name-grouped volumes (raw numeric-split joins). */
    extraSets?: ArchiveSetSpec[];
    /** Allow lazy-mode parses (disabled when the release gate found a miss). */
    allowLazy?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<ArchiveSetInfo[]> {
  const password = opts.password ?? '';
  const concurrency = opts.concurrency ?? DEFAULT_OPEN_CONCURRENCY;
  const parseConcurrency = opts.parseConcurrency ?? concurrency;
  const sets: ArchiveSetSpec[] = [
    ...groupArchiveSets(files),
    ...(opts.extraSets ?? []),
  ];
  // Sets are independent (per-episode archives in a pack), so inspect them in
  // parallel; doing them serially would pin the import to one connection while
  // later sets wait.
  const limit = pLimit(Math.min(MAX_PARALLEL_SETS, Math.max(1, sets.length)));
  const settled = await Promise.all(
    sets.map((set) =>
      limit(async (): Promise<ArchiveSetInfo> => {
        const memberFiles = set.memberIndices.map((i) =>
          files.find((f) => f.index === i)
        );
        // For a joined set only the first member's head aligns with a parse
        // range start; per-volume sets get all heads, range-aligned.
        const heads = set.joined
          ? [opts.heads?.get(set.memberIndices[0])]
          : set.memberIndices.map((i) => opts.heads?.get(i));
        // Lazy: middles deliberately unprobed (no heads) with EXACT sizes;
        // walk only the volumes where files start/end; middles become pending
        // fragments resolved on first touch. Requires the first head (the
        // walk starts there) and every member's first segment present (a
        // resolve reads the volume's leading bytes); the inferred-size retry
        // never runs lazy (sizes are dropped there).
        const lazyFor = (memberSizes: (number | undefined)[]): boolean =>
          opts.allowLazy === true &&
          set.kind === 'rar' &&
          !set.joined &&
          set.memberIndices.length >= 3 &&
          heads[0] !== undefined &&
          memberSizes.every((s) => s !== undefined && s > 0) &&
          heads.slice(1, -1).some((h) => h === undefined) &&
          memberFiles.every((f) => f?.firstSegmentNumber === 1);
        const attempt = async (
          memberSizes: (number | undefined)[]
        ): Promise<ArchiveSetInfo> => {
          const lazy = lazyFor(memberSizes);
          const vs = await openVolumeSet(set, opener, memberSizes, concurrency);
          const archiveBytes = vs.size();
          let { entries, volumeErrors } = await parseArchiveEntries(
            vs,
            set.kind,
            password,
            {
              concurrency: parseConcurrency,
              heads,
              joined: set.joined,
              lazy,
              signal: opts.signal,
            }
          );
          // Nestedness is only knowable post-parse. A nested expansion reads
          // the nested volumes' bytes THROUGH the outer entries' fragments,
          // which is unsound over pending estimates; re-run the parse eagerly for
          // the rare lazy-set-with-nested-archives combination.
          if (
            entries.some((e) => hasPendingFragments(e)) &&
            groupNestedArchives(entries).some((g) => g.allStored)
          ) {
            logger.debug(
              { index: set.index, volumes: set.memberIndices.length },
              'lazy parse found nested archives; re-parsing eagerly'
            );
            ({ entries, volumeErrors } = await parseArchiveEntries(
              vs,
              set.kind,
              password,
              {
                concurrency: parseConcurrency,
                heads,
                joined: set.joined,
                lazy: false,
                signal: opts.signal,
              }
            ));
          }
          const inner = await listInnerRecursive(
            vs,
            entries,
            0,
            password,
            { kind: set.kind, memberIndices: set.memberIndices, memberSizes },
            [],
            parseConcurrency,
            opts.signal
          );
          logger.debug(
            {
              index: set.index,
              kind: set.kind,
              joined: set.joined,
              lazy,
              volumes: set.memberIndices.length,
              archiveBytes,
              entries: entries.length,
              inner: inner.length,
              volumeErrors: volumeErrors.length,
              sample: inner.slice(0, 5).map((i) => ({
                path: i.path,
                category: i.category,
                streamable: i.streamable,
                reason: i.reason,
              })),
            },
            'parsed archive set'
          );
          // Per-volume tolerance: files untouched by a failed volume still
          // stream. Only when failures left NOTHING streamable does the set
          // carry a failure verdict.
          let failure: ArchiveSetInfo['failure'];
          if (volumeErrors.length > 0 && !inner.some((i) => i.streamable)) {
            const crypt = volumeErrors
              .map((v) => cryptFailure(v.error))
              .find((c) => c);
            failure =
              crypt ??
              (volumeErrors.some((v) => isArticleNotFound(v.error))
                ? 'article_not_found'
                : 'parse_failed');
            // A header-encryption failure parses to zero entries; synthesize a
            // reason-carrying inner so the verdict is honest, not generic.
            if (crypt && inner.length === 0) {
              inner.push(
                failureInner(
                  set,
                  crypt === 'bad_password'
                    ? 'archive_bad_password'
                    : 'archive_encrypted'
                )
              );
            }
          }
          return {
            kind: set.kind,
            index: set.index,
            memberIndices: set.memberIndices,
            inner,
            failure,
            chased: lazy || undefined,
          };
        };
        const warn = (err: unknown, msg: string) =>
          logger.warn(
            {
              index: set.index,
              kind: set.kind,
              volumes: set.memberIndices.length,
              err: (err as Error).message,
            },
            msg
          );
        const failed = (err: unknown): ArchiveSetInfo => {
          const crypt = cryptFailure(err);
          const failure =
            crypt ??
            (isArticleNotFound(err) ? 'article_not_found' : 'parse_failed');
          return {
            kind: set.kind,
            index: set.index,
            memberIndices: set.memberIndices,
            inner: crypt
              ? [
                  failureInner(
                    set,
                    crypt === 'bad_password'
                      ? 'archive_bad_password'
                      : 'archive_encrypted'
                  ),
                ]
              : [],
            failure,
          };
        };
        try {
          return await attempt(memberFiles.map((f) => f?.size));
        } catch (err) {
          // Inferred (split-7z middle) sizes are validated by the parse itself:
          // on failure, drop them and retry once; VolumeSet.open then probes
          // the real sizes in parallel.
          if (memberFiles.some((f) => f?.inferred)) {
            warn(
              err,
              'archive parse failed with inferred volume sizes; retrying with probed sizes'
            );
            try {
              return await attempt(
                memberFiles.map((f) => (f?.inferred ? undefined : f?.size))
              );
            } catch (err2) {
              warn(err2, 'archive inspect failed');
              return failed(err2);
            }
          }
          warn(err, 'archive inspect failed');
          return failed(err);
        }
      })
    )
  );
  return settled;
}
