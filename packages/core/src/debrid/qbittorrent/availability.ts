import { QbittorrentFile } from './client.js';

/** A file must have at least this many contiguous bytes before playback starts. */
export const STREAM_THRESHOLD_BYTES = 16 * 1024 * 1024;

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
  const file = files[fileIndex];
  if (!file || pieceSize <= 0) {
    return {
      complete: false,
      contiguousFrom: () => 0,
      rangeAvailable: () => false,
    };
  }
  const fileSize = file.size;
  // Offset of this file within the torrent, since piece indices are global.
  const fileOffset = files
    .slice(0, fileIndex)
    .reduce((sum, f) => sum + f.size, 0);

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
