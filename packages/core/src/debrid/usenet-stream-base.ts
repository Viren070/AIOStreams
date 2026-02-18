import {
  Env,
  ServiceId,
  createLogger,
  getTimeTakenSincePoint,
  maskSensitiveInfo,
  Cache,
  DistributedLock,
  fromUrlSafeBase64,
  formatZodError,
} from '../utils/index.js';
import { isVideoFile, selectFileInTorrentOrNZB } from './utils.js';
import {
  DebridServiceConfig,
  DebridDownload,
  PlaybackInfo,
  DebridError,
  DebridFile,
  UsenetDebridService,
} from './base.js';
import { ParsedResult, parseTorrentTitle } from '@viren070/parse-torrent-title';
import z, { ZodError } from 'zod';
import { createClient, WebDAVClient, FileStat } from 'webdav';
import { fetch } from 'undici';
import { BuiltinProxy } from '../proxy/builtin.js';
import { basename } from 'path';
import { Logger } from 'winston';

// Zod schemas for SABnzbd-compatible API responses (used by streaming usenet services)
const AddUrlResponseSchema = z.object({
  status: z.boolean(),
  nzo_ids: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
});

const HistorySlotSchema = z.object({
  nzo_id: z.string(),
  status: z.string().optional(),
  name: z.string().optional(),
  category: z.string().optional(),
  storage: z.string().nullable().optional(),
  fail_message: z.string().optional(),
});

const HistoryResponseSchema = z.object({
  status: z.boolean().optional(),
  history: z
    .object({
      slots: z.array(HistorySlotSchema),
    })
    .optional(),
  error: z.string().nullable().optional(),
});

// Transform API responses to camelCase
const transformAddUrlResponse = (
  data: z.infer<typeof AddUrlResponseSchema>
) => ({
  status: data.status,
  nzoIds: data.nzo_ids,
  error: data.error,
});

const transformHistorySlot = (slot: z.infer<typeof HistorySlotSchema>) => ({
  nzoId: slot.nzo_id,
  status: slot.status?.toLowerCase(),
  name: slot.name,
  category: slot.category,
  storage: slot.storage,
  failMessage: slot.fail_message,
});

const transformHistoryResponse = (
  data: z.infer<typeof HistoryResponseSchema>
) => ({
  status: data.status,
  history: {
    slots: data.history?.slots.map(transformHistorySlot) ?? [],
  },
  error: data.error,
});

const convertStatusCodeToError = (code: number): DebridError['code'] => {
  switch (code) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'TOO_MANY_REQUESTS';
    case 500:
      return 'INTERNAL_SERVER_ERROR';
    case 501:
      return 'NOT_IMPLEMENTED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'UNKNOWN';
  }
};

/**
 * API client for SABnzbd APIs
 */
export class SABnzbdApi {
  private readonly logger: Logger;
  constructor(
    protected readonly apiUrl: string,
    protected readonly apiKey: string,
    protected readonly serviceName: string,
    logger: Logger
  ) {
    this.logger = logger;
  }

  protected async request<T extends z.ZodType>(
    params: Record<
      string,
      string | undefined | number | boolean | null | string[]
    >,
    schema: T,
    timeoutMs: number = 80000
  ): Promise<{
    data: z.infer<T>;
    statusCode: number;
    statusText: string;
    headers: Record<string, string>;
  }> {
    const url = new URL(this.apiUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (!value) return;
      const val = Array.isArray(value) ? value.join(',') : String(value);
      url.searchParams.append(key, val);
    });

