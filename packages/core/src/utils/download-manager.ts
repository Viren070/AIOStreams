import { GrabCache } from './grab-cache.js';
import { makeRequest } from './http.js';
import { config as appConfig } from '../config/index.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('download-manager');

/** Identity codecs: grabbed NZB payloads are stored as raw bytes. */
const rawBytes = {
  serialize: (b: Buffer): Buffer => b,
  deserialize: (b: Buffer): Buffer => b,
  sizeOf: (b: Buffer): number => b.length,
};

export interface GrabOptions {
  signal?: AbortSignal;
  /** Request timeout in ms (default 30s). */
  timeoutMs?: number;
  /** User-Agent fallback; per-host overrides still win (see {@link makeRequest}). */
  userAgent?: string | null;
}

/** A grabbed NZB exceeded the configured `usenet.maxNzbSize` cap. */
export class NzbTooLargeError extends Error {
  constructor(
    readonly bytes: number,
    readonly maxBytes: number
  ) {
    super(
      `NZB is too large (${Math.ceil(bytes / 1_000_000)}MB > ` +
        `${Math.floor(maxBytes / 1_000_000)}MB limit)`
    );
    this.name = 'NzbTooLargeError';
  }
}

/**
 * Process-wide download manager for grabbed `.nzb` files: a disk-backed,
 * restart-surviving, single-flighted grab layer (so a player resuming a stream
 * no longer re-downloads the same multi-MB NZB on every request).
 *
 * Built on the shared {@link GrabCache} primitive. Torrent metadata grabbing
 * uses the same primitive in `utils/torrent.ts` ({@link TorrentGrabber}); it
 * lives in a separate module only because it must import `debrid`/`builtins`
 * helpers (to parse torrents at grab time) which can't enter the `utils` barrel
 * import graph. NZBs differ in that they are parsed later, by the usenet engine
 * — so this manager just grabs the raw bytes.
 */
class DownloadManager {
  private _nzb?: GrabCache<Buffer>;

  /** Lazily build the NZB grab cache from live config. */
  private nzbCache(): GrabCache<Buffer> {
    if (!this._nzb) {
      const g = appConfig.builtins.grab;
      this._nzb = new GrabCache<Buffer>({
        name: 'grab-nzb',
        maxMemBytes: g.nzbCacheBytes,
        maxDiskBytes: g.nzbDiskCacheBytes,
        ...rawBytes,
      });
    }
    return this._nzb;
  }

  /** Grab a raw NZB by URL (disk-cached, single-flighted). */
  fetchNzb(
    url: string,
    opts: Omit<GrabOptions, 'userAgent'> = {}
  ): Promise<Buffer> {
    // Default user-agent; a `[nzb_grabs]` (or per-host) override in
    // REQUEST_HEADER_OVERRIDES takes priority inside makeRequest.
    const userAgent = appConfig.http.defaultUserAgent;
    return this.nzbCache().fetch(url, () =>
      this.download(url, { ...opts, userAgent })
    );
  }

  private async download(url: string, opts: GrabOptions): Promise<Buffer> {
    const startedAt = Date.now();
    const maxBytes = appConfig.usenet.maxNzbSize;
    const response = await makeRequest(url, {
      timeout: opts.timeoutMs ?? 30_000,
      signal: opts.signal,
      // `[nzb_grabs]` overrides (a UA or `{preset}`) take priority inside
      // makeRequest; this user-agent is the default fallback.
      context: 'nzb_grabs',
      headers: opts.userAgent ? { 'User-Agent': opts.userAgent } : undefined,
    });
    if (!response.ok) {
      throw new Error(
        `grab returned ${response.status} ${response.statusText}`
      );
    }
    // Reject oversized NZBs before buffering when the server declares a
    // length, and again after (the header is optional and unauthenticated).
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new NzbTooLargeError(declared, maxBytes);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new NzbTooLargeError(buf.length, maxBytes);
    }
    logger.debug(
      { bytes: buf.length, latencyMs: Date.now() - startedAt },
      'grabbed nzb'
    );
    return buf;
  }
}

/** Shared singleton download manager. */
export const downloadManager = new DownloadManager();
