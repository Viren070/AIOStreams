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
  return metahubFor(d, type);
}

/**
 * Infuse does not follow redirects for images, so its artwork has to be piped.
 * Artwork is usually requested without a credential, which leaves the client
 * name unknown, so the user-agent is checked too.
 */
function shouldRelay(req: Request): boolean {
  if (appConfig.jellyfin.imageDelivery === 'relay') return true;
  return /infuse/i.test(
    `${req.jfClient?.name ?? ''} ${req.get('user-agent') ?? ''}`
  );
}

async function relay(req: Request, res: Response, url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    const inm = req.get('if-none-match');
    if (inm) headers['if-none-match'] = inm;
    const upstream = await fetch(url, { headers, signal: controller.signal });
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
  if (req.method === 'HEAD' && !shouldRelay(req)) {
    res.status(200).end();
    return;
  }
  if (shouldRelay(req)) {
    await relay(req, res, url);
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.redirect(302, url);
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
  const url = tag ? decodeImageTag(tag) : null;
  if (!url) {
    res.status(404).end();
    return;
  }
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
