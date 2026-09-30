import { FILE_PRIORITY, QbittorrentFile } from './client.js';

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
 * Tracks when each piece of one torrent was first observed downloaded.
 * qBittorrent flips a piece's state before flushing it to disk, so a piece
 * only counts as readable once it has been seen downloaded in an EARLIER
 * observation — at least one observation old. This replaces withholding a
 * fixed number of bytes behind the frontier: it keeps unflushed pieces out
 * of reads while still serving the file's final piece (where MKV cues and
 * the MP4 moov live) as soon as it has aged one poll, instead of stalling
 * tail reads until the whole torrent completes.
 */
export class PieceReadiness {
  private firstSeen: Float64Array;

  /** Number of pieces this instance was created for. */
  readonly pieceCount: number;

  constructor(pieceCount: number) {
    this.pieceCount = pieceCount;
    this.firstSeen = new Float64Array(pieceCount);
  }

  /**
   * Record one observation; pieces flipped to downloaded get a timestamp.
   * The observation clock is captured once and applied at the END of the
   * pass, so a piece flipped in this observation can never compare as older
   * than the observation itself (separate Date.now() reads could tick past
   * each other and make fresh pieces instantly readable).
   */
  observe(pieceStates: number[], now: number = Date.now()): void {
    for (let piece = 0; piece < pieceStates.length; piece++) {
      if (pieceStates[piece] === 2) {
        if (this.firstSeen[piece] === 0) this.firstSeen[piece] = now;
      } else if (this.firstSeen[piece] !== 0) {
        // Lost to a recheck or re-download, it must age again before it is
        // readable once more.
        this.firstSeen[piece] = 0;
      }
    }
    this.lastObservedAt = now;
  }

  /** A piece is readable once it was downloaded in a previous observation. */
  readable = (piece: number): boolean => {
    const seenAt = this.firstSeen[piece];
    return seenAt !== 0 && seenAt < this.lastObservedAt;
  };

  private lastObservedAt = 0;
}
