import {
  ServiceId,
  createLogger,
  Cache,
  DistributedLock,
  appConfig,
  getSimpleTextHash,
} from '../utils/index.js';
import { extractInfoHashFromMagnet } from '../parser/utils.js';
import { buildResolveKey, selectFileInTorrentOrNZB, Torrent } from './utils.js';
import {
  DebridServiceConfig,
  DebridDownload,
  DebridFile,
  PlaybackInfo,
  DebridError,
  TorrentDebridService,
  DebridFailureCache,
} from './base.js';
import FileParser from '../parser/file.js';
import parseTorrent, { Instance, toMagnetURI } from 'parse-torrent';

const logger = createLogger('debrid:torrin');

const TORRIN_DEFAULT_BASE_URL = 'https://api.torrin.app';

interface TorrinJobFile {
  name: string;
  size: number;
}

interface TorrinStreamUrl {
  file_name: string;
  direct_url?: string;
  signed_url: string;
}

interface TorrinJob {
  id: string;
  user_id?: string;
  info_hash: string;
  name?: string;
  magnet?: string;
  source: 'torrent' | 'usenet' | 'hoster';
  status:
    | 'pending'
    | 'queued'
    | 'processing'
    | 'complete'
    | 'cached'
    | 'failed';
  error?: string;
  file_size?: number;
  files?: TorrinJobFile[];
  stream_urls?: TorrinStreamUrl[];
  created_at?: string;
  updated_at?: string;
}

interface TorrinAvailabilityEntry {
  available: boolean;
  files?: { name?: string; size?: number }[];
}

type TorrinAvailabilityBatch = Record<string, TorrinAvailabilityEntry>;

/**
 * Translate a Torrin job status to AIOStreams' debrid download status.
 * `cached` and `complete` collapse to `downloaded` so the rest of the pipeline
 * treats both as immediately playable.
 */
