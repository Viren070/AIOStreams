import { Router, type Request, type Response } from 'express';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import {
  config as appConfig,
  createLogger,
  decodeImageTag,
  decodeItemId,
  personaUserId,
  pickImage,
  recallImages,
  resolveByMediaSource,
  type ContentDescriptor,
} from '@aiostreams/core';
import {
  contextFromCredentials,
  jfOptional,
  param,
  personasOf,
  qi,
  qs,
} from './context.js';
import { itemFromDescriptor } from './items.js';

const logger = createLogger('jellyfin');
const router: Router = Router({ mergeParams: true });

const FALLBACK_IMAGE = '/logo.png';
const RELAY_TIMEOUT_MS = 15_000;

function metahubFor(d: ContentDescriptor, type: string): string | null {
  if (!d.i.startsWith('tt')) return null;
  const base = `https://images.metahub.space`;
  switch (type.toLowerCase()) {
    case 'primary':
    case 'thumb':
      return d.k === 'episode'
        ? `${base}/background/medium/${d.i}/img`
        : `${base}/poster/medium/${d.i}/img`;
    case 'backdrop':
    case 'art':
    case 'banner':
      return `${base}/background/medium/${d.i}/img`;
    case 'logo':
      return `${base}/logo/medium/${d.i}/img`;
    default:
      return null;
  }
}

/** Tag first (it carries the URL), then what an item build remembered, then metahub. */
async function imageUrlFor(
  req: Request,
  rawId: string,
  type: string
): Promise<string | null> {
  const tag = qs(req, 'tag');
  if (tag) {
    const fromTag = decodeImageTag(tag);
    if (fromTag) return fromTag;
  }
  const id = rawId.replace(/-/g, '').toLowerCase();
  const remembered = pickImage(await recallImages(id), type);
  if (remembered) return remembered;

  let decoded = await decodeItemId(id);
  if (decoded?.kind === 'source') {
    const pointer = await resolveByMediaSource(decoded.msid);
    decoded = pointer ? await decodeItemId(pointer.itemId) : null;
  }
  if (!decoded || decoded.kind !== 'descriptor') return null;
  const d = decoded.descriptor;
  if (
    d.k !== 'view' &&
    d.k !== 'movie' &&
    d.k !== 'series' &&
    d.k !== 'boxset' &&
    d.k !== 'season' &&
    d.k !== 'episode'
  )
    return null;

  if (req.jf) {
    try {
      await itemFromDescriptor(req.jf, d);
      const rebuilt = pickImage(await recallImages(id), type);
      if (rebuilt) return rebuilt;
    } catch (error) {
      logger.debug(
        { id, err: error instanceof Error ? error.message : String(error) },
        'image rebuild failed'
      );
    }
  }
  return d.k === 'view' ? null : metahubFor(d, type);
}

/**
 * Infuse does not follow redirects for images, so its artwork has to be piped.
 * Artwork is usually requested without a credential, which leaves the client
 * name unknown, so the user-agent is checked too.
 */
function shouldRelay(req: Request): boolean {
  if (appConfig.jellyfin.imageDelivery === 'never-relay') return false;
  if (appConfig.jellyfin.imageDelivery === 'relay') return true;
  return /infuse/i.test(
    `${req.jfClient?.name ?? ''} ${req.get('user-agent') ?? ''}`
  );
}

/** The width a client asked for, under whichever name it used. */
function requestedWidth(req: Request): number | undefined {
  for (const name of ['maxWidth', 'fillWidth', 'width']) {
    const width = qi(req, name, 0);
    if (width > 0) return width;
  }
  return undefined;
}

const TMDB = /^https:\/\/image\.tmdb\.org\/t\/p\/(?:w(\d+)|original)\//;
// TMDB serves any of these for any kind of image, and nothing in between.
const TMDB_WIDTHS = [45, 92, 154, 185, 300, 342, 500, 780, 1280];

