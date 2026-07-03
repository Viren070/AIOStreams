import { SeekableStream, SegmentMemo } from '../../file-stream.js';
import { RandomAccess } from '../random-access.js';
import { ArchiveKind } from '../archive-volume.js';
import { VolumeSet, Volume } from '../usenet-fs.js';
import { DataFragment } from '../types.js';
import { RarCryptInfo } from '../crypto/rar-kdf.js';
import { LazyFragmentResolver, LazyResolveHooks } from '../lazy-resolver.js';
import { ArchiveStreamOptions } from '../inner-stream.js';
import {
  InnerDescriptor,
  entrySource,
  hasPendingFragments,
} from './descriptor.js';

/**
 * Opens an NZB file (by index) as an opened random-access source. `knownSize`
 * lets the underlying stream skip its size probe (no fetch at open). `memo` is
 * the owning VolumeSet's shared boundary-segment slot (see {@link SegmentMemo}).
 */
export type FileOpener = (
  index: number,
  knownSize?: number,
  memo?: SegmentMemo
) => Promise<RandomAccess>;

/**
 * Everything needed to rebuild a streamable inner file's seekable stream
 * **without re-fetching or re-parsing any archive header**: the cached output
 * of a one-time inspect. Persisted with the library entry so a cold stream open
 * skips the (sometimes multi-second, e.g. encrypted-7z LZMA) header decode.
 */
export interface ArchiveStreamLayout {
  /** Outer archive kind, or `'join'` for a raw numeric-split concatenation (informational). */
  kind: ArchiveKind | 'join';
  /** Outer archive volume NZB-file indices (the concatenated VolumeSet). */
  memberIndices: number[];
  /** Decoded size of each outer volume (so the VolumeSet opens with no probe). */
  memberSizes: (number | undefined)[];
  /**
   * Nested archive volume sets descended through, outer→inner. Each element is
   * the ordered list of that nested archive's volume descriptors, expressed over
   * the *previous* source. Empty for a non-nested archive.
   */
  nestedLevels: InnerDescriptor[][];
  /** The final file's descriptor, over the innermost source. */
  target: InnerDescriptor;
}

/** JSON-safe form of an {@link ArchiveStreamLayout} (Buffers → hex). */
export function serializeArchiveLayout(layout: ArchiveStreamLayout): unknown {
  const desc = (d: InnerDescriptor) => ({
    name: d.name,
    size: d.size,
    fragments: d.fragments?.map((f) =>
      f.pending === undefined
        ? { offset: f.offset, length: f.length }
        : { offset: f.offset, length: f.length, pending: f.pending }
    ),
    aes: d.aes
      ? {
          packOffset: d.aes.packOffset,
          packSize: d.aes.packSize,
          cycles: d.aes.cycles,
          plainOffset: d.aes.plainOffset,
          salt: d.aes.salt.toString('hex'),
          iv: d.aes.iv.toString('hex'),
        }
      : undefined,
    crypt: d.crypt
      ? d.crypt.v === 5
        ? {
            v: 5,
            kdfLog2: d.crypt.kdfLog2,
            salt: d.crypt.salt.toString('hex'),
            iv: d.crypt.iv.toString('hex'),
            check: d.crypt.check?.toString('hex'),
          }
        : { v: 4, salt: d.crypt.salt.toString('hex') }
      : undefined,
  });
  return {
    kind: layout.kind,
    memberIndices: layout.memberIndices,
    memberSizes: layout.memberSizes,
    nestedLevels: layout.nestedLevels.map((lvl) => lvl.map(desc)),
    target: desc(layout.target),
  };
}

/**
 * Revive a descriptor's crypt info. Accepts the unified version-tagged shape
 * and the legacy `rar5Crypt` field (layouts persisted before RAR4 support).
 */
function deserializeCrypt(d: any): RarCryptInfo | undefined {
  const c = d.crypt ?? d.rar5Crypt;
  if (!c) return undefined;
  if (Number(c.v) === 4) {
    return { v: 4, salt: Buffer.from(String(c.salt), 'hex') };
  }
  // v === 5 or legacy rar5Crypt (no version tag).
  return {
    v: 5,
    kdfLog2: Number(c.kdfLog2),
    salt: Buffer.from(String(c.salt), 'hex'),
    iv: Buffer.from(String(c.iv), 'hex'),
    check: c.check == null ? undefined : Buffer.from(String(c.check), 'hex'),
  };
}

