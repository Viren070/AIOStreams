import z from 'zod';
import { DebridError } from '../base.js';
import {
  createLogger,
  fromUrlSafeBase64,
  getSimpleTextHash,
  makeRequest,
  toUrlSafeBase64,
} from '../../utils/index.js';

const logger = createLogger('debrid:qbittorrent');

/** Mark torrents AIOStreams adds itself, a tag rather than a category
 * (categories can carry a save path and relocate downloads). */
export const QBITTORRENT_TAG = 'aiostreams';

/** qBittorrent file priority values, 0 skips the file entirely. */
export const FILE_PRIORITY = {
  skip: 0,
  normal: 1,
  max: 7,
} as const;

export const QbittorrentCredentialSchema = z.object({
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string(),
  skipOtherFiles: z
    .union([z.boolean(), z.string(), z.null()])
    .transform((value) => value === true || value === 'true')
    .optional(),
});

export type QbittorrentCredential = z.infer<typeof QbittorrentCredentialSchema>;

/** Whether AIOStreams added this torrent, only ours get re-arranged. */
export function isOwnTorrent(torrent: { tags: string }): boolean {
  return torrent.tags
    .split(',')
    .map((tag) => tag.trim())
    .includes(QBITTORRENT_TAG);
}

/** Parse the base64url credential blob from the preset/service-wrap paths. */
export function parseQbittorrentCredential(
  token: string
): QbittorrentCredential {
  let raw: unknown;
  try {
    raw = JSON.parse(fromUrlSafeBase64(token));
  } catch {
    throw new DebridError('Invalid qBittorrent credential', {
      statusCode: 400,
      statusText: 'Bad Request',
      code: 'BAD_REQUEST',
      type: 'api_error',
      headers: {},
    });
  }
  const parsed = QbittorrentCredentialSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DebridError(
      'Expected qBittorrent credential with url, username and password',
      {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'BAD_REQUEST',
        type: 'api_error',
        headers: {},
      }
    );
  }
  return parsed.data;
}

/** A torrent as reported by `/api/v2/torrents/info`, only the fields we read. */
export const QbittorrentTorrentSchema = z.object({
  hash: z.string(),
  name: z.string(),
  state: z.string(),
  progress: z.number(),
  size: z.number(),
  content_path: z.string(),
  save_path: z.string(),
  tags: z.string(),
  added_on: z.number(),
});

export type QbittorrentTorrent = z.infer<typeof QbittorrentTorrentSchema>;

/** A file within a torrent as reported by `/api/v2/torrents/files`. */
export const QbittorrentFileSchema = z.object({
  index: z.number(),
  name: z.string(),
  size: z.number(),
  progress: z.number(),
  priority: z.number(),
  /** Inclusive global piece range `[first, last]` covered by this file. */
  piece_range: z.tuple([z.number(), z.number()]),
});

export type QbittorrentFile = z.infer<typeof QbittorrentFileSchema>;

const QbittorrentPropertiesSchema = z.object({
  piece_size: z.number(),
});

interface Session {
  /** Cookie name qBittorrent issued (SID or QBT_SID_<port>). */
  cookieName: string;
  sid: string;
  expiresAt: number;
}

/**
 * Shared per-credential sessions, concurrent resolves reuse one login.
 * qBittorrent IP-bans repeated failures, so parallel logins are
 * deduplicated through {@link inflightLogins} too.
 */
const sessions = new Map<string, Session>();
const inflightLogins = new Map<string, Promise<Session>>();

/** Cached login failures keep a bad password from tripping qBittorrent's IP ban. */
const loginFailures = new Map<string, number>();
const LOGIN_FAILURE_TTL_MS = 60_000;

/** Cache key for per-credential shared state (sessions, snapshots). */
export function credentialKey(credential: QbittorrentCredential): string {
  return getSimpleTextHash(
    `${credential.url}|${credential.username}|${credential.password}`
  );
}

/** Inverse of {@link parseQbittorrentCredential}, flattens for storage. */
export function encodeQbittorrentCredential(
  credential: Pick<QbittorrentCredential, 'url' | 'username' | 'password'> & {
    skipOtherFiles?: boolean | string | null;
  }
): string {
  return toUrlSafeBase64(
    JSON.stringify({
      url: credential.url,
      username: credential.username,
      password: credential.password,
      skipOtherFiles:
        credential.skipOtherFiles === true ||
        credential.skipOtherFiles === 'true'
          ? true
          : undefined,
    })
  );
}

