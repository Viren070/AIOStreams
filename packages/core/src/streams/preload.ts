import pLimit from 'p-limit';
import { ParsedStream } from '../db/schemas.js';
import { createLogger, makeUrlLogSafe, Env } from '../utils/index.js';
import { Wrapper } from '../wrapper.js';
import { Response } from 'undici';

const logger = createLogger('core:preload');

const PING_TIMEOUT_MS = 10_000;

/**
 * Send a single no-redirect HTTP GET to a stream's URL, respecting the
 * stream's addon proxy/header configuration via Wrapper.makeRequest.
 * Returns the raw Response so callers can inspect the status if needed.
 */
export async function pingStream(
  stream: ParsedStream,
  timeoutMs = PING_TIMEOUT_MS
): Promise<Response> {
  if (!stream.url) {
    throw new Error('pingStream: stream has no URL');
  }
  const wrapper = new Wrapper(stream.addon);
  return wrapper.makeRequest(stream.url, {
    timeout: timeoutMs,
    rawOptions: { redirect: 'manual' },
  });
}

/**
 * Fire-and-forget HTTP GET requests to the URLs of the given streams.
 * Used to kick off pre-loading (e.g. NZB downloads) before the user clicks.
 */
export async function preloadStreams(streams: ParsedStream[]): Promise<void> {
  const eligible = streams.filter((s) => s.url);
  if (eligible.length === 0) {
    logger.debug('No streams to preload');
    return;
  }

  logger.info(`Preloading ${eligible.length} streams`);

  const limit = pLimit(Env.PRELOAD_STREAMS_CONCURRENCY);
  await Promise.all(
    eligible.map((stream) =>
      limit(async () => {
        try {
          const response = await pingStream(stream);
          response.body?.cancel().catch(() => undefined);
          logger.debug('Preload request sent', {
            url: makeUrlLogSafe(stream.url!),
            status: response.status,
            redirectHost: (() => {
              const location = response.headers.get('location');
              if (!location) return 'no redirect';
              try {
                return new URL(location).host;
              } catch {
                return 'invalid URL';
              }
            })(),
          });
        } catch (error) {
          logger.debug('Preload request failed', {
            url: makeUrlLogSafe(stream.url!),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
    )
  );
}