    this.logger.debug(`Making ${this.serviceName} API request`, {
      ...params,
      apikey: maskSensitiveInfo(this.apiKey),
      fullUrl: maskSensitiveInfo(url.toString()),
    });

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
        },
        signal: AbortSignal.timeout(timeoutMs),
        // redirect: 'manual',
      });
      let data;

      try {
        data = await response.json();
      } catch (error) {
        if (!response.ok) {
          throw new DebridError(
            `${this.serviceName} API error: ${response.statusText}`,
            {
              statusCode: response.status,
              statusText: response.statusText,
              code: convertStatusCodeToError(response.status),
              headers: Object.fromEntries(response.headers.entries()),
              body: null,
              type: 'api_error',
            }
          );
        }
      }

      try {
        const parsed = schema.parse(data);
        return {
          data: parsed,
          statusCode: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
        };
      } catch (error) {
        if (!response.ok) {
          throw new DebridError(
            `${this.serviceName} API error: ${response.statusText}`,
            {
              statusCode: response.status,
              statusText: response.statusText,
              code: convertStatusCodeToError(response.status),
              headers: Object.fromEntries(response.headers.entries()),
              body: data,
              type: 'api_error',
            }
          );
        }

        if (error instanceof ZodError) {
          this.logger.error(
            `Failed to parse ${this.serviceName} API response: ${formatZodError(error)}`
          );
          throw new DebridError(`Invalid ${this.serviceName} API response`, {
            statusCode: response.status,
            statusText: response.statusText,
            code: 'UNKNOWN',
            headers: Object.fromEntries(response.headers.entries()),
            body: JSON.stringify(data),
            type: 'api_error',
          });
        }

        throw new DebridError(`Invalid ${this.serviceName} API response`, {
          statusCode: response.status,
          statusText: response.statusText,
          code: 'UNKNOWN',
          headers: Object.fromEntries(response.headers.entries()),
          body: data,
          type: 'api_error',
        });
      }
    } catch (error) {
      if (error instanceof DebridError) {
        throw error;
      }

      if (
        (error as Error).name === 'AbortError' ||
        (error as Error).name === 'TimeoutError'
      ) {
        throw new DebridError('Request timeout', {
          statusCode: 504,
          statusText: 'Gateway Timeout',
          code: 'UNKNOWN',
          headers: {},
          body: null,
          type: 'api_error',
          cause: error,
        });
      }

      throw new DebridError(`Request failed: ${(error as Error).message}`, {
        statusCode: 500,
        statusText: 'Internal Server Error',
        code: 'UNKNOWN',
        headers: {},
        body: error,
        type: 'api_error',
        cause: error,
      });
    }
  }

  async addUrl(
    nzbUrl: string,
    category: string,
    jobLabel: string
  ): Promise<{ nzoId: string }> {
    const params = {
      mode: 'addurl',
      apikey: this.apiKey,
      name: nzbUrl,
      cat: category,
      nzbname: jobLabel,
      output: 'json',
    };

    const {
      data: parsed,
      statusCode,
      statusText,
      headers,
    } = await this.request(params, AddUrlResponseSchema, 80000);
    const transformed = transformAddUrlResponse(parsed);

    if (!transformed.status) {
      throw new DebridError(
        `Failed to queue NZB: ${transformed.error || 'Unknown error'}`,
        {
          statusCode,
          statusText,
          code: convertStatusCodeToError(statusCode),
          headers,
          body: parsed,
          type: 'api_error',
        }
      );
    }

    const nzoId = transformed.nzoIds?.[0];
    if (!nzoId) {
      throw new DebridError('addurl succeeded but no nzo_id returned', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'UNKNOWN',
        headers: {},
        body: parsed,
        type: 'api_error',
      });
    }

    this.logger.debug(`NZB job successfully added`, {
      nzoId,
    });
    return { nzoId };
  }

  async history(
    params: {
      start?: number;
      limit?: number;
      nzoIds?: string[];
      category?: string;
    } = {}
  ) {
    const tParams = {
      mode: 'history',
      apikey: this.apiKey,
      start: params.start,
      limit: params.limit,
      nzo_ids: params.nzoIds ? params.nzoIds.join(',') : undefined,
      category: params.category,
    };

    const {
      data: parsed,
      statusCode,
      statusText,
      headers,
    } = await this.request(tParams, HistoryResponseSchema, 60000);
    const transformed = transformHistoryResponse(parsed);

    if (transformed.status === false || !transformed.history) {
      throw new DebridError(
        `Failed to query history: ${transformed.error || 'Unknown error'}`,
        {
          statusCode,
          statusText,
          code: convertStatusCodeToError(statusCode),
          headers,
          body: JSON.stringify(parsed),
          type: 'api_error',
        }
      );
    }
    return transformed.history;
  }

  async waitForHistorySlot(
    nzoId: string,
    category: string,
    timeoutMs: number = 80000,
    pollIntervalMs: number = 2000
  ): Promise<ReturnType<typeof transformHistorySlot>> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const history = await this.history({
        nzoIds: [nzoId],
        category,
      });

      const slot = history.slots.find((entry) => entry.nzoId === nzoId);

      if (slot) {
        if (slot.status === 'completed') {
          return slot;
        }
        if (slot.status === 'failed') {
          const failMessage =
            slot.failMessage || `Unknown ${this.serviceName} error`;
          throw new DebridError(`NZB failed: ${failMessage}`, {
            statusCode: 400,
            statusText: 'Bad Request',
            code: 'UNKNOWN',
            headers: {},
            type: 'api_error',
          });
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new DebridError(
      'Timeout while waiting for NZB to become streamable',
      {
        statusCode: 504,
        statusText: 'Gateway Timeout',
        code: 'UNKNOWN',
        headers: {},
        body: { nzoId, category },
        type: 'api_error',
      }
    );
  }
}

