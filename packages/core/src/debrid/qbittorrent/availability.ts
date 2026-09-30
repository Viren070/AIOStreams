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
 * names relative to the torrent's base (root folder included for folder
 * packs); `content_path` is the torrent root's CURRENT location — including
 * qBittorrent's temp/incomplete directory before completion and wherever
 * "move on finish" relocates it — while `save_path` is only the final
 * destination. So the base is derived from content_path: for a folder pack
 * (every name's first segment equals the root folder's name) it is
 * content_path's parent, for a rootless layout content_path itself, and for
 * a single-file torrent content_path already IS the file. Re-derived every
 * poll and on byte-stream ENOENT so relocations cannot strand a stream.
 */
export function deriveFilePath(
  torrent: { content_path: string },
  files: QbittorrentFile[],
  fileIndex: number
): string | undefined {
  const file = files.find((f) => f.index === fileIndex);
  if (!file) return undefined;
  if (files.length === 1) return torrent.content_path;
  const slash = file.name.indexOf('/');
  const rootName = slash > 0 ? file.name.slice(0, slash) : undefined;
  const pathRoot = torrent.content_path.endsWith('/')
    ? torrent.content_path.slice(0, -1)
    : torrent.content_path;
  const baseSlash = pathRoot.lastIndexOf('/');
  const baseName = baseSlash >= 0 ? pathRoot.slice(baseSlash + 1) : pathRoot;
  if (rootName && baseName === rootName && baseSlash >= 0) {
    // Folder pack: content_path is "<base>/<root folder>".
    return pathRoot.slice(0, baseSlash) + '/' + file.name;
  }
  // Rootless layout: content_path is the folder holding the files.
  return pathRoot + '/' + file.name;
}

/** Byte-level view of one file's download state from piece states. */
export interface FileAvailability {
  /** Whether every piece of this file is downloaded. */
  complete: boolean;
  /** Largest end such that [start, end) is fully downloaded. */
  contiguousFrom(start: number): number;
  /** Whether every byte in `[start, end)` is downloaded. */
  rangeAvailable(start: number, end: number): boolean;
}

 * Compute FileAvailability for one file. pieceStates: 0=missing,
 * 1=downloading, 2=downloaded. Without piece states only a complete
 * file claims anything, progress is not a prefix map.
export function computeFileAvailability(params: {
  files: QbittorrentFile[];
  fileIndex: number;
  pieceStates?: number[];
  pieceSize: number;
}): FileAvailability {
  const { files, fileIndex, pieceStates, pieceSize } = params;
  if (pieceSize <= 0) {
    return {
      complete: false,
      contiguousFrom: () => 0,
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
      rangeAvailable: () => false,
    };
  }
  const file = sorted[position];
  if (file.size === 0) {
    return {
      complete: true,
      contiguousFrom: (start) => start,
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
    const available = Math.floor(file.progress * fileSize);
    return {
      complete: file.progress >= 1,
      contiguousFrom: (start) =>
        Math.max(start, Math.min(available, fileSize)),
      rangeAvailable: (start, end) =>
        start >= fileSize || (start < available && end <= available),
    };
  }

  const downloaded = (piece: number) => pieceStates[piece] === 2;
  const pieceAt = (localByte: number) =>
    Math.floor((fileOffset + localByte) / pieceSize);
  const [firstPiece, lastPiece] = file.piece_range;

  return {
    complete: Array.from(
      { length: lastPiece - firstPiece + 1 },
      (_, i) => downloaded(firstPiece + i)
    ).every(Boolean),
    contiguousFrom: (start) => {
      if (start >= fileSize) return fileSize;
      let piece = pieceAt(start);
      if (!downloaded(piece)) return start;
      while (piece < lastPiece && downloaded(piece + 1)) {
        piece++;
      }
      return Math.min(fileSize, (piece + 1) * pieceSize - fileOffset);
    },
    rangeAvailable: (start, end) => {
      if (start >= end) return true;
      const from = pieceAt(start);
      const to = pieceAt(end - 1);
      for (let piece = from; piece <= to; piece++) {
        if (!downloaded(piece)) return false;
      }
      return true;
    },
  };
}
