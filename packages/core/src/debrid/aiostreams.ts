import {
  appConfig,
  constants,
  ServiceId,
  createLogger,
} from '../utils/index.js';
import {
  validateCredentials,
  parseCredential,
  hasPermission,
  Permission,
} from '../utils/auth.js';
import {
  DebridServiceConfig,
  DebridDownload,
  DebridError,
  DebridFile,
  PlaybackInfo,
  UsenetDebridService,
} from './base.js';
import {
  getUsenetEngineConfig,
  NativeUsenetCredentialSchema,
  encodeUsenetStreamToken,
  libraryEntryToDownload,
  addUsenetNzb,
  resolveFileList,
  selectStreamFile,
} from '../usenet/integration/index.js';
import {
  UsenetLibraryRepository,
  type UsenetLibraryEntry,
} from '../db/index.js';

const logger = createLogger('usenet/service');

/**
 * Native usenet service backed by the built-in NNTP engine.
 *
 * Unlike WebDAV-based usenet services, native streams are served directly from
 * this AIOStreams instance via an internal byte-serving endpoint under
 * `BASE_URL` — they are never routed through the built-in proxy (there are no
 * embedded WebDAV credentials to hide).
 *
 * Providers are configured globally by the administrator; a user authorises use
 * of the engine by supplying an `aiostreamsAuth` (`username:password`)
 * credential that exists in `AIOSTREAMS_AUTH`.
 */
export class NativeUsenetService implements UsenetDebridService {
  readonly serviceName: ServiceId = constants.AIOSTREAMS_SERVICE;
  readonly capabilities = { torrents: false, usenet: true } as const;

  private readonly aiostreamsAuth: string;

  constructor(private readonly config: DebridServiceConfig) {
    const parsed = NativeUsenetCredentialSchema.parse(config.token);
    this.aiostreamsAuth = parsed.aiostreamsAuth;
  }

  /** The authorising username (owner of resolved/added library entries). */
  private get owner(): string | undefined {
    return parseCredential(this.aiostreamsAuth)?.username || undefined;
  }

  /**
   * Throw a 401 DebridError unless the supplied auth pair is valid and the user
   * holds the `service` permission. Accepts `user:pass` or `base64(user:pass)`.
   */
  private assertAuthorised(): void {
    const creds = parseCredential(this.aiostreamsAuth);
    if (
      !creds ||
      !validateCredentials(creds.username, creds.password) ||
      !hasPermission(creds.username, Permission.Service)
    ) {
      throw new DebridError('Invalid AIOStreams auth for native usenet', {
        statusCode: 401,
        statusText: 'Unauthorized',
        code: 'UNAUTHORIZED',
        headers: {},
        body: null,
        type: 'api_error',
      });
    }
  }

  /**
   * Availability is proven on demand by the engine, so any NZB we have not seen
   * is reported as `cached` (playable). Previously-resolved NZBs are reported
   * with `library: true` plus their stored streamable file list (so the caller
   * can run accurate file selection without re-inspecting), and previously-
   * failed NZBs are reported as `failed` so the caller skips them. Keyed by the
   * NZB content hash, the same value the resolve path uses, so the two stay in
   * sync.
   */
  async checkNzbs(
    nzbs: { name?: string; hash?: string }[]
  ): Promise<DebridDownload[]> {
    this.assertAuthorised();
    const { providers } = getUsenetEngineConfig();
    if (providers.length === 0) {
      logger.warn(
        'no usenet providers configured; treating all nzbs as unavailable'
      );
      return [];
    }

    const hashes = nzbs.map((n) => n.hash).filter((h): h is string => !!h);
    const library = await UsenetLibraryRepository.getMany(hashes).catch(
      (err): Map<string, UsenetLibraryEntry> => {
        logger.warn({ err }, 'failed to read usenet library; assuming empty');
        return new Map();
      }
    );

    return nzbs.map(({ name, hash }) => {
      const entry = hash ? library.get(hash) : undefined;
      if (entry?.status === 'failed') {
        return {
          id: hash ?? name ?? 'unknown',
          hash,
          name: entry.name ?? name,
          status: 'failed' as const,
          library: true,
        };
      }
      const files: DebridFile[] | undefined = entry?.files.length
        ? entry.files.map((f) => ({
            name: f.name,
            size: f.size,
            index: f.index,
            path: f.path,
          }))
        : undefined;
      return {
        id: hash ?? name ?? 'unknown',
        hash,
        name: entry?.name ?? name,
        size: entry?.size,
        status: 'cached' as const,
        library: !!entry,
        files,
      };
    });
  }