function mapStatus(status: TorrinJob['status']): DebridDownload['status'] {
  switch (status) {
    case 'cached':
    case 'complete':
      return 'downloaded';
    case 'pending':
    case 'queued':
      return 'queued';
    case 'processing':
      return 'downloading';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

/**
 * Map HTTP status codes returned by api.torrin.app to a `DebridErrorCode`.
 * 429 collapses to `STORE_LIMIT_EXCEEDED` because Torrin returns it when the
 * caller's plan-based concurrent-slot cap is hit.
 */
function mapHttpToCode(status: number): DebridError['code'] {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 402:
      return 'PAYMENT_REQUIRED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 410:
      return 'GONE';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'STORE_LIMIT_EXCEEDED';
    case 502:
      return 'BAD_GATEWAY';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'UNKNOWN';
  }
}

/**
 * Convert a Torrin Job payload into the shared `DebridDownload` shape used by
 * the rest of AIOStreams' debrid pipeline.
 */
function jobToDownload(job: TorrinJob): DebridDownload {
  const files: DebridFile[] | undefined = job.files?.map((file, index) => ({
    name: file.name,
    size: file.size,
    index,
  }));

  return {
    id: job.id,
    hash: job.info_hash,
    name: job.name ?? job.info_hash,
    size: job.file_size,
    addedAt: job.created_at,
    status: mapStatus(job.status),
    files,
  };
}

export interface TorrinServiceOptions {
  pollInterval?: number;
  maxWaitTime?: number;
  baseUrl?: string;
}

/**
 * Native `TorrentDebridService` for [Torrin](https://torrin.app), an
 * open-source debrid that returns pre-signed HTTPS streaming URLs for cached
 * torrents and queues new magnets server-side. Talks directly to
 * `api.torrin.app`; does not route through StremThru.
 */
export class TorrinDebridService implements TorrentDebridService {
  public readonly serviceName: ServiceId = 'torrin';
  public readonly capabilities = { torrents: true, usenet: false } as const;

  private readonly token: string;
  private readonly clientIp?: string;
  private readonly baseUrl: string;
  private readonly pollInterval: number;
  private readonly maxWaitTime: number;

  private static availabilityCache = Cache.getInstance<
    string,
    TorrinAvailabilityEntry
  >('torrin:avail', 5_000, appConfig.bootstrap.redisUri ? 'redis' : 'sql');

  private static playbackLinkCache = Cache.getInstance<string, string | null>(
    'torrin:link',
    5_000,
    appConfig.bootstrap.redisUri ? 'redis' : 'sql'
  );

  /**
   * @param config Token (the user's `tr_…` API key) and optional client IP.
   * @param opts Per-call overrides for the polling interval, max wait time,
   *             and base URL (the last lets self-hosters point at a private
   *             Torrin instance instead of the public api.torrin.app).
   * @throws DebridError with `UNAUTHORIZED` if the token is missing.
   */
  constructor(config: DebridServiceConfig, opts?: TorrinServiceOptions) {
    if (!config.token) {
      throw new DebridError('Missing Torrin API key', {
        statusCode: 401,
        statusText: 'Unauthorized',
        code: 'UNAUTHORIZED',
        headers: {},
        body: null,
        type: 'api_error',
      });
    }
    this.token = config.token;
    this.clientIp = config.clientIp;
    this.baseUrl = (opts?.baseUrl ?? TORRIN_DEFAULT_BASE_URL).replace(
      /\/+$/,
      ''
    );
    this.pollInterval = opts?.pollInterval ?? 10_000;
    this.maxWaitTime = opts?.maxWaitTime ?? 120_000;
  }

  /**
   * Issue a request against api.torrin.app with bearer auth + client-IP
   * forwarding, and translate any non-2xx response into a `DebridError` so
   * callers can rely on a single error type.
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<{ status: number; data: T }> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.clientIp) {
      headers['X-Forwarded-For'] = this.clientIp;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new DebridError(
        `Torrin request failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          statusCode: 502,
          statusText: 'Bad Gateway',
          code: 'BAD_GATEWAY',
          headers: {},
          body: null,
          cause: error,
          type: 'upstream_error',
        }
      );
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const message =
        (typeof parsed === 'object' &&
          parsed !== null &&
          'error' in (parsed as Record<string, unknown>) &&
          typeof (parsed as { error: unknown }).error === 'string' &&
          (parsed as { error: string }).error) ||
        response.statusText ||
        'Unknown error';
      throw new DebridError(`Torrin: ${message}`, {
        statusCode: response.status,
        statusText: response.statusText || 'Unknown error',
        code: mapHttpToCode(response.status),
        headers: Object.fromEntries(response.headers.entries()),
        body: parsed,
        type: 'api_error',
      });
    }

    return { status: response.status, data: parsed as T };
  }

  /**
   * Batch availability check via `POST /api/availability`. Hashes already
   * cached for this credential (positive or negative) skip the network round
   * trip; the rest are persisted into the per-credential availability cache
   * before being returned. Only `available: true` entries become results.
   */
  public async checkMagnets(
    magnets: string[],
    _sid?: string,
    _checkOwned: boolean = true
  ): Promise<DebridDownload[]> {
    if (!magnets.length) return [];

    const items = magnets
      .map((magnet) => ({ magnet, hash: extractInfoHashFromMagnet(magnet) }))
      .filter(
        (item): item is { magnet: string; hash: string } => item.hash != null
      );

    if (!items.length) return [];

    const credentialKey = getSimpleTextHash(this.token);
    const results: DebridDownload[] = [];
    const toFetch: typeof items = [];

    for (const item of items) {
      const cacheKey = `${credentialKey}:${item.hash}`;
      const cached = await TorrinDebridService.availabilityCache.get(cacheKey);
      if (cached) {
        if (cached.available) {
          results.push(this.entryToDownload(item.hash, cached));
        }
      } else {
        toFetch.push(item);
      }
    }

    if (toFetch.length) {
      const hashes = toFetch.map((i) => i.hash);
      const { data } = await this.request<TorrinAvailabilityBatch>(
        'POST',
        '/api/availability',
        { hashes }
      );

      for (const item of toFetch) {
        const entry = data?.[item.hash] ?? { available: false };
        await TorrinDebridService.availabilityCache.set(
          `${credentialKey}:${item.hash}`,
          entry,
          appConfig.builtins.debrid.errorCacheTtl
        );
        if (entry.available) {
          results.push(this.entryToDownload(item.hash, entry));
        }
      }
    }

    return results;
  }

  /**
   * Lift an availability-cache entry into a `DebridDownload` so cached hashes
   * can be returned from `checkMagnets` without ever calling `/api/jobs`.
   */
  private entryToDownload(
    hash: string,
    entry: TorrinAvailabilityEntry
  ): DebridDownload {
    return {
      id: hash,
      hash,
      status: 'cached',
      files: entry.files?.map((f, index) => ({
        name: f.name,
        size: f.size ?? 0,
        index,
      })),
    };
  }

  /**
   * Submit a magnet URI via `POST /api/jobs`. Torrin returns 200 with the
   * already-cached job, or 202 with a downloading job that must be polled.
   * Either way we surface the resulting `DebridDownload`.
   */
  public async addMagnet(magnet: string): Promise<DebridDownload> {
    const { data } = await this.request<TorrinJob>('POST', '/api/jobs', {
      magnet,
    });
    return jobToDownload(data);
  }

  /**
   * Accept a magnet URI, an HTTPS URL to a `.torrent` file, or a base64
   * `.torrent` payload, normalise it to a magnet URI via `parse-torrent`, and
   * forward to `addMagnet`. Torrin's `POST /api/jobs` only takes magnets, so
   * non-magnet inputs are converted client-side before submission.
   */
  public async addTorrent(torrent: string): Promise<DebridDownload> {
    const magnet = await this.toMagnetUri(torrent);
    return this.addMagnet(magnet);
  }

  /**
   * Resolve any of the inputs supported by `addTorrent` into a magnet URI:
   * pass-through for magnets, fetch + decode for `http(s)://…/file.torrent`,
   * base64-decode for raw `.torrent` payloads. Errors are mapped to
   * `DebridError` so callers can rely on the shared error contract.
   */
  private async toMagnetUri(torrent: string): Promise<string> {
    if (typeof torrent === 'string' && /^(stream-)?magnet:/i.test(torrent)) {
      return torrent;
    }

    let buffer: Buffer;
    if (/^https?:\/\//i.test(torrent)) {
      const headers: Record<string, string> = { Accept: '*/*' };
      if (this.clientIp) headers['X-Forwarded-For'] = this.clientIp;

      let response: Response;
      try {
        response = await fetch(torrent, { headers });
      } catch (error) {
        throw new DebridError(
          `Failed to fetch torrent file: ${error instanceof Error ? error.message : String(error)}`,
          {
            statusCode: 502,
            statusText: 'Bad Gateway',
            code: 'BAD_GATEWAY',
            headers: {},
            body: null,
            cause: error,
            type: 'upstream_error',
          }
        );
      }
      if (!response.ok) {
        throw new DebridError(
          `Failed to fetch torrent file: ${response.status} ${response.statusText}`,
          {
            statusCode: response.status,
            statusText: response.statusText || 'Unknown error',
            code: mapHttpToCode(response.status),
            headers: Object.fromEntries(response.headers.entries()),
            body: null,
            type: 'upstream_error',
          }
        );
      }
      buffer = Buffer.from(await response.arrayBuffer());
    } else {
      try {
        buffer = Buffer.from(torrent, 'base64');
      } catch (error) {
        throw new DebridError('Could not decode torrent payload', {
          statusCode: 400,
          statusText: 'Bad Request',
          code: 'BAD_REQUEST',
          headers: {},
          body: null,
          cause: error,
          type: 'api_error',
        });
      }
    }

    let parsed: Instance;
    try {
      parsed = await (parseTorrent(buffer) as unknown as Promise<Instance>);
    } catch (error) {
      throw new DebridError(
        `Invalid .torrent file: ${error instanceof Error ? error.message : String(error)}`,
        {
          statusCode: 400,
          statusText: 'Bad Request',
          code: 'BAD_REQUEST',
          headers: {},
          body: null,
          cause: error,
          type: 'api_error',
        }
      );
    }

    if (!parsed.infoHash) {
      throw new DebridError('Parsed .torrent has no infoHash', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'BAD_REQUEST',
        headers: {},
        body: null,
        type: 'api_error',
      });
    }

    return toMagnetURI(parsed);
  }

  /** Fetch a single Torrin job by id via `GET /api/jobs/{id}`. */
  public async getMagnet(magnetId: string): Promise<DebridDownload> {
    const { data } = await this.request<TorrinJob>(
      'GET',
      `/api/jobs/${encodeURIComponent(magnetId)}`
    );
    return jobToDownload(data);
  }

  /** List all Torrin jobs owned by this credential via `GET /api/jobs`. */
  public async listMagnets(): Promise<DebridDownload[]> {
    const { data } = await this.request<TorrinJob[]>('GET', '/api/jobs');
    return (data ?? []).map(jobToDownload);
  }

  /** Delete a Torrin job by id via `DELETE /api/jobs/{id}`. */
  public async removeMagnet(magnetId: string): Promise<void> {
    await this.request<unknown>(
      'DELETE',
      `/api/jobs/${encodeURIComponent(magnetId)}`
    );
  }

  /**
   * Pass-through: Torrin already returns playable, pre-signed HTTPS URLs in
   * `Job.stream_urls[].signed_url`, so there's no separate "unrestrict" step
   * the way other debrids have. Implemented to satisfy the interface.
   */
  public async generateTorrentLink(
    link: string,
    _clientIp?: string
  ): Promise<string> {
    return link;
  }

  /**
   * Resolve `playbackInfo` into a final, playable Torrin signed URL. Wraps
   * `_resolve` in a `DistributedLock` so concurrent requests for the same
   * `(credential, hash, fileIndex, …)` coalesce into one upstream call.
   */
  public async resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean,
    autoRemoveDownloads?: boolean
  ): Promise<string | undefined> {
    if (playbackInfo.type !== 'torrent') {
      throw new DebridError('Torrin does not support usenet playback', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'BAD_REQUEST',
        headers: {},
        body: null,
        type: 'api_error',
      });
    }

    const { result } = await DistributedLock.getInstance().withLock(
      buildResolveKey(
        'torrin:lock',
        this.serviceName,
        playbackInfo,
        filename,
        this.token,
        this.clientIp,
        { cacheAndPlay, autoRemoveDownloads }
      ),
      () =>
        this._resolve(
          playbackInfo,
          filename,
          cacheAndPlay,
          autoRemoveDownloads
        ),
      {
        timeout: cacheAndPlay ? this.maxWaitTime + this.pollInterval : 30_000,
        ttl: cacheAndPlay
          ? this.maxWaitTime + this.pollInterval + 10_000
          : 40_000,
      }
    );
    return result;
  }

  /**
   * The actual resolve pipeline, called inside the distributed lock:
   *  1. consult the playback link cache and the cross-service failure cache,
   *  2. submit the magnet to Torrin,
   *  3. when not yet downloaded and `cacheAndPlay` is true, poll until the
   *     job completes or `maxWaitTime` elapses,
   *  4. select the right file via `selectFileInTorrentOrNZB`,
   *  5. return the matching `signed_url` (and optionally auto-remove the
   *     job for one-shot adds).
   */
  private async _resolve(
    playbackInfo: PlaybackInfo & { type: 'torrent' },
    filename: string,
    cacheAndPlay: boolean,
    autoRemoveDownloads?: boolean
  ): Promise<string | undefined> {
    const { hash, metadata } = playbackInfo;
    const cacheKey = buildResolveKey(
      'torrin:cache',
      this.serviceName,
      playbackInfo,
      filename,
      this.token,
      this.clientIp
    );

    const cachedLink =
      await TorrinDebridService.playbackLinkCache.get(cacheKey);
    if (cachedLink !== undefined) {
      if (cachedLink === null) {
        if (!cacheAndPlay) return undefined;
      } else {
        return cachedLink;
      }
    }

    await DebridFailureCache.check(this.serviceName, 'torrent', hash);

    const magnet =
      playbackInfo.downloadUrl ??
      `magnet:?xt=urn:btih:${hash}` +
        (playbackInfo.sources?.length
          ? '&' +
            playbackInfo.sources
              .map((t) => `tr=${encodeURIComponent(t)}`)
              .join('&')
          : '');

    let job: DebridDownload;
    try {
      job = await this.addMagnet(magnet);
    } catch (error) {
      if (error instanceof DebridError) {
        await DebridFailureCache.mark(this.serviceName, 'torrent', hash, error);
      }
      throw error;
    }

    if (job.status !== 'downloaded') {
      TorrinDebridService.playbackLinkCache.set(cacheKey, null, 60);
      if (!cacheAndPlay) return undefined;

      const start = Date.now();
      while (Date.now() - start < this.maxWaitTime) {
        await new Promise((r) => setTimeout(r, this.pollInterval));
        const updated = await this.getMagnet(job.id.toString());
        if (updated.status === 'downloaded') {
          job = updated;
          break;
        }
        if (updated.status === 'failed') {
          throw new DebridError('Torrin job failed during download', {
            statusCode: 502,
            statusText: 'Bad Gateway',
            code: 'BAD_GATEWAY',
            headers: {},
            body: null,
            type: 'upstream_error',
          });
        }
      }

      if (job.status !== 'downloaded') {
        return undefined;
      }
    }

    const detail = await this.getRawJob(job.id.toString());
    const streamUrls = detail.stream_urls ?? [];
    if (!streamUrls.length) {
      throw new DebridError('Torrin job has no streamable files', {
        statusCode: 404,
        statusText: 'Not Found',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: null,
        type: 'api_error',
      });
    }

    const torrent: Torrent = {
      title: detail.name ?? filename,
      size: detail.file_size ?? 0,
      sources: [],
      hash,
      type: 'torrent',
    };

    const parsedFiles = new Map(
      (detail.files ?? []).map((f) => [f.name, FileParser.parse(f.name)])
    );

    const selected = await selectFileInTorrentOrNZB(
      torrent,
      jobToDownload(detail),
      parsedFiles,
      metadata
    );

    if (!selected || selected.index === undefined || selected.index < 0) {
      logger.debug(
        `No file selection match for ${filename}; falling back to first stream URL`
      );
      const url = streamUrls[0].signed_url;
      TorrinDebridService.playbackLinkCache.set(
        cacheKey,
        url,
        appConfig.builtins.debrid.errorCacheTtl
      );
      return url;
    }

    const selectedName =
      detail.files?.[selected.index]?.name ?? selected.name ?? '';
    const match =
      streamUrls.find((s) => s.file_name === selectedName) ?? streamUrls[0];
    const url = match.signed_url;

    if (autoRemoveDownloads && detail.source !== 'torrent') {
      // never auto-remove cached/library entries; only one-shot adds
      try {
        await this.removeMagnet(job.id.toString());
      } catch (error) {
        logger.warn(
          `Torrin auto-remove failed for ${job.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    TorrinDebridService.playbackLinkCache.set(
      cacheKey,
      url,
      appConfig.builtins.debrid.errorCacheTtl
    );
    return url;
  }

  /**
   * Fetch a Torrin job and return the raw `TorrinJob` shape (including
   * `stream_urls`), bypassing the `jobToDownload` projection used elsewhere.
   * Needed during `_resolve` to access pre-signed URLs after polling completes.
   */
  private async getRawJob(id: string): Promise<TorrinJob> {
    const { data } = await this.request<TorrinJob>(
      'GET',
      `/api/jobs/${encodeURIComponent(id)}`
    );
    return data;
  }
}
