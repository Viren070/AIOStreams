import { createLogger } from '../logging/logger.js';
import { makeRequest } from '../utils/http.js';
import type { ArrInstance } from './types.js';

const logger = createLogger('arr');

const TIMEOUT_MS = 15_000;

/** A Sonarr/Radarr history record (only the fields we act on). */
export interface ArrHistoryRecord {
  id: number;
  eventType: string;
  downloadId?: string;
  movieId?: number;
  seriesId?: number;
  episodeId?: number;
  date?: string;
  data?: Record<string, string | undefined>;
}

/** A movie/episode file record. */
export interface ArrFileRecord {
  id: number;
  path?: string;
  relativePath?: string;
}

/** One of the arr's status messages on a queue item. */
export interface ArrStatusMessage {
  title?: string;
  messages?: string[];
}

/** A queue item, as much of it as the cleanup pass reads. */
export interface ArrQueueItem {
  id: number;
  title?: string;
  downloadId?: string;
  downloadClient?: string;
  status?: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  outputPath?: string;
  statusMessages?: ArrStatusMessage[];
  errorMessage?: string;
  movieId?: number;
  seriesId?: number;
  episodeId?: number;
}

/** One reason the arr gives for not importing a candidate file. */
export interface ArrImportRejection {
  reason?: string;
  type?: string;
}

/** A file the arr found for a download but has not imported. */
export interface ArrManualImportCandidate {
  path: string;
  folderName?: string;
  seasonNumber?: number;
  movie?: { id?: number };
  series?: { id?: number };
  episodes?: { id: number }[];
  quality?: unknown;
  languages?: unknown;
  releaseGroup?: string;
  indexerFlags?: number;
  releaseType?: string;
  rejections?: ArrImportRejection[];
}

export class ArrApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ArrApiError';
  }
}

/**
 * Minimal Sonarr/Radarr v3 client: only what the download-client integration
 * needs. Both apps share this part of the API; the few divergent endpoints
 * are switched on {@link ArrInstance.type}.
 */
export class ArrClient {
  constructor(private readonly instance: ArrInstance) {}

  get id(): string {
    return this.instance.id;
  }

  get label(): string {
    return this.instance.name || this.instance.url;
  }

  get type(): ArrInstance['type'] {
    return this.instance.type;
  }

  /** Whether this instance handles a download-client category. */
  handlesCategory(category?: string): boolean {
    const allowed = this.instance.categories;
    if (!allowed || allowed.length === 0) return true;
    if (!category) return false;
    return allowed.some((c) => c.toLowerCase() === category.toLowerCase());
  }