const TVDB = 'https://artworks.thetvdb.com/banners/';
const TVDB_THUMBS: [RegExp, number][] = [
  [/\/posters\//, 340],
  [/\/(fanart|backgrounds)\//, 640],
];

const METAHUB =
  /^https:\/\/images\.metahub\.space\/(poster|background)\/(small|medium|large)\//;
const METAHUB_WIDTHS: Record<string, Record<string, number>> = {
  poster: { small: 300, medium: 500, large: 780 },
  background: { small: 480, medium: 1920, large: 1920 },
};
const METAHUB_STILL =
  /^(https:\/\/episodes\.metahub\.space\/.+\/)w(\d+)(\.jpg)$/;
const METAHUB_STILL_WIDTHS = [185, 300, 500, 780];

// AIOMetadata's poster cache, which names the image it serves in its own path.
const POSTER_CACHE =
  /^(https?:\/\/[^/]+\/poster-cache\/(?:[a-z]+\/)?)(https?):(\/\/?)(.+)$/;

/**
 * The smallest rendition at least `width` wide, for hosts whose URLs name
 * one, and never larger than the URL already asks for.
 */
function sized(url: string, width: number): string {
  const cached = POSTER_CACHE.exec(url);
  if (cached) {
    const [, prefix, scheme, slashes, rest] = cached;
    const inner = sized(`${scheme}://${rest}`, width);
    return `${prefix}${inner.replace('://', `:${slashes}`)}`;
  }
  const tmdb = TMDB.exec(url);
  if (tmdb) {
    const current = tmdb[1] ? Number(tmdb[1]) : Infinity;
    const pick = TMDB_WIDTHS.find((w) => w >= width);
    return pick && pick < current
      ? url.replace(tmdb[0], `https://image.tmdb.org/t/p/w${pick}/`)
      : url;
  }
  if (url.startsWith(TVDB) && !/_t\.\w+$/.test(url)) {
    const thumb = TVDB_THUMBS.find(([path]) => path.test(url));
    return thumb && width <= thumb[1] ? url.replace(/(\.\w+)$/, '_t$1') : url;
  }
  const metahub = METAHUB.exec(url);
  if (metahub) {
    const [prefix, kind, size] = metahub;
    const widths = METAHUB_WIDTHS[kind];
    const pick = Object.keys(widths).find((s) => widths[s] >= width);
    return pick && widths[pick] < widths[size]
      ? url.replace(prefix, prefix.replace(`/${size}/`, `/${pick}/`))
      : url;
  }
  const still = METAHUB_STILL.exec(url);
  if (still) {
    const pick = METAHUB_STILL_WIDTHS.find((w) => w >= width);
    return pick && pick < Number(still[2])
      ? `${still[1]}w${pick}${still[3]}`
      : url;
  }
  return url;
}

/* Relays in flight per process; artwork arrives in bursts and each one holds
 * a socket open for as long as the upstream takes. */
let liveRelays = 0;

async function relay(req: Request, res: Response, url: string) {
  if (liveRelays >= appConfig.jellyfin.imageRelayConcurrency) {
    // Better a redirect the client may not follow than an unbounded queue.
    res.redirect(302, url);
    return;
  }
  liveRelays++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    const inm = req.get('if-none-match');
    if (inm) headers['if-none-match'] = inm;
    const upstream = await fetch(url, { headers, signal: controller.signal });
    const declared = Number(upstream.headers.get('content-length') ?? 0);
    if (declared > appConfig.jellyfin.imageMaxRelayBytes) {
      logger.debug({ url, bytes: declared }, 'image too large to relay');
      res.redirect(302, url);
      return;
    }
    res.status(upstream.status);
    for (const h of [
      'content-type',
      'content-length',
      'etag',
      'last-modified',
      'cache-control',
      'expires',
    ]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!res.getHeader('cache-control'))
      res.setHeader('Cache-Control', 'public, max-age=86400');
    if (!upstream.body || upstream.status === 304 || req.method === 'HEAD') {
      res.end();
      return;
    }
    await pipeline(
      Readable.fromWeb(upstream.body as import('stream/web').ReadableStream),
      res
    ).catch(() => undefined);
  } catch (error) {
    logger.debug(
      { url, err: error instanceof Error ? error.message : String(error) },
      'image relay failed'
    );
    if (!res.headersSent) res.redirect(302, url);
  } finally {
    clearTimeout(timer);
    liveRelays--;
  }
}

async function itemImage(req: Request, res: Response) {
  const url = await imageUrlFor(
    req,
    param(req, 'itemId'),
    param(req, 'type')
  ).catch(() => null);
  if (!url) {
    res.status(404).end();
    return;
  }
  const relaying = shouldRelay(req);
  if (req.method === 'HEAD' && !relaying) {
    res.status(200).end();
    return;
  }
  // A relay asked for no size still avoids piping an original.
  const width =
    requestedWidth(req) ??
    (relaying
      ? /backdrop|thumb/i.test(param(req, 'type'))
        ? 1280
        : 780
      : undefined);
  const target = width ? sized(url, width) : url;
  if (relaying) {
    await relay(req, res, target);
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.redirect(302, target);
}

const ITEM_IMAGE_PATHS = [
  '/Items/:itemId/Images/:type',
  '/Items/:itemId/Images/:type/:index',
];
router.get(ITEM_IMAGE_PATHS, jfOptional(itemImage));
router.head(ITEM_IMAGE_PATHS, jfOptional(itemImage));

router.get(
  '/Items/:itemId/Images',
  jfOptional(async (req, res) => {
    const images =
      (await recallImages(
        param(req, 'itemId').replace(/-/g, '').toLowerCase()
      )) ?? {};
    res.json(
      Object.entries(images)
        .filter(([, v]) => !!v)
        .map(([k]) => ({
          ImageType: k,
          ImageIndex: k === 'Backdrop' ? 0 : undefined,
          Path: '',
          Size: 0,
          Width: 0,
          Height: 0,
        }))
    );
  })
);

async function personImage(req: Request, res: Response) {
  const tag = qs(req, 'tag');
  const decoded = tag ? decodeImageTag(tag) : null;
  if (!decoded) {
    res.status(404).end();
    return;
  }
  const width = requestedWidth(req);
  const url = width ? sized(decoded, width) : decoded;
  if (shouldRelay(req)) {
    await relay(req, res, url);
    return;
  }
  res.redirect(302, url);
}
router.get(
  ['/Persons/:name/Images/:type', '/Persons/:name/Images/:type/:index'],
  jfOptional(personImage)
);

/* Anonymous on the picker, where the address is the credential. */
router.get(
  ['/Users/:userId/Images/:type', '/Users/:userId/Images/:type/:index'],
  jfOptional(async (req, res, ctx) => {
    const wanted = param(req, 'userId').toLowerCase();
    let avatar: string | undefined;
    if (ctx && wanted === personaUserId(ctx.uuid, '')) {
      avatar = ctx.userData.jellyfin?.primary?.avatar;
    } else if (ctx) {
      avatar = personasOf(ctx.userData).find(
        (p) => personaUserId(ctx.uuid, p.id) === wanted
      )?.avatar;
    }
    if (!avatar) {
      res.status(404).end();
      return;
    }
    if (shouldRelay(req)) {
      await relay(req, res, avatar);
      return;
    }
    res.redirect(302, avatar);
  })
);

router.get(
  ['/UserImage', '/Branding/Splashscreen', '/Images/General/:name/:type'],
  (_req, res) => {
    res.redirect(302, FALLBACK_IMAGE);
  }
);

export { contextFromCredentials };
export default router;
