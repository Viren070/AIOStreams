/**
 * Generic ETag-aware downloader used by every anime-database source.
 *
 * Performs a `HEAD` to compare ETags, downloads on mismatch / missing local
 * file, and streams the response body to disk so we don't buffer the whole
 * payload (Manami / AnimeApi can be tens to hundreds of MB).
 */
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { makeRequest } from '../../utils/http.js';
import { withRetry } from '../../utils/general.js';
import { getTimeTakenSincePoint } from '../../utils/time.js';
import { createLogger } from '../../logging/logger.js';
import { ANIME_DATABASE_PATH, etagPathFor } from './paths.js';

const logger = createLogger('anime-database:fetcher');

export interface FetchResult {
  /**
   * True if a fresh download just landed on disk; false if the cached file is
   * up-to-date (callers can skip re-parsing if they tracked a successful
   * previous load).
   */
  refreshed: boolean;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function fetchRemoteEtag(url: string): Promise<string | null> {
  try {
    const response = await makeRequest(url, { method: 'HEAD', timeout: 15000 });
    return response.headers.get('etag');
  } catch (err) {
    logger.warn({ url, err }, 'failed to fetch remote etag');
    return null;
  }
}

async function streamResponseToFile(
  url: string,
  filePath: string,
  etagPath: string,
  remoteEtag: string | null
): Promise<void> {
  const start = Date.now();
  const response = await makeRequest(url, { method: 'GET', timeout: 90_000 });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  if (!response.body) throw new Error('No response body to stream');

  await fs.mkdir(ANIME_DATABASE_PATH, { recursive: true });

  await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));

  const etag = remoteEtag ?? response.headers.get('etag');
  if (etag) await fs.writeFile(etagPath, etag);

  logger.info(
    { file: path.basename(filePath), timeTaken: getTimeTakenSincePoint(start) },
    'downloaded file'
  );
}

/**
 * Download `url` to `filePath` if our local copy is missing or its ETag
 * doesn't match the remote ETag. Retries once on failure. Returns whether a
 * fresh download landed.
 */
export async function fetchWithEtag(
  source: string,
  url: string,
  filePath: string
): Promise<FetchResult> {
  const etagPath = etagPathFor(filePath);
  return withRetry(
    async () => {
      const remoteEtag = await fetchRemoteEtag(url);
      const localEtag = await readFileOrNull(etagPath);

      const isMissing = !(await fileExists(filePath));
      const isOutOfDate = !remoteEtag || !localEtag || remoteEtag !== localEtag;
      const fetchFromRemote = isMissing || isOutOfDate;

      if (!fetchFromRemote) {
        logger.info({ source }, 'source up to date');
        return { refreshed: false };
      }

      logger.info(
        {
          source,
          reason: isMissing
            ? 'missing'
            : !remoteEtag
              ? 'no remote etag'
              : !localEtag
                ? 'no local etag'
                : 'etag mismatch',
        },
        'triggering download'
      );
      await streamResponseToFile(url, filePath, etagPath, remoteEtag);
      return { refreshed: true };
    },
    { getContext: () => source }
  );
}

/**
 * Force the next refresh to download by deleting the cached file + etag.
 * Used when a parse step throws against cached data (probably corrupt).
 */
export async function invalidateCache(filePath: string): Promise<void> {
  const etagPath = etagPathFor(filePath);
  await Promise.allSettled([fs.unlink(filePath), fs.unlink(etagPath)]);
}