  private async call<T>(
    path: string,
    opts: {
      method?: string;
      body?: unknown;
      query?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const url = new URL(
      `/api/v3/${path.replace(/^\//, '')}`,
      this.instance.url.replace(/\/$/, '') + '/'
    );
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      url.searchParams.set(k, v);
    }
    const res = await makeRequest(url.toString(), {
      timeout: TIMEOUT_MS,
      method: opts.method ?? 'GET',
      ignoreRecursion: true,
      headers: {
        'X-Api-Key': this.instance.apiKey,
        ...(opts.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    if (!res.ok) {
      throw new ArrApiError(
        `${this.label} ${opts.method ?? 'GET'} ${path} → ${res.status}`,
        res.status
      );
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ArrApiError(`${this.label} ${path} returned non-JSON`);
    }
  }

  /** Reachability + credential check (the arr's own "Test" button). */
  async systemStatus(): Promise<{ version?: string; appName?: string }> {
    return this.call('system/status');
  }

  /**
   * History for one download id. The arrs record every grab and import
   * against the id the download client reported (our `nzo_id`), so this is
   * the join between a library row and what the arr did with it.
   */
  async history(downloadId: string): Promise<ArrHistoryRecord[]> {
    const res = await this.call<{ records?: ArrHistoryRecord[] }>('history', {
      query: { downloadId, page: '1', pageSize: '50' },
    });
    return res?.records ?? [];
  }

  /** Mark a grab failed: the arr blocklists the release. */
  async markFailed(historyId: number): Promise<void> {
    await this.call(`history/failed/${historyId}`, { method: 'POST' });
  }

  async command(
    name: string,
    body: Record<string, unknown> = {}
  ): Promise<void> {
    await this.call('command', { method: 'POST', body: { name, ...body } });
  }

  /** Ask the arr to poll its download clients now. */
  async refreshMonitoredDownloads(): Promise<void> {
    await this.command('RefreshMonitoredDownloads');
  }

  /** Files the arr has for a movie (Radarr) or series (Sonarr). */
  async listFiles(parentId: number): Promise<ArrFileRecord[]> {
    return this.instance.type === 'radarr'
      ? ((await this.call<ArrFileRecord[]>('moviefile', {
          query: { movieId: String(parentId) },
        })) ?? [])
      : ((await this.call<ArrFileRecord[]>('episodefile', {
          query: { seriesId: String(parentId) },
        })) ?? []);
  }

  async deleteFile(fileId: number): Promise<void> {
    const path =
      this.instance.type === 'radarr'
        ? `moviefile/${fileId}`
        : `episodefile/${fileId}`;
    await this.call(path, { method: 'DELETE' });
  }

  /** Search for a replacement for whatever the failed grab was for. */
  async searchFor(record: ArrHistoryRecord): Promise<void> {
    if (this.instance.type === 'radarr') {
      if (record.movieId === undefined) return;
      await this.command('MoviesSearch', { movieIds: [record.movieId] });
      return;
    }
    if (record.episodeId !== undefined) {
      await this.command('EpisodeSearch', { episodeIds: [record.episodeId] });
    } else if (record.seriesId !== undefined) {
      await this.command('SeriesSearch', { seriesId: record.seriesId });
    }
  }

  /**
   * Stop the arr re-grabbing something. Blocklisting only rules out the
   * releases we have seen; an unmonitored item is left alone until a human
   * looks at it.
   */
  async setMonitored(
    target: { movieId?: number; episodeIds?: number[] },
    monitored: boolean
  ): Promise<void> {
    if (this.instance.type === 'radarr') {
      if (target.movieId === undefined) return;
      // No partial-update endpoint: read the movie, put it back changed.
      const movie = await this.call<Record<string, unknown>>(
        `movie/${target.movieId}`
      );
      if (!movie) return;
      await this.call(`movie/${target.movieId}`, {
        method: 'PUT',
        body: { ...movie, monitored },
      });
      return;
    }
    const episodeIds = target.episodeIds ?? [];
    if (episodeIds.length === 0) return;
    await this.call('episode/monitor', {
      method: 'PUT',
      body: { episodeIds, monitored },
    });
  }

  /** Queue items the arr is tracking, across every page. */
  async queue(): Promise<ArrQueueItem[]> {
    const res = await this.call<{ records?: ArrQueueItem[] }>('queue', {
      query: {
        page: '1',
        pageSize: '200',
        includeUnknownMovieItems: 'true',
        includeUnknownSeriesItems: 'true',
      },
    });
    return res?.records ?? [];
  }

  /**
   * Drop a queue item. `blocklist` stops the same release being grabbed
   * again; `skipRedownload` decides whether the arr immediately looks for a
   * replacement.
   */
  async deleteQueueItem(
    id: number,
    opts: {
      removeFromClient?: boolean;
      blocklist?: boolean;
      skipRedownload?: boolean;
    } = {}
  ): Promise<void> {
    try {
      await this.call(`queue/${id}`, {
        method: 'DELETE',
        query: {
          removeFromClient: String(opts.removeFromClient ?? true),
          blocklist: String(opts.blocklist ?? false),
          skipRedownload: String(opts.skipRedownload ?? false),
        },
      });
    } catch (err) {
      // Already gone (the arr removed it, or a sibling row's delete took the
      // whole download with it) is the outcome asked for.
      if (err instanceof ArrApiError && err.status === 404) return;
      throw err;
    }
  }

  /**
   * Push an import through by hand. The ManualImport command skips the arr's
   * own checks, so a candidate is sent only when every rejection on it
   * restates `despite`, the reason being overridden. Returns how many files
   * were submitted.
   */
  async manualImport(downloadId: string, despite?: string): Promise<number> {
    const candidates =
      (await this.call<ArrManualImportCandidate[]>('manualimport', {
        query: { downloadId, filterExistingFiles: 'false' },
      })) ?? [];
    const tolerated = despite?.toLowerCase();
    const files = candidates
      .filter((c) =>
        (c.rejections ?? []).every(
          (r) =>
            tolerated !== undefined &&
            (r.reason ?? '').toLowerCase().includes(tolerated)
        )
      )
      .filter((c) =>
        this.instance.type === 'radarr'
          ? c.movie?.id !== undefined
          : c.series?.id !== undefined && (c.episodes ?? []).length > 0
      )
      .map((c) => ({
        path: c.path,
        folderName: c.folderName,
        downloadId,
        ...(this.instance.type === 'radarr'
          ? { movieId: c.movie?.id }
          : {
              seriesId: c.series?.id,
              seasonNumber: c.seasonNumber,
              episodeIds: (c.episodes ?? []).map((e) => e.id),
            }),
        quality: c.quality,
        languages: c.languages,
        releaseGroup: c.releaseGroup,
        indexerFlags: c.indexerFlags,
        releaseType: c.releaseType,
      }));
    if (files.length === 0) return 0;
    await this.command('ManualImport', { files, importMode: 'copy' });
    return files.length;
  }
}

/** Parent id (movieId / seriesId) a history record belongs to. */
export function parentIdOf(
  record: ArrHistoryRecord,
  type: ArrInstance['type']
): number | undefined {
  return type === 'radarr' ? record.movieId : record.seriesId;
}

/**
 * The movie or episode a repair is counted against, not the series. A pack
 * grab records one history row per episode, so the id has to be chosen
 * deterministically: the lowest episode id in the grab set is stable for any
 * release covering the same episodes.
 */
export function repairTargetOf(
  records: ArrHistoryRecord[],
  type: ArrInstance['type']
): number | undefined {
  const grabs = records.filter((r) => r.eventType === 'grabbed');
  if (grabs.length === 0) return undefined;
  if (type === 'radarr') return grabs[0].movieId;
  const episodeIds = grabs
    .map((r) => r.episodeId)
    .filter((id): id is number => id !== undefined);
  if (episodeIds.length > 0) return Math.min(...episodeIds);
  return grabs[0].seriesId;
}

/** Log-and-swallow wrapper for best-effort calls (nudges, not verdicts). */
export async function bestEffort(
  what: string,
  fn: () => Promise<unknown>
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.debug({ err: (err as Error)?.message }, `${what} failed`);
  }
}
