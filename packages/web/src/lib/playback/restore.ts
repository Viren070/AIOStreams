import { storage } from '@/lib/storage';

const KEY = 'aiostreams-web-restore';
/** A point older than this isn't put back. */
const KEEP_MS = 12 * 60 * 60 * 1000;

/**
 * Where a file stood, noted with every report the server gets, so a run Android ends for memory
 * while the file waits in the background starts there again: the same version, position, pause
 * and tracks. A player closed as usual clears it.
 */
export interface RestorePoint {
  base: string;
  /** Whose film it was: another profile on the same server doesn't get it. */
  userId?: string;
  itemId: string;
  sourceId: string;
  positionMs: number;
  paused: boolean;
  /** Stream indexes in the version's list. */
  audio?: number;
  subtitle?: number;
  at: number;
}

export const restorePoint = {
  note(point: Omit<RestorePoint, 'at'>): void {
    storage.set(KEY, { ...point, at: Date.now() } satisfies RestorePoint);
  },
  clear(): void {
    storage.remove(KEY);
  },
  /** The point, once: it is gone after. */
  take(): RestorePoint | null {
    const point = storage.get<RestorePoint>(KEY);
    storage.remove(KEY);
    return point && Date.now() - point.at < KEEP_MS ? point : null;
  },
};