/**
 * Configuration for streaming usenet services that use SABnzbd-compatible APIs
 */
export interface UsenetStreamServiceConfig {
  webdavUrl: string;
  publicWebdavUrl: string;
  webdavUser?: string;
  webdavPassword?: string;
  apiUrl: string;
  apiKey: string;
  aiostreamsAuth?: string;
}

enum Category {
  MOVIES = 'Movies',
  TV = 'TV',
  UNCATEGORIZED = 'uncategorized',
}
/**
 * Base class for streaming usenet services (NzbDAV, Altmount).
 * These services accept NZBs via a SABnzbd-compatible API and stream content
 * directly from usenet providers via WebDAV, rather than downloading to disk.
 */
export abstract class UsenetStreamService implements UsenetDebridService {
  protected readonly webdavClient: WebDAVClient;
  protected readonly api: SABnzbdApi;
  protected static resolveCache = Cache.getInstance<
    string,
    string | { message: string; code: DebridError['code'] }
  >('usenet-stream:link');
  protected static libraryCache = Cache.getInstance<string, DebridDownload[]>(
    'usenet-stream:library'
  );

  abstract readonly serviceName: ServiceId;

  protected readonly auth: UsenetStreamServiceConfig;
  protected readonly serviceLogger: Logger;
  protected static readonly MIN_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
  protected static readonly MAX_DEPTH = 6;

  /**
   * Get the content path prefix for this service
   * NzbDAV uses '/content', Altmount uses '/complete'
   */
  protected abstract getContentPathPrefix(): string;

  /**
   * Get the expected folder name for a given NZB URL
   * NzbDAV uses the filename parameter, Altmount uses basename of URL
   */
  protected abstract getExpectedFolderName(
    nzb: PlaybackInfo & { type: 'usenet' }
  ): string;

  constructor(
    protected readonly config: DebridServiceConfig,
    auth: UsenetStreamServiceConfig,
    serviceName: ServiceId
  ) {
    this.auth = auth;
    this.serviceLogger = createLogger(serviceName);
    this.webdavClient = createClient(auth.webdavUrl, {
      username: auth.webdavUser,
      password: auth.webdavPassword,
    });
    this.api = new SABnzbdApi(
      auth.apiUrl,
      auth.apiKey,
      serviceName,
      this.serviceLogger
    );
  }

  protected async collectFiles(
    path: string
  ): Promise<{ files: FileStat[]; depth: number }> {
    // First, try using deep mode (recursive)
    try {
      const contents = (await this.webdavClient.getDirectoryContents(path, {
        deep: true,
      })) as FileStat[];

      const files = contents.filter((item) => item.type === 'file');

      return { files, depth: 0 };
    } catch (error) {
      this.serviceLogger.warn(
        `Deep listing failed, falling back to manual traversal`,
        {
          path,
          error: (error as Error).message,
        }
      );
      // Fall back to manual traversal
      return this.collectFilesManually(path, 0);
    }
  }

  protected async collectFilesManually(
    path: string,
    currentDepth: number = 0
  ): Promise<{ files: FileStat[]; depth: number }> {
    if (currentDepth >= UsenetStreamService.MAX_DEPTH) {
      this.serviceLogger.warn(`Max depth reached at ${path}`);
      return { files: [], depth: currentDepth };
    }

    let contents: FileStat[];
    try {
      contents = (await this.webdavClient.getDirectoryContents(
        path
      )) as FileStat[];
    } catch (error: any) {
      const status = typeof error.status === 'number' ? error.status : 500;
      throw new DebridError(
        `Failed to list WebDAV directory: ${(error as Error).message}`,
        {
          statusCode: status,
          statusText: status
            ? error.message.match(/response: \d+ (.*)/)?.[1] ||
              'Internal Server Error'
            : 'Internal Server Error',
          code: convertStatusCodeToError(status),
          headers: {},
          type: 'api_error',
        }
      );
    }

    const files = contents.filter((item) => item.type === 'file');
    const directories = contents.filter((item) => item.type === 'directory');

    // Check if we should stop traversing based on criteria
    const hasVideoFile = files.some((file) => isVideoFile(file));
    const hasLargeFile = files.some(
      (file) => file.size >= UsenetStreamService.MIN_FILE_SIZE
    );

    // If we found video files or large files, we're in the right place
    if (hasVideoFile || hasLargeFile) {
      return { files, depth: currentDepth };
    }

    // If no directories exist, return the files we have
    if (directories.length === 0) {
      return { files, depth: currentDepth };
    }

    // Otherwise, recurse into subdirectories
    const allFiles: FileStat[] = [...files];

    for (const dir of directories) {
      const { files: subFiles } = await this.collectFilesManually(
        dir.filename,
        currentDepth + 1
      );
      currentDepth = currentDepth + 1;
      allFiles.push(...subFiles);

      // If we found video files or large files in a subdirectory, stop searching other directories
      const hasVideoInSub = subFiles.some((file) => isVideoFile(file));
      const hasLargeInSub = subFiles.some(
        (file) => file.size >= UsenetStreamService.MIN_FILE_SIZE
      );

      if (hasVideoInSub || hasLargeInSub) {
        break;
      }
    }

    return { files: allFiles, depth: currentDepth };
  }

