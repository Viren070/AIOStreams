import { open, realpath, stat, type FileHandle } from 'fs/promises';
import { constants } from 'fs';
import { FILE_PRIORITY, QbittorrentFile } from './client.js';

/** Rewrite a qBittorrent-reported path through the configured mount
 * mappings. Longest matching prefix wins. */
export function applyPathMappings(
  path: string,
  mappings?: { from: string; to: string }[]
): string {
  if (!mappings || mappings.length === 0) return path;
  // Map backslashes too so Windows-style mappings match.
  const normalize = (value: string) => value.replace(/\\/g, '/');
  const sorted = [...mappings].sort(
    (a, b) => normalize(b.from).length - normalize(a.from).length
  );
  for (const mapping of sorted) {
    const fromRaw = normalize(mapping.from);
    const from = fromRaw.endsWith('/') ? fromRaw : fromRaw + '/';
    if (path === fromRaw) return normalize(mapping.to);
    if (path.startsWith(from)) {
      const tail = path.slice(from.length);
      const to = normalize(mapping.to);
      return to.endsWith('/') ? to + tail : to + '/' + tail;
    }
  }
  return path;
}

export type AllowedPath = 'allowed' | 'missing' | 'invalid' | 'outside';

/**
 * Open a path for reading, refusing anything that is not a regular file.
 * Non-blocking first, a fifo or device node would park a threadpool
 * thread forever.
 */
export async function openRegularFile(
  path: string,
  opts: { minSize?: number } = {}
): Promise<FileHandle | undefined> {
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
    );
  } catch {
    return undefined;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      await handle.close().catch(() => {});
      return undefined;
    }
    if (opts.minSize !== undefined && stats.size < opts.minSize) {
      await handle.close().catch(() => {});
      return undefined;
    }
    return handle;
  } catch {
    await handle.close().catch(() => {});
    return undefined;
  }
}

export interface ResolvedAllowedPath {
  status: AllowedPath;
  /** The fully resolved path when allowed, open this one rather than the input. */
  realPath?: string;
}

export async function resolveAllowedPath(
  candidate: string
): Promise<ResolvedAllowedPath> {
  const real = await realpath(candidate).catch(() => undefined);
  if (!real) return { status: 'missing' };

  const stats = await stat(real).catch(() => undefined);
  if (!stats) return { status: 'missing' };
  if (!stats.isFile()) return { status: 'invalid' };

  const rawRoots = (process.env.QBITTORRENT_ALLOWED_ROOTS ?? '')
    .split(',')
    .map((root) => root.trim())
    .filter(Boolean);
  const validRoot = (root: string) =>
    root.startsWith('/') && root.replace(/\/+$/, '') !== '' && root !== '/';
  const roots = rawRoots.filter(validRoot);

  if (roots.length === 0) return { status: 'outside' };
  // Fold for case-insensitive platforms.
  const fold =
    process.platform === 'win32'
      ? (value: string) => value.toLowerCase()
      : (value: string) => value;
  for (const root of roots) {
    const realRoot = await realpath(root).catch(() => undefined);
    if (!realRoot) continue;
    if (fold(real) === fold(realRoot)) {
      return { status: 'allowed', realPath: real };
    }
    const relative = posixRelative(realRoot, real);
    if (relative !== undefined) {
      return { status: 'allowed', realPath: real };
    }
  }
  return { status: 'outside' };
}

function posixRelative(root: string, target: string): string | undefined {
  // Inside root (not escaping, not on a different drive).
  const fold =
    process.platform === 'win32'
      ? (value: string) => value.toLowerCase()
      : (value: string) => value;
  const rootParts = fold(root).split(/[\\/]+/).filter(Boolean);
  const targetParts = fold(target).split(/[\\/]+/).filter(Boolean);
  if (rootParts.length >= targetParts.length) return undefined;
  for (let i = 0; i < rootParts.length; i++) {
    if (rootParts[i] !== targetParts[i]) return undefined;
  }
  return targetParts.slice(rootParts.length).join('/');
}

/** A file must have at least this many contiguous bytes before playback starts. */
export const STREAM_THRESHOLD_BYTES = 16 * 1024 * 1024;

/** How a resolve should adjust file priorities in a multi-file torrent. */
export interface FilePriorityPlan {
  /** File indices to skip entirely (never downloaded). */
  skip: number[];
  /** File indices to raise to maximum priority (downloaded first). */
  raise: number[];
  /** File indices to restore to normal priority (currently skipped). */
  restore: number[];
}

