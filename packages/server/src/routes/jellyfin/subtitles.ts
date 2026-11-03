import { Router, type Request, type Response } from 'express';
import {
  Cache,
  convertSubtitle,
  createLogger,
  externalSubtitleFor,
  readBodyCapped,
  subtitleExtensionOf,
  type SubtitleFormat,
} from '@aiostreams/core';
import { jfOptional, param } from './context.js';
import { ensureMemo, locate, pickSource } from './playback.js';

const logger = createLogger('jellyfin');
const router: Router = Router({ mergeParams: true });

const bodyCache = Cache.getInstance<
  string,
  { body: string; contentType: string }
>('jellyfin-subtitle-body', 1000);
const BODY_TTL = 3600;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_CACHED_BYTES = 512 * 1024;

function formatOf(raw: string): SubtitleFormat {
  const f = raw.toLowerCase();
  if (f === 'js' || f === 'json') return 'json';
  if (f === 'srt' || f === 'subrip') return 'srt';
  if (f === 'ass' || f === 'ssa') return 'ass';
  return 'vtt';
}

/**
 * The subtitle, or the status to answer with. A provider that refuses the file
 * (a missing API key, a dead link) answers the same on a retry, so that is a
 * 404 and clients move on; one that is down or busy is a 502 worth retrying.
 */
export async function fetchSubtitle(
  url: string
): Promise<{ raw: string; cacheable: boolean } | { status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      logger.debug({ url, status: res.status }, 'subtitle fetch refused');
      const transient =
        res.status >= 500 || res.status === 408 || res.status === 429;
      return { status: transient ? 502 : 404 };
    }

    return {
      raw: (await readBodyCapped(res, MAX_BYTES)).toString('utf8'),
      cacheable: !/\bno-(?:store|cache)\b/i.test(
        res.headers.get('cache-control') ?? ''
      ),
    };
  } catch (error) {
    logger.debug(
      { url, err: error instanceof Error ? error.message : String(error) },
      'subtitle fetch failed'
    );
    return { status: 502 };
  } finally {
    clearTimeout(timer);
  }
}

async function subtitleHandler(req: Request, res: Response) {
  const msid = param(req, 'mediaSourceId').replace(/-/g, '').toLowerCase();
  const loc = await locate(req, param(req, 'itemId'), {
    hintMsid: msid,
    bySession: true,
  });
  if (!loc) {
    res.status(404).end();
    return;
  }
  const memo = await ensureMemo(loc);
  if (!memo) {
    res.status(404).end();
    return;
  }
  const source = pickSource(memo, loc.requestedMsid);
  const track = source
    ? externalSubtitleFor(source, Number(param(req, 'index')))
    : undefined;
  if (!track) {
    res.status(404).end();
    return;
  }
  const to = formatOf(param(req, 'format'));
  const key = `${track.url}|${to}`;
  let converted = await bodyCache.get(key).catch(() => undefined);
  let cacheable = true;
  if (!converted) {
    const fetched = await fetchSubtitle(track.url);
    if ('status' in fetched) {
      res.status(fetched.status).end();
      return;
    }
    converted = convertSubtitle(
      fetched.raw,
      subtitleExtensionOf(track.url),
      to
    );
    cacheable = fetched.cacheable;
    if (
      cacheable &&
      Buffer.byteLength(converted.body, 'utf8') <= MAX_CACHED_BYTES
    ) {
      void bodyCache.set(key, converted, BODY_TTL).catch(() => undefined);
    }
  }
  res.setHeader('Content-Type', converted.contentType);
  res.setHeader(
    'Cache-Control',
    cacheable ? 'public, max-age=3600' : 'no-store'
  );
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(converted.body);
}

router.get(
  [
    '/Videos/:itemId/:mediaSourceId/Subtitles/:index/Stream.:format',
    '/Videos/:itemId/:mediaSourceId/Subtitles/:index/:start/Stream.:format',
  ],
  jfOptional(subtitleHandler)
);

export default router;
