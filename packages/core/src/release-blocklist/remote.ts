import { gunzipSync } from 'node:zlib';
import { createLogger } from '../logging/logger.js';
import { ReleaseBlocklistRepository } from '../db/repositories/release-blocklist.js';
import type { BlocklistSource } from './types.js';
import { parseNdjson } from './io.js';
import { fetchRemoteCapped } from '../utils/safe-fetch.js';

const logger = createLogger('release-blocklist');

const MAX_REDIRECTS = 5;
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 90_000;

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

function redactUrl(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : `${url.slice(0, q)}?<redacted>`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function fetchListUrl(url: string, etag: string | null) {
  return fetchRemoteCapped(url, {
    etag,
    maxBytes: MAX_DOWNLOAD_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
  });
}

export function decodeListBody(body: Buffer): string {
  if (body.length >= 2 && body.subarray(0, 2).equals(GZIP_MAGIC)) {
    return gunzipSync(body, {
      maxOutputLength: MAX_DECOMPRESSED_BYTES,
    }).toString('utf8');
  }
  return body.toString('utf8');
}

export class ReleaseBlocklistRemoteService {
  /**
   * Refresh a single remote source: conditional fetch, parse (either NDJSON
   * dialect, gzip auto-detected) and full replace of the source's entries.
   * Fails closed: an empty or majority-invalid payload keeps the previous
   * entries. Returns a short status string, also persisted on the source.
   */
  static async refreshOne(source: BlocklistSource): Promise<string> {
    const checkedAt = nowSeconds();
    try {
      if (!source.url) throw new Error('source has no URL');
      const result = await fetchListUrl(source.url, source.etag);
      if (result.notModified) {
        await ReleaseBlocklistRepository.setSourceStatus(source.id, {
          status: 'ok (not modified)',
          lastChecked: checkedAt,
        });
        return 'not modified';
      }
      const text = decodeListBody(result.body);
      const { records, invalid } = parseNdjson(text, checkedAt);
      if (records.length === 0) {
        throw new Error('list contained no valid records');
      }
      if (invalid > records.length) {
        throw new Error(
          `list looks corrupt (${invalid} invalid vs ${records.length} valid lines)`
        );
      }
      const stored = await ReleaseBlocklistRepository.bulkReplace(
        source.id,
        records
      );
      await ReleaseBlocklistRepository.setSourceStatus(source.id, {
        status: `ok (${stored} entries${invalid ? `, ${invalid} invalid lines skipped` : ''})`,
        etag: result.etag,
        lastChecked: checkedAt,
        lastUpdated: checkedAt,
      });
      logger.info(
        `refreshed blocklist source "${source.name}" (${redactUrl(source.url)}): ${stored} entries`
      );
      return `ok (${stored} entries)`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ReleaseBlocklistRepository.setSourceStatus(source.id, {
        status: `error: ${message}`,
        lastChecked: checkedAt,
      }).catch(() => {});
      logger.warn(
        `failed to refresh blocklist source "${source.name}" (${redactUrl(source.url ?? '')}): ${message}`
      );
      return `error: ${message}`;
    }
  }

  /** Refresh every enabled remote source whose refresh interval has elapsed. */
  static async refreshDue(): Promise<{ ok: boolean; message: string }> {
    const sources = await ReleaseBlocklistRepository.getSources();
    const now = nowSeconds();
    const due = sources.filter(
      (s) =>
        s.kind === 'remote' &&
        s.enabled &&
        s.url &&
        now - s.lastChecked >= s.refreshSeconds
    );
    if (due.length === 0) {
      return { ok: true, message: 'no sources due' };
    }
    let failures = 0;
    for (const source of due) {
      const status = await this.refreshOne(source);
      if (status.startsWith('error')) failures++;
    }
    return {
      ok: failures === 0,
      message: `refreshed ${due.length - failures}/${due.length} due sources`,
    };
  }

  /**
   * Refresh specific sources now, regardless of their interval. Remote sources
   * are fetched with bounded concurrency; non-remote ids are skipped. Returns
   * how many were refreshed vs errored (refreshOne records status rather than
   * throwing, so failures are read from its returned status string).
   */
  static async refreshByIds(
    ids: string[]
  ): Promise<{ refreshed: number; failed: number }> {
    const CONCURRENCY = 5;
    let refreshed = 0;
    let failed = 0;
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const source = await ReleaseBlocklistRepository.getSource(ids[next++]);
        if (source?.kind !== 'remote' || !source.url) continue;
        const status = await this.refreshOne(source);
        if (status.startsWith('error')) failed++;
        else refreshed++;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, ids.length) }, () => worker())
    );
    return { refreshed, failed };
  }
}