  /**
   * Get a specific NZB item by its folder name (serviceItemId).
   * Lists files within the folder via WebDAV to populate the files array.
   */
  public async getNzb(nzbId: string): Promise<DebridDownload> {
    // nzbId is the folder basename (used as serviceItemId)
    for (const category of [
      Category.UNCATEGORIZED,
      Category.TV,
      Category.MOVIES,
    ]) {
      const contentPath = `${this.getContentPathPrefix()}/${category}/${nzbId}`;
      try {
        const stat = await this.webdavClient.stat(contentPath);
        const statData = 'data' in stat ? stat.data : stat;
        if (statData.type === 'directory') {
          const { files: allFiles } = await this.collectFiles(contentPath);
          const debridFiles: DebridFile[] = allFiles.map((file, index) => ({
            id: index,
            name: file.basename,
            size: file.size,
            path: file.filename,
            index,
          }));

          return {
            id: nzbId,
            name: nzbId,
            hash: nzbId,
            status: 'downloaded',
            size: debridFiles.reduce((sum, f) => sum + f.size, 0),
            files: debridFiles,
          };
        }
      } catch {
        // Not found in this category, try next
      }
    }

    throw new DebridError(`NZB item not found: ${nzbId}`, {
      statusCode: 404,
      statusText: 'Not found',
      code: 'NOT_FOUND',
      headers: {},
      body: { nzbId },
      type: 'api_error',
    });
  }

  private async listWebdavFolders(path: string): Promise<FileStat[]> {
    let contents: FileStat[];
    const start = Date.now();
    try {
      contents = (await this.webdavClient.getDirectoryContents(
        path
      )) as FileStat[];
    } catch (error: any) {
      const status = typeof error.status === 'number' ? error.status : 500;
      throw new DebridError(
        `Failed to list WebDAV directory: ${(error as Error).message}`,
        {
          statusCode: status,
          statusText: status
            ? error.message.match(/response: \d+ (.*)/)?.[1] ||
              'Internal Server Error'
            : 'Internal Server Error',
          code: convertStatusCodeToError(status),
          headers: {},
          type: 'api_error',
        }
      );
    }
    const directories = contents.filter((item) => item.type === 'directory');
    this.serviceLogger.debug(`Listed WebDAV folders at ${path}`, {
      count: directories.length,
      time: getTimeTakenSincePoint(start),
    });
    return directories;
  }

  public async listNzbs(): Promise<DebridDownload[]> {
    const cacheKey = `${this.serviceName}:${this.config.token}`;

    // Check for stale cache before acquiring the lock
    const cached = await UsenetStreamService.libraryCache.get(cacheKey);
    if (cached) {
      const remainingTTL =
        await UsenetStreamService.libraryCache.getTTL(cacheKey);
      if (remainingTTL !== null && remainingTTL > 0) {
        const age = Env.BUILTIN_DEBRID_LIBRARY_CACHE_TTL - remainingTTL;
        if (age > Env.BUILTIN_DEBRID_LIBRARY_STALE_THRESHOLD) {
          this.serviceLogger.debug(
            `Library cache for ${this.serviceName} is stale (age: ${age}s), triggering background refresh`
          );
          this.refreshNzbsInBackground(cacheKey).catch((err) =>
            this.serviceLogger.error(
              `Background library refresh failed for ${this.serviceName}`,
              err
            )
          );
        }
        return cached;
      }
    }

    const { result } = await DistributedLock.getInstance().withLock(
      `uss:library:${cacheKey}`,
      async () => {
        const cachedNzbs = await UsenetStreamService.libraryCache.get(cacheKey);
        if (cachedNzbs) {
          this.serviceLogger.debug(
            `Using cached NZB list for ${this.serviceName}`
          );
          return cachedNzbs;
        }

        return this.fetchAndCacheNzbs(cacheKey);
      },
      {
        type: 'memory',
        timeout: 5000,
      }
    );
    return result;
  }