  /**
   * Build the internal byte-serving URL for the selected file. The actual NZB
   * fetch, inspection, and seekable streaming happen in the route handler; here
   * we only authorise, validate that providers exist, and mint the (encrypted)
   * stream token.
   */
  async resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    _cacheAndPlay?: boolean,
    autoRemoveDownloads?: boolean,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    const startedAt = Date.now();
    if (playbackInfo.type !== 'usenet') {
      throw new DebridError('native usenet cannot resolve torrents', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'BAD_REQUEST',
        headers: {},
        body: null,
        type: 'api_error',
      });
    }
    this.assertAuthorised();

    const { providers, options } = getUsenetEngineConfig();
    if (providers.length === 0) {
      throw new DebridError('No usenet providers are configured', {
        statusCode: 503,
        statusText: 'Service Unavailable',
        code: 'SERVICE_UNAVAILABLE',
        headers: {},
        body: null,
        type: 'api_error',
      });
    }

    const nzbHash = playbackInfo.hash;

    const existing = await UsenetLibraryRepository.get(nzbHash).catch(
      () => undefined
    );

    if (!playbackInfo.nzb) {
      const entry =
        existing ??
        (playbackInfo.serviceItemId
          ? await UsenetLibraryRepository.get(playbackInfo.serviceItemId).catch(
              () => undefined
            )
          : undefined);
      if (entry?.nzbUrl) {
        playbackInfo.nzb = entry.nzbUrl;
      }
    }

    if (!playbackInfo.nzb) {
      throw new DebridError('native usenet requires an NZB URL', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: null,
        type: 'api_error',
      });
    }

    if (existing?.status === 'failed') {
      // Short-circuit on a cached failure WITHOUT re-checking providers. Logged
      // so a fast "previously failed" rejection is distinguishable from a fresh
      // inspect failure (delete the library entry to force a re-inspect).
      logger.debug(
        {
          hash: nzbHash,
          failReason: existing.failReason,
          errorCode: existing.errorCode,
          failCount: existing.failCount,
          failedAt: existing.lastUsedAt,
        },
        'skipping nzb: cached failure (delete the library entry to retry)'
      );
      throw new DebridError('nzb previously failed on all providers', {
        statusCode: 404,
        statusText: 'Not Found',
        code: 'NOT_FOUND',
        headers: {},
        body: null,
        type: 'api_error',
      });
    }
    // Whether the library entry existed before this resolve. Used so loser
    // cleanup / auto-remove only ever drop entries WE created, never a user's
    // manually-saved (or previously-imported) library item.
    const existedBefore = !!existing;

    let files;
    try {
      files = await resolveFileList(
        playbackInfo,
        nzbHash,
        providers,
        options,
        this.owner,
        existing?.files.length
          ? existing.files.map((f) => ({
              name: f.name,
              size: f.size,
              index: f.index,
              path: f.path,
            }))
          : undefined,
        signal
      );
    } catch (err) {
      // Cancelled by a winning parallel failover attempt: drop the freshly
      // created (auto) entry so a cancelled-but-fine NZB doesn't linger as a
      // dead "inspecting" row.
      if (signal?.aborted && !existedBefore) {
        UsenetLibraryRepository.delete(nzbHash).catch(() => {});
      }
      throw err;
    }

    const selected = await selectStreamFile(playbackInfo, filename, files);
    if (!selected) {
      throw new DebridError('no matching file found in nzb', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'NO_MATCHING_FILE',
        headers: {},
        body: { availableFiles: files.map((f) => f.name) },
        type: 'api_error',
      });
    }

    UsenetLibraryRepository.touch(nzbHash).catch(() => {});

    const chosenFilename = selected.name ?? filename;
    const token = encodeUsenetStreamToken({
      nzb: playbackInfo.nzb,
      hash: nzbHash,
      fileIndex: selected.index,
      innerPath: selected.path,
      filename: chosenFilename,
    });

    const url = `${appConfig.bootstrap.baseUrl}/api/v1/usenet/stream/${token}/${encodeURIComponent(
      chosenFilename
    )}`;
    logger.debug(
      {
        hash: nzbHash,
        filename: chosenFilename,
        fileIndex: selected.index,
        innerPath: selected.path,
        latency: Date.now() - startedAt,
        files: files.map((f) => f.name),
      },
      'minted native usenet stream url'
    );

    return url;
  }

  /**
   * Manually add an NZB by URL: fetch, parse, inspect, and persist as a `manual`
   * library entry (lifecycle queued → inspecting → available|failed). Used by
   * the dashboard's manual-add dropzone / URL field.
   */
  async addNzb(nzb: string, name: string): Promise<DebridDownload> {
    this.assertAuthorised();
    const entry = await addUsenetNzb({ url: nzb, name, owner: this.owner });
    return libraryEntryToDownload(entry);
  }

  /**
   * List previously-added/resolved library entries (drives the built-in library
   * addon's catalog). With an `id`, returns just that entry.
   */
  async listNzbs(id?: string): Promise<DebridDownload[]> {
    this.assertAuthorised();
    if (id) {
      const entry = await UsenetLibraryRepository.get(id);
      return entry ? [libraryEntryToDownload(entry)] : [];
    }
    const { entries } = await UsenetLibraryRepository.list({
      group: 'all',
      limit: 500,
    });
    return entries.map(libraryEntryToDownload);
  }

  /** Fetch a single library entry (file list included) by NZB hash. */
  async getNzb(nzbId: string): Promise<DebridDownload> {
    this.assertAuthorised();
    const entry = await UsenetLibraryRepository.get(nzbId);
    if (!entry) {
      throw new DebridError('nzb not found in library', {
        statusCode: 404,
        statusText: 'Not Found',
        code: 'NOT_FOUND',
        headers: {},
        body: null,
        type: 'api_error',
      });
    }
    return libraryEntryToDownload(entry);
  }

  /** Remove a library entry by NZB hash. */
  async removeNzb(nzbId: string): Promise<void> {
    this.assertAuthorised();
    await UsenetLibraryRepository.delete(nzbId);
  }

  /**
   * The native library is backed directly by the DB (UsenetLibraryRepository),
   * so {@link listNzbs} is always live — there is no per-token cache to
   * invalidate. Implemented so the built-in library refresh action is supported
   * rather than erroring.
   */
  async refreshLibraryCache(): Promise<void> {
    this.assertAuthorised();
  }
}
