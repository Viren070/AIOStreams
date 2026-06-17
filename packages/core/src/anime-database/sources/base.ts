/**
 * Source adapter contract for the anime database.
 *
 * Each external dataset is wrapped in an {@link AnimeSource} that knows how
 * to download itself, where it caches its file, how often to refresh, and
 * how to parse the file into a stream of source-agnostic
 * {@link SourceEntry} records.
 *
 * Adding a new source = drop a new file in this folder that exports an
 * `AnimeSource`, then register it in `./index.ts` and add a refresh-interval
 * field to the metadata config schema.
 */
import type { SourceEntry } from '../types.js';

export interface AnimeSource {
  /** Stable, lowercase identifier (used in task ids and log fields). */
  id: string;
  /** Human-readable label for log lines and the Tasks dashboard. */
  name: string;
  /** Source dataset URL. ETag-aware downloader handles 304s. */
  url: string;
  /** Local cache file path the downloader writes to. */
  filePath: string;
  /** Refresh interval in milliseconds (read from `appConfig`). */
  refreshIntervalMs(): number;
  /**
   * Parse the local cache file into a stream of {@link SourceEntry} records.
   * Implementations should stream wherever the file is large.
   */
  parse(filePath: string): AsyncIterable<SourceEntry>;
}