  private async fetchAndCacheNzbs(cacheKey: string): Promise<DebridDownload[]> {
    const start = Date.now();

    const historyPromise = this.api.history({ limit: 1000 });
    const webdavTvPromise = this.listWebdavFolders(
      `${this.getContentPathPrefix()}/${Category.TV}`
    );
    const webdavMoviesPromise = this.listWebdavFolders(
      `${this.getContentPathPrefix()}/${Category.MOVIES}`
    );
    const webdavUncategorizedPromise = this.listWebdavFolders(
      `${this.getContentPathPrefix()}/${Category.UNCATEGORIZED}`
    );

    const [history, webdavTv, webdavMovies, webdavUncategorized] =
      await Promise.allSettled([
        historyPromise,
        webdavTvPromise,
        webdavMoviesPromise,
        webdavUncategorizedPromise,
      ]);

    if (history.status === 'rejected') {
      throw history.reason;
    }

    if (
      webdavTv.status === 'rejected' ||
      webdavMovies.status === 'rejected' ||
      webdavUncategorized.status === 'rejected'
    ) {
      const error =
        webdavTv.status === 'rejected'
          ? webdavTv.reason
          : webdavMovies.status === 'rejected'
            ? webdavMovies.reason
            : webdavUncategorized.status === 'rejected'
              ? webdavUncategorized.reason
              : null;

      const status = typeof error.status === 'number' ? error.status : 500;
      if (status === 401) {
        throw new DebridError(`Could not access WebDAV: Unauthorized`, {
          statusCode: 401,
          statusText: 'Unauthorized',
          code: 'UNAUTHORIZED',
          headers: {},
          body: null,
          type: 'api_error',
        });
      }

      this.serviceLogger.warn(
        `Failed to list WebDAV folders, library listing may be inaccurate`,
        {
          error: (error as Error).message,
        }
      );
    }

    const historyData = history.status === 'fulfilled' ? history.value : null;
    const webdavTvData =
      webdavTv.status === 'fulfilled' ? webdavTv.value : null;
    const webdavMoviesData =
      webdavMovies.status === 'fulfilled' ? webdavMovies.value : null;
    const webdavUncategorizedData =
      webdavUncategorized.status === 'fulfilled'
        ? webdavUncategorized.value
        : null;

    const webdavFiles = [
      ...(webdavTvData ?? []),
      ...(webdavMoviesData ?? []),
      ...(webdavUncategorizedData ?? []),
    ];
    const nzbs: DebridDownload[] = webdavFiles.map((file, index) => {
      const matchingSlot = historyData?.slots.find(
        (slot) => slot.name === file.basename
      );
      return {
        id: file.basename,
        status: matchingSlot?.status !== 'failed' ? 'cached' : 'failed',
        name: file.basename,
        size: file.size,
        hash: file.basename,
        addedAt: file.lastmod ?? undefined,
        files: [],
      };
    });

    this.serviceLogger.debug(`Listed NZBs from combined history and WebDAV`, {
      count: nzbs.length,
      time: getTimeTakenSincePoint(start),
    });
    await UsenetStreamService.libraryCache.set(
      cacheKey,
      nzbs,
      Env.BUILTIN_DEBRID_LIBRARY_CACHE_TTL,
      true
    );

    return nzbs;
  }

  private async refreshNzbsInBackground(cacheKey: string): Promise<void> {
    const lockKey = `uss:library:refresh:${cacheKey}`;
    await DistributedLock.getInstance().withLock(
      lockKey,
      async () => {
        await UsenetStreamService.libraryCache.delete(cacheKey);
        return this.fetchAndCacheNzbs(cacheKey);
      },
      { type: 'memory', timeout: 1000 }
    );
  }

  public async refreshLibraryCache(
    sources?: ('torrent' | 'nzb')[]
  ): Promise<void> {
    const cacheKey = `${this.serviceName}:${this.config.token}`;
    await UsenetStreamService.libraryCache.delete(cacheKey);
    await this.fetchAndCacheNzbs(cacheKey);
  }

