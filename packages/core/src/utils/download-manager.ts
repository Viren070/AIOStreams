import { GrabCache } from './grab-cache.js';
import { makeRequest, makeUrlLogSafe } from './http.js';
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

/** The grab URL answered with a non-OK HTTP status. */
export class GrabHttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string
  ) {
    super(`grab returned ${status} ${statusText}`);
    this.name = 'GrabHttpError';
  }
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

/** The grab URL answered with something that is not an NZB document. */
export class NotAnNzbError extends Error {
  constructor(
    readonly detail: string,
    readonly status?: number,
    readonly contentType?: string
  ) {
    super(`grab did not return an NZB: ${detail}`);
    this.name = 'NotAnNzbError';
  }
}

const SNIFF_BYTES = 4096;

const PROLOG =
  /^\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?[^>]*>)/i;
const ROOT_TAG = /^\s*<([A-Za-z_][\w.:-]*)([^>]*)/;

function collapse(value: string, max: number): string {
  const flat = value.replace(/\p{C}/gu, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function attrOf(tag: string, name: string): string | undefined {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i'
  ).exec(tag);
  return match ? (match[1] ?? match[2]) : undefined;
}

/**
 * Describe a grabbed payload that is definitely not an NZB, else `undefined`.
 *
 * Prevents a non-nzb response (e.g. HTML error page) from being cached.
 */
export function sniffNotNzb(buf: Buffer): string | undefined {
  let head = buf.toString('utf8', 0, SNIFF_BYTES);
  if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);
  if (!head.trim()) return buf.length ? 'blank content' : 'empty response';

  let rest = head;
  for (;;) {
    const prolog = PROLOG.exec(rest);
    if (!prolog) break;
    rest = rest.slice(prolog[0].length);
  }

  const root = ROOT_TAG.exec(rest);
  if (!root) {
    return rest.trimStart().startsWith('<')
      ? undefined
      : `non-XML content: ${collapse(rest, 100)}`;
  }
  const [, name, attrs] = root;
  const local = name.slice(name.indexOf(':') + 1).toLowerCase();
  if (local === 'nzb') return undefined;
  if (local === 'html') {
    const title = collapse(/<title[^>]*>([^<]*)</i.exec(head)?.[1] ?? '', 80);
    return title ? `HTML page ("${title}")` : 'HTML page';
  }
  if (local === 'error') {
    const description = attrOf(attrs, 'description');
    const code = attrOf(attrs, 'code');
    const suffix = code ? ` (code ${code})` : '';
    return description
      ? `indexer error: ${collapse(description, 100)}${suffix}`
      : `indexer error${suffix}`;
  }
  return `<${name}> document`;
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
  async fetchNzb(
    url: string,
    opts: Omit<GrabOptions, 'userAgent'> = {}
  ): Promise<Buffer> {
    // Default user-agent; a `[nzb_grabs]` (or per-host) override in
    // REQUEST_HEADER_OVERRIDES takes priority inside makeRequest.
    const userAgent = appConfig.http.defaultUserAgent;
    const cache = this.nzbCache();
    const buf = await cache.fetch(url, () =>
      this.download(url, { ...opts, userAgent })
    );
    // catches entries that were cached before sniffing was added
    const notNzb = sniffNotNzb(buf);
    if (!notNzb) return buf;
    await cache.delete(url);
    throw new NotAnNzbError(notNzb);
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
      throw new GrabHttpError(response.status, response.statusText);
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
    const notNzb = sniffNotNzb(buf);
    if (notNzb) {
      const contentType = response.headers.get('content-type') ?? undefined;
      logger.warn(
        {
          url: makeUrlLogSafe(url),
          status: response.status,
          contentType,
          bytes: buf.length,
          reason: notNzb,
        },
        'grab did not return an nzb'
      );
      throw new NotAnNzbError(notNzb, response.status, contentType);
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