function unauthorized(message: string): DebridError {
  return new DebridError(message, {
    statusCode: 401,
    statusText: 'Unauthorized',
    code: 'UNAUTHORIZED',
    type: 'api_error',
    headers: {},
  });
}

/**
 * Low-level WebUI API client, one per resolve over shared session state.
 * Every request sends a Referer, qBittorrent's CSRF check rejects calls
 * without one.
 */
export class QBittorrentClient {

  private readonly pieceSizes = new Map<string, number>();

  constructor(private readonly credential: QbittorrentCredential) {}

  private baseUrl(): string {
    return this.credential.url.replace(/\/+$/, '');
  }

  private key(): string {
    return credentialKey(this.credential);
  }

  private async login(): Promise<Session> {
    const key = this.key();
    const failureAt = loginFailures.get(key);
    if (failureAt !== undefined && Date.now() - failureAt < LOGIN_FAILURE_TTL_MS) {
      throw unauthorized(
        'qBittorrent login failed recently; check the WebUI credentials'
      );
    }
    const inflight = inflightLogins.get(key);
    if (inflight) return inflight;
    const attempt = this.doLogin(key).finally(() => {
      inflightLogins.delete(key);
    });
    inflightLogins.set(key, attempt);
    return attempt;
  }

  private async doLogin(key: string): Promise<Session> {
    const response = await makeRequest(`${this.baseUrl()}/api/v2/auth/login`, {
      method: 'POST',
      timeout: 15_000,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        referer: this.baseUrl() + '/',
      },
      body: new URLSearchParams({
        username: this.credential.username,
        password: this.credential.password,
      }).toString(),
    });
    const body = await response.text();
    // qBittorrent 5.x answers 204 with an empty body on success; 4.x used
    // 200 with "Ok.". Bad credentials are 200 with "Fails.", a banned host
    // gets 403.
    if (!response.ok || body.includes('Fails.')) {
      loginFailures.set(key, Date.now());
      throw unauthorized(
        response.status === 403
          ? 'qBittorrent rejected the login (IP may be banned)'
          : 'qBittorrent login failed; check the WebUI credentials'
      );
    }
    // getSetCookie splits multiple Set-Cookie headers, which a joined
    // headers.get() would mash together.
    const cookies = response.headers.getSetCookie?.() ?? [];
    // qBittorrent 5.x names the cookie after the WebUI port (QBT_SID_8080),
    // older versions use a plain SID.
    let cookieName: string | undefined;
    let sid: string | undefined;
    let expires: string | undefined;
    for (const cookie of cookies) {
      const match = /(?:^|;\s*)([A-Za-z0-9_]*SID[A-Za-z0-9_]*)=([^;]+)/.exec(
        cookie
      );
      if (match) {
        cookieName = match[1];
        sid = match[2];
        expires = /expires=([^;]+)/i.exec(cookie)?.[1];
        break;
      }
    }
    if (!cookieName || !sid) {
      loginFailures.set(key, Date.now());
      throw unauthorized('qBittorrent login returned no session cookie');
    }
    const expiresAt = expires
      ? new Date(expires).getTime() - 30_000
      : Date.now() + 30 * 60_000;
    const session: Session = { cookieName, sid, expiresAt };
    sessions.set(key, session);
    return session;
  }

  private async request(
    path: string,
    options: {
      method?: string;
      body?: URLSearchParams;
      signal?: AbortSignal;
    } = {}
  ): Promise<Response> {
    const attempt = async (session: Session | undefined): Promise<Response> => {
      const headers: Record<string, string> = {
        referer: this.baseUrl() + '/',
      };
      if (session) headers.cookie = `${session.cookieName}=${session.sid}`;
      if (options.body !== undefined) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
      }
      return makeRequest(`${this.baseUrl()}${path}`, {
        method: options.method ?? 'GET',
        timeout: 30_000,
        signal: options.signal,
        headers,
        body: options.body?.toString(),
        ignoreRecursion: true,
      });
    };
    let session = sessions.get(this.key());
    if (session && session.expiresAt < Date.now()) {
      sessions.delete(this.key());
      session = undefined;
    }
    if (!session) session = await this.login();
    let response = await attempt(session);
    if (
      response.status === 401 ||
      // With a session in hand a 403 means "stale session" (4.x answers
      // unauthenticated calls with it), a truly banned host fails at login.
      (response.status === 403 && session !== undefined)
    ) {
      await response.body?.cancel().catch(() => {});
      sessions.delete(this.key());
      response = await attempt(await this.login());
    }
    return response;
  }

  private async requestJson<T>(
    schema: z.ZodType<T>,
    path: string,
    options: Parameters<QBittorrentClient['request']>[1] = {}
  ): Promise<T> {
    const response = await this.request(path, options);
    if (!response.ok) {
      // Drain the body so the connection is released before throwing.
      await response.body?.cancel().catch(() => {});
      throw this.httpError(response.status, path);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new DebridError(`qBittorrent returned invalid JSON from ${path}`, {
        statusCode: 502,
        statusText: 'Bad Gateway',
        code: 'BAD_GATEWAY',
        type: 'upstream_error',
        headers: {},
      });
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new DebridError(`qBittorrent response changed shape at ${path}`, {
        statusCode: 502,
        statusText: 'Bad Gateway',
        code: 'BAD_GATEWAY',
        type: 'upstream_error',
        headers: {},
      });
    }
    return parsed.data;
  }

  private httpError(status: number, path: string): DebridError {
    if (status === 403) {
      return unauthorized(
        'qBittorrent rejected the request; this host may be banned by the WebUI'
      );
    }
    if (status === 401) {
      return unauthorized(
        'qBittorrent rejected the request; check the WebUI credentials'
      );
    }
    if (status === 404) {
      return new DebridError(`qBittorrent has no torrent for ${path}`, {
        statusCode: 404,
        statusText: 'Not Found',
        code: 'NOT_FOUND',
        type: 'api_error',
        headers: {},
      });
    }
    return new DebridError(`qBittorrent request to ${path} failed`, {
      statusCode: status >= 500 ? 502 : 400,
      statusText: status >= 500 ? 'Bad Gateway' : 'Bad Request',
      code: status >= 500 ? 'BAD_GATEWAY' : 'BAD_REQUEST',
      type: status >= 500 ? 'upstream_error' : 'api_error',
      headers: {},
    });
  }

  /** Look up torrents by infohash. Unknown hashes are simply absent. */
  async getTorrents(
    hashes: string[],
    signal?: AbortSignal
  ): Promise<QbittorrentTorrent[]> {
    const found: QbittorrentTorrent[] = [];
    const unique = [...new Set(hashes)];
    for (let i = 0; i < unique.length; i += 100) {
      const chunk = unique.slice(i, i + 100).join('|');
      const torrents = await this.requestJson(
        z.array(QbittorrentTorrentSchema),
        `/api/v2/torrents/info?hashes=${encodeURIComponent(chunk)}`,
        { signal }
      );
      found.push(...torrents);
    }
    return found;
  }

  async getTorrent(
    hash: string,
    signal?: AbortSignal
  ): Promise<QbittorrentTorrent | undefined> {
    return (await this.getTorrents([hash], signal))[0];
  }

  /** All torrents AIOStreams added (by tag), for `listMagnets`. */
  async getTaggedTorrents(signal?: AbortSignal): Promise<QbittorrentTorrent[]> {
    return this.requestJson(
      z.array(QbittorrentTorrentSchema),
      `/api/v2/torrents/info?tag=${encodeURIComponent(QBITTORRENT_TAG)}`,
      { signal }
    );
  }

  async getFiles(
    hash: string,
    signal?: AbortSignal
  ): Promise<QbittorrentFile[]> {
    try {
      return await this.requestJson(
        z.array(QbittorrentFileSchema),
        `/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`,
        { signal }
      );
    } catch (error) {
      if (error instanceof DebridError && error.code === 'NOT_FOUND') {
        return [];
      }
      throw error;
    }
  }

  /** Piece size is immutable per torrent, fetch it once per hash. */
  async getPieceSize(hash: string, signal?: AbortSignal): Promise<number> {
    const cached = this.pieceSizes.get(hash);
    if (cached !== undefined) return cached;
    const properties = await this.requestJson(
      QbittorrentPropertiesSchema,
      `/api/v2/torrents/properties?hash=${encodeURIComponent(hash)}`,
      { signal }
    );
    this.pieceSizes.set(hash, properties.piece_size);
    return properties.piece_size;
  }

  async getPieceStates(
    hash: string,
    signal?: AbortSignal
  ): Promise<number[] | undefined> {
    try {
      return await this.requestJson(
        z.array(z.number()),
        `/api/v2/torrents/pieceStates?hash=${encodeURIComponent(hash)}`,
        { signal }
      );
    } catch (error) {
      // Auth failures and aborts must propagate, falling back to file
      // progress would misreport sparse files as playable. Only a genuine
      // absence of piece states degrades.
      if (
        signal?.aborted ||
        (error instanceof DebridError &&
          (error.statusCode === 401 || error.statusCode === 403))
      ) {
        throw error;
      }
      logger.debug(
        { err: error instanceof Error ? error.message : String(error) },
        'piece states unavailable, falling back to progress'
      );
      return undefined;
    }
  }

  /**
   * Add a magnet or .torrent URL, qBittorrent accepts asynchronously and
   * the torrent shows up on the next poll. `firstLastPiecePrio` pulls tail
   * pieces early for the container indexes (MP4 moov, MKV cues).
   */
  async addTorrentUrl(
    url: string,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await this.request('/api/v2/torrents/add', {
      method: 'POST',
      body: new URLSearchParams({
        urls: url,
        tags: QBITTORRENT_TAG,
        sequentialDownload: 'true',
        firstLastPiecePrio: 'true',
      }),
      signal,
    });
    if (response.status === 415) {
      throw new DebridError('qBittorrent rejected the torrent', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'STORE_MAGNET_INVALID',
        type: 'store_error',
        headers: {},
      });
    }
    const body = await response.text();
    if (!response.ok) {
      // qBittorrent 5.x answers a duplicate add with 409, the torrent is
      // already there, which is all this call needed to ensure.
      if (response.status === 409) {
        logger.debug('qBittorrent already has this torrent');
        return;
      }
      throw this.httpError(response.status, '/api/v2/torrents/add');
    }
    // qBittorrent 4.x answers an invalid (or duplicate) add with 200 and a
    // "Fails." body. The caller distinguishes duplicates by looking the
    // torrent up.
    if (body.includes('Fails.')) {
      throw new DebridError('qBittorrent rejected the torrent', {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'STORE_MAGNET_INVALID',
        type: 'store_error',
        headers: {},
      });
    }
  }

  /**
   * Playback optimisation only, failures return false instead of throwing
   * so callers retry drift on the next poll.
   */
  async setFilePriority(
    hash: string,
    ids: number[],
    priority: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (ids.length === 0) return true;
    let response: Response;
    try {
      response = await this.request('/api/v2/torrents/filePrio', {
        method: 'POST',
        body: new URLSearchParams({
          hash,
          id: ids.join('|'),
          priority: String(priority),
        }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      logger.debug(
        { hash, priority, count: ids.length, err: error },
        'could not set file priorities'
      );
      return false;
    }
    if (!response.ok) {
      logger.debug(
        { hash, priority, count: ids.length, status: response.status },
        'could not set file priorities'
      );
    }
      // Drain the body so the connection is released.
    await response.body?.cancel().catch(() => {});
    return response.ok;
  }

  /** Resume a stopped torrent, 5 renamed `resume` to `start`, fall back for 4.x. */
  async startTorrent(hash: string, signal?: AbortSignal): Promise<boolean> {
    for (const path of ['/api/v2/torrents/start', '/api/v2/torrents/resume']) {
      let response: Response;
      try {
        response = await this.request(path, {
          method: 'POST',
          body: new URLSearchParams({ hashes: hash }),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        logger.debug({ hash, path, err: error }, 'could not start torrent');
        return false;
      }
      // Drain the body so the connection is released.
      await response.body?.cancel().catch(() => {});
      if (response.ok) return true;
      // Only 4.x lacks `start` (404); anything else is a real failure.
      if (response.status !== 404) {
        logger.debug(
          { hash, path, status: response.status },
          'could not start torrent'
        );
        return false;
      }
    }
    return false;
  }
}
