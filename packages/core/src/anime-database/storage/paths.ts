import path from 'path';
import { getDataFolder } from '../../utils/general.js';

/**
 * Root directory under which every anime-database source caches its
 * downloaded file + ETag.
 */
export const ANIME_DATABASE_PATH = path.join(getDataFolder(), 'anime-database');

/** Compute the conventional `<file>.etag` sidecar path. */
export function etagPathFor(filePath: string): string {
  return `${filePath}.etag`;
}
