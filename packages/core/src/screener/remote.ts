import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { ScreenerStore } from '../db/repositories/screener.js';
import { parseNdjson } from './io.js';
import { createLogger, makeRequest } from '../utils/index.js';
import { redactUrlParams } from '../logging/redact.js';
import { isUnsafeRemoteUrl } from './url-safety.js';
import type { ScreenerSource } from './types.js';

const logger = createLogger('screener-remote');
const gunzipAsync = promisify(gunzip);

const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 90_000;
const MAX_REDIRECTS = 5;

// A URL manifest (a list of list URLs) is tiny compared to the lists it points
// at, so peek only a small slice and cap how many children one manifest yields.
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_URLS = 200;

/**
 * Read a response body into a buffer, aborting as soon as it exceeds `max`. A
 * server that omits Content-Length can't flood memory because we stop on the
 * first chunk that crosses the limit rather than buffering the whole body.
 */
async function readBodyCapped(
  body: ReadableStream<Uint8Array> | null,
  max: number
): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > max) throw new Error('Download exceeds the size limit.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Refreshes remote Screener list subscriptions: fetch the URL, gunzip if the
 * body is a `.gz`, parse it (native or davex NDJSON), and replace that source's
 * entries. Conditional on ETag so unchanged lists are cheap. Operator-configured
 * URLs only; nothing here trusts user input.
 */
export class ScreenerRemoteSourceService {
  /** Refresh every remote source whose refresh interval has elapsed. */
  static async refreshDue(): Promise<{ ok: boolean; message: string }> {
    const now = nowSec();
    // A listing failure propagates so the scheduled task reports it. Per-source
    // failures stay contained in refreshOne (one bad source can't abort the
    // sweep) but are aggregated into the returned status so they aren't hidden.
    const sources = await ScreenerStore.getSources();
    let checked = 0;
    const failed: string[] = [];
    for (const source of sources) {
      if (!source.enabled || source.kind !== 'remote' || !source.url) continue;
      if (now - source.lastChecked < source.refreshSeconds) continue;
      checked++;
      const status = await this.refreshOne(source);
      if (status.startsWith('error')) failed.push(source.name);
    }
    if (checked === 0) return { ok: true, message: 'no sources due' };
    if (failed.length > 0) {
      return {
        ok: false,
        message: `${failed.length}/${checked} source(s) failed: ${failed.join(', ')}`,
      };
    }
    return { ok: true, message: `refreshed ${checked} source(s)` };
  }

  /** Refresh a single remote source now. Returns a short status string. */
  static async refreshOne(source: ScreenerSource): Promise<string> {
    const now = nowSec();
    if (!source.url) {
      await ScreenerStore.touchChecked(source.id, now, 'error: no url');
      return 'error: no url';
    }
    try {
      const etag = await ScreenerStore.getSourceEtag(source.id);
      const res = await fetchListUrl(
        source.url,
        etag ? { 'If-None-Match': etag } : undefined
      );

      if (res.status === 304) {
        await ScreenerStore.touchChecked(source.id, now, `ok (${source.count})`);
        return 'not-modified';
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Reject early on a declared oversize body, and cap the decompressed
      // payload so a small `.gz` can't expand past the limit and exhaust memory.
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
        throw new Error('Download exceeds the size limit.');
      }
      const buf = await readBodyCapped(res.body, MAX_DOWNLOAD_BYTES);
      const text = looksGzip(buf)
        ? (
            await gunzipAsync(buf, { maxOutputLength: MAX_DOWNLOAD_BYTES })
          ).toString('utf8')
        : buf.toString('utf8');

      const { records, invalid } = parseNdjson(text);
      // Fail closed: don't let an empty or mostly-unparseable response (e.g. an
      // HTML error page served with 200) replace a good source. A few unknown
      // lines (a newer format the reader doesn't recognise yet) are tolerated.
      if (records.length === 0 || invalid > records.length) {
        throw new Error('Remote list is empty or malformed.');
      }
      const count = await ScreenerStore.bulkUpsert(source.id, records, {
        replace: true,
      });
      const newEtag = res.headers.get('etag');
      await ScreenerStore.setSourceStatus(source.id, newEtag, now, now, `ok (${count})`);
      logger.info(
        `refreshed remote list "${source.name}" (${count} entries${invalid ? `, ${invalid} skipped` : ''})`
      );
      return `ok (${count})`;
    } catch (err) {
      const msg =
        'error: ' +
        redactUrlParams(err instanceof Error ? err.message : String(err));
      await ScreenerStore.touchChecked(source.id, now, msg);
      logger.debug(`refresh failed for "${source.name}": ${msg}`);
      return msg;
    }
  }

  /**
   * Fetch a URL and, if its body is a plain-text list of list URLs (a "list of
   * lists" like nzbdavex's warden_list) rather than list data itself, return
   * those child URLs. Returns null when it isn't a manifest, so the caller can
   * fall back to treating the URL as a single ordinary list. Never throws.
   */
  static async expandManifest(url: string): Promise<string[] | null> {
    try {
      const res = await fetchListUrl(url);
      if (!res.ok) return null;
      const buf = await readBodyCapped(res.body, MAX_MANIFEST_BYTES);
      // A gzip body is compressed list data (e.g. warden.ndjson.gz), never a
      // manifest of URLs.
      if (looksGzip(buf)) return null;
      return parseUrlManifest(buf.toString('utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Refresh the given remote sources with bounded concurrency. Used to fetch a
   * freshly added batch without blocking the request that created them; per-source
   * failures are contained by refreshOne.
   */
  static async refreshByIds(ids: string[]): Promise<void> {
    const wanted = new Set(ids);
    const sources = (await ScreenerStore.getSources()).filter(
      (s) => wanted.has(s.id) && s.kind === 'remote' && s.url
    );
    let next = 0;
    const worker = async () => {
      while (next < sources.length) {
        const source = sources[next++];
        await this.refreshOne(source).catch(() => {});
      }
    };
    const lanes = Math.min(4, sources.length);
    await Promise.all(Array.from({ length: lanes }, worker));
  }
}

/**
 * Fetch a list URL, following redirects ourselves so every hop is re-checked
 * against the public-address guard: a public list URL (e.g. a GitHub "latest"
 * link) must not be bounced to an internal target. 304 Not Modified is in the
 * 3xx range but isn't a redirect.
 */
async function fetchListUrl(
  url: string,
  headers?: Record<string, string>
): Promise<Response> {
  // Re-check the stored URL before the first fetch, not just redirect hops.
  if (isUnsafeRemoteUrl(url)) {
    throw new Error('Source URL is not a public address.');
  }
  let target = url;
  let res = await makeRequest(target, {
    method: 'GET',
    timeout: FETCH_TIMEOUT_MS,
    headers,
    rawOptions: { redirect: 'manual' },
  });
  for (
    let hop = 0;
    res.status >= 300 && res.status < 400 && res.status !== 304;
    hop++
  ) {
    if (hop >= MAX_REDIRECTS) throw new Error('Too many redirects.');
    const loc = res.headers.get('location');
    if (!loc) throw new Error(`HTTP ${res.status} (no redirect target)`);
    target = new URL(loc, target).toString();
    if (isUnsafeRemoteUrl(target)) {
      throw new Error('Redirect to a non-public address.');
    }
    res = await makeRequest(target, {
      method: 'GET',
      timeout: FETCH_TIMEOUT_MS,
      headers,
      rawOptions: { redirect: 'manual' },
    });
  }
  return res;
}

/**
 * Read a plain-text body as a manifest of list URLs: one http(s) URL per line,
 * with blank lines and `#` comments ignored. Returns null unless every content
 * line is an http(s) URL, so ordinary NDJSON list data (whose lines are JSON
 * objects) is never mistaken for a manifest.
 */
function parseUrlManifest(text: string): string[] | null {
  const urls: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (!/^https?:\/\/\S+$/i.test(line)) return null;
    urls.push(line);
    if (urls.length >= MAX_MANIFEST_URLS) break;
  }
  return urls.length > 0 ? urls : null;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function looksGzip(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}