  public async checkNzbs(
    nzbs: { name?: string; hash?: string }[],
    checkOwned: boolean = true
  ): Promise<DebridDownload[]> {
    // if aiostreamsAuth is present, validate it.
    if (this.auth.aiostreamsAuth) {
      try {
        BuiltinProxy.validateAuth(this.auth.aiostreamsAuth);
      } catch (error) {
        throw new DebridError('Invalid AIOStreams Proxy Auth', {
          statusCode: 401,
          statusText: 'Unauthorized',
          code: 'UNAUTHORIZED',
          headers: {},
          body: null,
          type: 'api_error',
        });
      }
    }
    let libraryNzbs: DebridDownload[] = [];

    try {
      libraryNzbs = checkOwned ? await this.listNzbs() : [];
    } catch (error) {
      this.serviceLogger.warn(`Failed to list library NZBs for checkNzbs`, {
        error: (error as Error).message,
      });
    }

    // All NZBs are "cached" since it's streaming-based
    return nzbs.map(({ hash: h, name: n }, index) => {
      const libraryNzb = libraryNzbs.find(
        (nzb) => nzb.name === n || nzb.name === h
      );
      return {
        id: index,
        status: libraryNzb?.status === 'failed' ? 'failed' : 'cached',
        library: !!libraryNzb,
        hash: h,
        name: n,
      };
    });
  }