/**
 * Plan file priority changes for a resolve. Own torrents: selected file
 * raised, others optionally skipped. Adopted torrents: only restore a
 * skipped selected file. Complete files and files being streamed are
 * never touched.
 */
export function planFilePriorities(params: {
  files: QbittorrentFile[];
  selectedIndex: number;
  skipOthers: boolean;
  ownTorrent: boolean;
  /** Indices with an active consumer, excluded from the skip set. */
  liveFiles?: ReadonlySet<number>;
}): FilePriorityPlan {
  const plan: FilePriorityPlan = { skip: [], raise: [], restore: [] };
  const selected = params.files.find(
    (file) => file.index === params.selectedIndex
  );
  if (!selected) return plan;
  // Nothing to download first and nothing worth skipping, leave a complete
  // torrent exactly as it is.
  if (params.files.every((file) => file.progress >= 1)) return plan;
  if (params.ownTorrent) {
    if (params.skipOthers) {
      plan.skip = params.files
        .filter(
          (file) =>
            file.index !== params.selectedIndex &&
            file.progress < 1 &&
            !params.liveFiles?.has(file.index)
        )
        .map((file) => file.index);
    }
    if (selected.progress < 1) {
      plan.raise = [params.selectedIndex];
    }
  } else if (selected.priority === FILE_PRIORITY.skip) {
    plan.restore = [params.selectedIndex];
  }
  return plan;
}

/**
 * Absolute on-disk path of one file within a torrent. The files API reports
 * names relative to the torrent's base as recorded in the metainfo (root
 * folder included); `content_path` is the torrent root's CURRENT location —
 * including qBittorrent's temp/incomplete directory before completion and
 * wherever "move on finish" relocates it — while `save_path` is only the
 * final destination. So the base comes from comparing the two: when they
 * differ the root folder is present and content_path is "<base>/<root>";
 * when they match the files sit directly in the save dir, either because
 * the metainfo is rootless or because qBittorrent stripped the root folder
 * (then the shared first segment of every name is not part of the disk
 * path). A single-file torrent's content_path already IS the file; this
 * special case is load-bearing, not a simplification. Re-derived every poll
 * and on byte-stream ENOENT so relocations cannot strand a stream.
 */
export function deriveFilePath(
  torrent: { content_path: string; save_path: string },
  files: QbittorrentFile[],
  fileIndex: number
): string | undefined {
  const file = files.find((f) => f.index === fileIndex);
  if (!file) return undefined;
  // Normalise Windows separators before stripping trailing slashes.
  const contentPath = torrent.content_path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (files.length === 1) return contentPath;
  const savePath = torrent.save_path.replace(/\\/g, '/').replace(/\/+$/, '');
  const firstSegments = new Set(
    files.map((f) => (f.name.includes('/') ? f.name.slice(0, f.name.indexOf('/')) : ''))
  );
  const rootName =
    firstSegments.size === 1 && !firstSegments.has('')
      ? [...firstSegments][0]
      : undefined;
  const baseName = contentPath.slice(contentPath.lastIndexOf('/') + 1);
  if (rootName && baseName === rootName && contentPath !== savePath) {
    // Root folder present on disk.
    return contentPath.slice(0, contentPath.lastIndexOf('/')) + '/' + file.name;
  }
  if (rootName && contentPath === savePath) {
    // Root folder stripped from disk but still in metainfo names.
    return contentPath + '/' + file.name.slice(file.name.indexOf('/') + 1);
  }
  // Rootless or mixed layout, names map directly under the content path.
  return contentPath + '/' + file.name;
}

/** Byte-level view of one file's download state from piece states. */
export interface FileAvailability {
  /** Whether every piece of this file is downloaded. */
  complete: boolean;
  /** Largest end such that [start, end) is fully downloaded. */
  contiguousFrom(start: number): number;
  /** Like contiguousFrom but only counting flushed pieces. */
  readableFrom(start: number): number;
  /** Whether every byte in `[start, end)` is downloaded. */
  rangeAvailable(start: number, end: number): boolean;
}

/**
 * Compute FileAvailability for one file. pieceStates: 0=missing,
 * 1=downloading, 2=downloaded. Without piece states only a complete
 * file claims anything, progress is not a prefix map.
 */