/** Revive a persisted layout; returns undefined when the shape is unusable. */
export function deserializeArchiveLayout(
  raw: unknown
): ArchiveStreamLayout | undefined {
  const j = raw as Record<string, any> | null | undefined;
  if (!j || !j.target || !Array.isArray(j.memberIndices)) return undefined;
  try {
    const desc = (d: any): InnerDescriptor => ({
      name: String(d.name),
      size: Number(d.size),
      fragments: Array.isArray(d.fragments)
        ? d.fragments.map(
            (f: any): DataFragment => ({
              offset: Number(f.offset),
              length: Number(f.length),
              pending: f.pending == null ? undefined : Number(f.pending),
            })
          )
        : undefined,
      aes: d.aes
        ? {
            packOffset: Number(d.aes.packOffset),
            packSize: Number(d.aes.packSize),
            cycles: Number(d.aes.cycles),
            plainOffset: Number(d.aes.plainOffset),
            salt: Buffer.from(String(d.aes.salt), 'hex'),
            iv: Buffer.from(String(d.aes.iv), 'hex'),
          }
        : undefined,
      crypt: deserializeCrypt(d),
    });
    const layout: ArchiveStreamLayout = {
      kind: j.kind,
      memberIndices: j.memberIndices.map((n: unknown) => Number(n)),
      memberSizes: Array.isArray(j.memberSizes)
        ? j.memberSizes.map((n: unknown) => (n == null ? undefined : Number(n)))
        : [],
      nestedLevels: Array.isArray(j.nestedLevels)
        ? j.nestedLevels.map((lvl: any[]) => lvl.map(desc))
        : [],
      target: desc(j.target),
    };
    // Pending (lazy) fragments are only sound for a plain, non-nested,
    // non-encrypted target over exact member sizes; anything else means the
    // blob predates a shape change or was corrupted: force the full-parse path.
    if (hasPendingFragments(layout.target)) {
      if (
        layout.nestedLevels.length > 0 ||
        layout.target.aes ||
        layout.target.crypt ||
        layout.memberSizes.length !== layout.memberIndices.length ||
        layout.memberSizes.some((s) => s === undefined)
      ) {
        return undefined;
      }
    }
    if (layout.nestedLevels.some((lvl) => lvl.some(hasPendingFragments))) {
      return undefined;
    }
    return layout;
  } catch {
    return undefined;
  }
}

/**
 * Rebuild a streamable inner file directly from a cached {@link
 * ArchiveStreamLayout}: open the outer VolumeSet (sizes known → no probe, and no
 * prewarm/parse), apply each nested level, then open the target. Reuses the same
 * {@link ArchiveInnerStream}/{@link VolumeSet} machinery as a parsed open, so the
 * resulting stream behaves identically, without the header round-trips and
 * (for encrypted 7z) the AES+LZMA decode.
 */
export async function rebuildArchiveStream(
  layout: ArchiveStreamLayout,
  opener: FileOpener,
  opts: {
    password?: string;
    concurrency?: number;
    windowBytes?: number;
    prefetchWindows?: number;
    /** Persistence/invalidations hooks for lazy (pending-fragment) layouts. */
    lazyHooks?: LazyResolveHooks;
    /** Hole (all-providers 430) pad-vs-fail hook for the final range stream. */
    onHole?: ArchiveStreamOptions['onHole'];
  } = {}
): Promise<SeekableStream> {
  const password = opts.password ?? '';
  const streamOpts: ArchiveStreamOptions = {
    concurrency: opts.concurrency,
    windowBytes: opts.windowBytes,
    prefetchWindows: opts.prefetchWindows,
    onHole: opts.onHole,
  };
  const outerVolumes: Volume[] = layout.memberIndices.map((index, i) => ({
    filename: `vol-${index}`,
    knownSize: layout.memberSizes[i],
    open: (knownSize, memo) => opener(index, knownSize, memo),
  }));
  const outer = new VolumeSet(outerVolumes);
  // Parallel size probing: a layout persisted without some volume sizes must
  // not open serially.
  await outer.open(opts.concurrency ?? 8);

  let source: RandomAccess = outer;
  for (const level of layout.nestedLevels) {
    const parent = source; // capture per level (closures are called lazily)
    const volumes: Volume[] = level.map((d) => ({
      filename: d.name,
      knownSize: d.size,
      open: async () => entrySource(parent, d, password),
    }));
    const vs = new VolumeSet(volumes);
    await vs.open();
    source = vs;
  }
  let resolver: LazyFragmentResolver | undefined;
  if (hasPendingFragments(layout.target)) {
    // Deserialize guards already reject nested/AES/sizeless lazy layouts; an
    // in-memory layout that violates this is a programming error; fall back.
    if (layout.nestedLevels.length > 0 || layout.target.aes) {
      throw new Error('lazy layout cannot be nested or AES');
    }
    if (layout.memberSizes.some((s) => s === undefined)) {
      throw new Error('lazy layout requires exact member sizes');
    }
    // memberSizes are the same par2-exact values the import parse used, so
    // volumeRanges() reproduces the exact address space the pending volume
    // indices refer to.
    resolver = new LazyFragmentResolver(
      outer,
      outer.volumeRanges(),
      { name: layout.target.name, size: layout.target.size },
      layout.target.fragments ?? [],
      { concurrency: opts.concurrency, hooks: opts.lazyHooks }
    );
  }
  return entrySource(source, layout.target, password, streamOpts, resolver);
}