  public async resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean
  ): Promise<string | undefined> {
    if (playbackInfo.type === 'torrent') {
      throw new Error('Unsupported operation');
    }
    const { result } = await DistributedLock.getInstance().withLock(
      `${this.serviceName}:resolve:${playbackInfo.hash}:${playbackInfo.nzb}:${playbackInfo.metadata?.season}:${playbackInfo.metadata?.episode}:${playbackInfo.metadata?.absoluteEpisode}:${filename}:${this.config.clientIp}:${this.config.token}`,
      () => this._resolve(playbackInfo, filename),
      {
        timeout: 120000,
        ttl: 130000,
      }
    );
    return result;
  }

  protected async _resolve(
    playbackInfo: PlaybackInfo & { type: 'usenet' },
    filename: string
  ): Promise<string | undefined> {
    const { nzb, metadata, hash } = playbackInfo;

    const cacheKey = `${this.serviceName}:${this.config.token}:${this.config.clientIp}:${JSON.stringify(playbackInfo)}`;

    const cachedResponse = await UsenetStreamService.resolveCache.get(cacheKey);

    if (cachedResponse) {
      this.serviceLogger.debug(
        `Using cached response for ${nzb}: ${typeof cachedResponse === 'string' ? 'stream URL' : 'error'}`
      );
      if (typeof cachedResponse === 'string') {
        return cachedResponse;
      }
      throw new DebridError(cachedResponse.message, {
        statusCode: 400,
        statusText: 'Bad Request',
        code: cachedResponse.code,
        headers: {},
        body: null,
        type: 'api_error',
      });
    }

    this.serviceLogger.debug(`Resolving NZB`, {
      hash,
      filename,
      nzbUrl: maskSensitiveInfo(nzb),
      serviceItemId: playbackInfo.serviceItemId,
      fileIndex: playbackInfo.fileIndex,
    });

    // For catalog items with serviceItemId, the serviceItemId IS the folder name (basename)
    // We need to search both TV and Movies categories to find it
    if (playbackInfo.serviceItemId && !nzb) {
      return this._resolveLibraryItem(playbackInfo, filename, cacheKey);
    }

    const category =
      metadata?.season || metadata?.episode ? Category.TV : Category.MOVIES;
    const expectedFolderName = this.getExpectedFolderName(playbackInfo);

    // Check if content already exists at the expected path
    const expectedContentPath = `${this.getContentPathPrefix()}/${category}/${expectedFolderName}`;
    let contentPath: string | undefined;
    let jobName: string | undefined;
    let jobCategory: string | undefined;
    let nzoId: string | undefined;
    let alreadyExists = false;

    try {
      const stat = await this.webdavClient.stat(expectedContentPath);
      const statData = 'data' in stat ? stat.data : stat;
      if (statData.type === 'directory') {
        alreadyExists = true;
        contentPath = expectedContentPath;
        jobName = expectedFolderName;
        jobCategory = category;
        this.serviceLogger.debug(`Content already exists`, {
          path: expectedContentPath,
        });
      }
    } catch (error: any) {
      // if error is a 401, rethrow as DebridError
      const status = typeof error.status === 'number' ? error.status : 500;
      if (status === 401) {
        throw new DebridError(`Could not access WebDAV: Unauthorized`, {
          statusCode: 401,
          statusText: 'Unauthorized',
          code: 'UNAUTHORIZED',
          headers: {},
          body: null,
          type: 'api_error',
          cause: error.message,
        });
      }
      this.serviceLogger.debug(`Content path does not exist, will add NZB`, {
        path: expectedContentPath,
        error: (error as Error).message,
      });
    }

    // Only add NZB if content doesn't already exist
    if (!alreadyExists) {
      const addResult = await this.api.addUrl(
        nzb,
        category,
        expectedFolderName
      );
      nzoId = addResult.nzoId;

      // Poll history until download is complete
      const pollStartTime = Date.now();
      let slot: ReturnType<typeof transformHistorySlot>;
      try {
        slot = await this.api.waitForHistorySlot(nzoId, category);
      } catch (error) {
        if (!(error instanceof DebridError)) {
          throw error;
        }
        UsenetStreamService.resolveCache.set(
          cacheKey,
          {
            message: error.message,
            code: error.code,
          },
          Env.BUILTIN_DEBRID_RESOLVE_ERROR_CACHE_TTL,
          true
        );
        throw error;
      }

      // Use slot.storage as source of truth for the content path
      jobName = slot.storage ? basename(slot.storage) : slot.name || filename;
      jobCategory = slot.category || category;
      contentPath = `${this.getContentPathPrefix()}/${jobCategory}/${jobName}`;

      this.serviceLogger.debug(`NZB download completed`, {
        nzoId,
        jobName,
        jobCategory,
        contentPath,
        time: getTimeTakenSincePoint(pollStartTime),
      });
    }

    // Ensure we have a content path
    if (!contentPath || !jobName || !jobCategory) {
      throw new DebridError('Failed to determine content path', {
        statusCode: 500,
        statusText: 'Internal Server Error',
        code: 'UNKNOWN',
        headers: {},
        body: { expectedContentPath, alreadyExists },
        type: 'api_error',
      });
    }

    // Get list of all files in the content folder recursively, stopping when we find video files
    const listStartTime = Date.now();

    const { files: allFiles, depth } = await this.collectFiles(contentPath);

    if (allFiles.length === 0) {
      throw new DebridError('No files found in NZB download', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: { contentPath },
        type: 'api_error',
      });
    }

    const debridFiles: DebridFile[] = allFiles.map((file, index) => ({
      id: index,
      name: file.basename,
      size: file.size,
      path: file.filename,
      index,
    }));

    this.serviceLogger.debug(`Collected files from path`, {
      nzoId,
      jobName,
      contentPath,
      depth,
      time: getTimeTakenSincePoint(listStartTime),
      count: debridFiles.length,
      files: debridFiles.map((f) => f.name),
    });

    const debridDownload: DebridDownload = {
      id: nzoId || `cached-${hash}`,
      hash,
      name: jobName,
      status: 'downloaded' as const,
      files: debridFiles,
    };

    let selectedFile;

    if (playbackInfo.fileIndex !== undefined) {
      // Direct file index specified (e.g. from catalog meta)
      selectedFile = debridFiles.find(
        (f) => f.index === playbackInfo.fileIndex
      );
      if (!selectedFile) {
        throw new DebridError(
          `File with index ${playbackInfo.fileIndex} not found`,
          {
            statusCode: 400,
            statusText: 'File not found',
            code: 'NO_MATCHING_FILE',
            headers: {},
            body: {
              fileIndex: playbackInfo.fileIndex,
              availableFiles: debridFiles.map((f) => f.index),
            },
            type: 'api_error',
          }
        );
      }
      this.serviceLogger.debug(`Using specified fileIndex`, {
        fileIndex: playbackInfo.fileIndex,
        fileName: selectedFile.name,
      });
    } else if (debridFiles.length === 1) {
      selectedFile = debridFiles[0];
    } else {
      // Parse all file names for matching
      const allStrings = [jobName, ...debridFiles.map((f) => f.name ?? '')];
      const parseResults: ParsedResult[] = allStrings.map((string) =>
        parseTorrentTitle(string)
      );
      const parsedFiles = new Map<string, ParsedResult>();
      for (const [index, result] of parseResults.entries()) {
        parsedFiles.set(allStrings[index], result);
      }

      const nzbInfo = {
        type: 'usenet' as const,
        nzb,
        hash,
        title: jobName,
        metadata,
        size: debridFiles.reduce((sum, f) => sum + f.size, 0),
      };

      // Select a file based on the available metadata and files
      selectedFile = await selectFileInTorrentOrNZB(
        nzbInfo,
        debridDownload,
        parsedFiles,
        metadata
      );
    }

    if (!selectedFile) {
      throw new DebridError('No matching file found', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: { availableFiles: debridFiles.map((f) => f.name) },
        type: 'api_error',
      });
    }

    this.serviceLogger.debug(`Selected file for playback`, {
      chosenFile: selectedFile.name,
      chosenPath: selectedFile.path,
      availableFiles: debridFiles.length,
    });

    const filePath = selectedFile.path || `${contentPath}/${selectedFile.name}`;
    const playbackLink = `${this.getPublicWebdavUrlWithAuth()}${filePath}`;

    this.serviceLogger.debug(`Generated playback link`, { playbackLink });

    // Cache the result
    await UsenetStreamService.resolveCache.set(
      cacheKey,
      playbackLink,
      Env.BUILTIN_DEBRID_PLAYBACK_LINK_CACHE_TTL,
      true
    );

    return playbackLink;
  }

  /**
   * Resolve a library item by serviceItemId (folder name) and optionally fileIndex.
   * For nzbdav/altmount, serviceItemId is the folder basename, and we search
   * both TV and Movies categories to find it.
   */
  protected async _resolveLibraryItem(
    playbackInfo: PlaybackInfo & { type: 'usenet' },
    filename: string,
    cacheKey: string
  ): Promise<string | undefined> {
    const folderName = playbackInfo.serviceItemId!;

    // Search both categories for the folder
    let contentPath: string | undefined;
    for (const category of [
      Category.UNCATEGORIZED,
      Category.TV,
      Category.MOVIES,
    ]) {
      const candidatePath = `${this.getContentPathPrefix()}/${category}/${folderName}`;
      try {
        const stat = await this.webdavClient.stat(candidatePath);
        const statData = 'data' in stat ? stat.data : stat;
        if (statData.type === 'directory') {
          contentPath = candidatePath;
          break;
        }
      } catch {
        // Not found in this category, try next
      }
    }

    if (!contentPath) {
      throw new DebridError(`Library item folder not found: ${folderName}`, {
        statusCode: 404,
        statusText: 'Not found',
        code: 'NOT_FOUND',
        headers: {},
        body: { folderName },
        type: 'api_error',
      });
    }

    this.serviceLogger.debug(`Found library item folder`, { contentPath });

    const { files: allFiles, depth } = await this.collectFiles(contentPath);

    if (allFiles.length === 0) {
      throw new DebridError('No files found in library item', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: { contentPath },
        type: 'api_error',
      });
    }

    const debridFiles: DebridFile[] = allFiles.map((file, index) => ({
      id: index,
      name: file.basename,
      size: file.size,
      path: file.filename,
      index,
    }));

    this.serviceLogger.debug(`Collected files from library item`, {
      contentPath,
      depth,
      count: debridFiles.length,
      files: debridFiles.map((f) => f.name),
    });

    let selectedFile: DebridFile | undefined;

    if (playbackInfo.fileIndex !== undefined) {
      // Direct file index specified from catalog
      selectedFile = debridFiles.find(
        (f) => f.index === playbackInfo.fileIndex
      );
      if (!selectedFile) {
        throw new DebridError(
          `File with index ${playbackInfo.fileIndex} not found`,
          {
            statusCode: 400,
            statusText: 'File not found',
            code: 'NO_MATCHING_FILE',
            headers: {},
            body: {
              fileIndex: playbackInfo.fileIndex,
              availableFiles: debridFiles.map((f) => f.index),
            },
            type: 'api_error',
          }
        );
      }
      this.serviceLogger.debug(`Using specified fileIndex for library item`, {
        fileIndex: playbackInfo.fileIndex,
        fileName: selectedFile.name,
      });
    } else if (debridFiles.length === 1) {
      selectedFile = debridFiles[0];
    } else {
      // Fallback: pick the largest video file
      const videoFiles = debridFiles.filter((f) => isVideoFile(f));
      if (videoFiles.length > 0) {
        selectedFile = videoFiles.reduce((a, b) => (a.size > b.size ? a : b));
      } else {
        selectedFile = debridFiles.reduce((a, b) => (a.size > b.size ? a : b));
      }
    }

    if (!selectedFile) {
      throw new DebridError('No matching file found in library item', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: { availableFiles: debridFiles.map((f) => f.name) },
        type: 'api_error',
      });
    }

    this.serviceLogger.debug(`Selected file from library item`, {
      chosenFile: selectedFile.name,
      chosenPath: selectedFile.path,
      availableFiles: debridFiles.length,
    });

    const filePath = selectedFile.path || `${contentPath}/${selectedFile.name}`;
    const playbackLink = `${this.getPublicWebdavUrlWithAuth()}${filePath}`;

    await UsenetStreamService.resolveCache.set(
      cacheKey,
      playbackLink,
      Env.BUILTIN_DEBRID_PLAYBACK_LINK_CACHE_TTL,
      true
    );

    return playbackLink;
  }

  protected getPublicWebdavUrlWithAuth(): string {
    let url = new URL(this.auth.publicWebdavUrl);
    if (this.auth.webdavUser && this.auth.webdavPassword) {
      url.username = encodeURIComponent(this.auth.webdavUser);
      url.password = encodeURIComponent(this.auth.webdavPassword);
    }
    return url.toString().replace(/\/+$/, ''); // Remove trailing slash
  }
}