export function computeFileAvailability(params: {
  files: QbittorrentFile[];
  fileIndex: number;
  pieceStates?: number[];
  pieceSize: number;
  isReadable?: (globalPiece: number) => boolean;
}): FileAvailability {
  const { files, fileIndex, pieceStates, pieceSize, isReadable } = params;
  if (pieceSize <= 0) {
    return {
      complete: false,
      contiguousFrom: () => 0,
      readableFrom: () => 0,
      rangeAvailable: () => false,
    };
  }
  // Sum offsets in index order, array order is not guaranteed.
  const sorted = [...files].sort((a, b) => a.index - b.index);
  const position = sorted.findIndex((file) => file.index === fileIndex);
  if (position === -1) {
    return {
      complete: false,
      contiguousFrom: () => 0,
      readableFrom: () => 0,
      rangeAvailable: () => false,
    };
  }
  const file = sorted[position];
  if (file.size === 0) {
    return {
      complete: true,
      contiguousFrom: (start) => start,
      readableFrom: (start) => start,
      rangeAvailable: () => true,
    };
  }
  const fileSize = file.size;
  let fileOffset = sorted
    .slice(0, position)
    .reduce((sum, f) => sum + f.size, 0);
  // v2 pad files shift summed offsets, the piece range pins the real one.
  if (Math.floor(fileOffset / pieceSize) !== file.piece_range[0]) {
    fileOffset = file.piece_range[0] * pieceSize;
  }

  if (!pieceStates) {
    const complete = file.progress >= 1;
    return {
      complete,
      contiguousFrom: (start) => (complete ? Math.max(start, fileSize) : start),
      readableFrom: (start) => (complete ? Math.max(start, fileSize) : start),
      rangeAvailable: (start, end) => complete || start >= end,
    };
  }

  const readable = isReadable ?? ((piece: number) => pieceStates[piece] === 2);
  const downloaded = (piece: number) => pieceStates[piece] === 2;
  const pieceAt = (localByte: number) =>
    Math.floor((fileOffset + localByte) / pieceSize);
  const [firstPiece, lastPiece] = file.piece_range;
  const runFrom = (start: number, ok: (piece: number) => boolean) => {
    if (start >= fileSize) return fileSize;
    let piece = pieceAt(start);
    if (!ok(piece)) return start;
    while (piece < lastPiece && ok(piece + 1)) {
      piece++;
    }
    return Math.min(fileSize, (piece + 1) * pieceSize - fileOffset);
  };
  const rangeOver = (start: number, end: number, ok: (piece: number) => boolean) => {
    if (start >= end) return true;
    const from = pieceAt(start);
    const to = pieceAt(end - 1);
    for (let piece = from; piece <= to; piece++) {
      if (!ok(piece)) return false;
    }
    return true;
  };
  let complete = true;
  for (let piece = firstPiece; piece <= lastPiece; piece++) {
    if (!downloaded(piece)) {
      complete = false;
      break;
    }
  }

  return {
    complete,
    contiguousFrom: (start) => runFrom(start, downloaded),
    readableFrom: (start) => runFrom(start, readable),
    rangeAvailable: (start, end) => rangeOver(start, end, downloaded),
  };
}

/**
 * Tracks in which observation each piece was first seen downloaded.
 * qBittorrent flips a piece's state before flushing it to disk, so a piece
 * only counts as readable once it has aged one observation, which still
 * serves the file's final piece (MKV cues, MP4 moov) instead of stalling
 * tail reads until completion. Generations rather than timestamps, a
 * wall-clock step backwards cannot wedge pieces unreadable.
 */
export class PieceReadiness {
  private firstSeenGen: Uint32Array;

  /** Number of pieces this instance was created for. */
  readonly pieceCount: number;

  private generation = 0;

  constructor(pieceCount: number) {
    this.pieceCount = pieceCount;
    this.firstSeenGen = new Uint32Array(pieceCount);
  }

  /** Record one observation, pieces flipped to downloaded get the generation. */
  observe(pieceStates: number[]): void {
    this.generation++;
    for (let piece = 0; piece < pieceStates.length; piece++) {
      if (pieceStates[piece] === 2) {
        if (this.firstSeenGen[piece] === 0) this.firstSeenGen[piece] = this.generation;
      } else if (this.firstSeenGen[piece] !== 0) {
        // Lost to a recheck or re-download, it must age again before it is
        // readable once more.
        this.firstSeenGen[piece] = 0;
      }
    }
  }

  /** A piece is readable once it was downloaded in a previous observation. */
  readable = (piece: number): boolean => {
    const seenIn = this.firstSeenGen[piece];
    return seenIn !== 0 && seenIn < this.generation;
  };
}
