import { Router, type Request, type Response } from 'express';
import {
  config as appConfig,
  createLogger,
  lookupFor,
  couldHaveSegments,
  isMemoFresh,
  playableSources,
  resolveByItem,
  segmentsFor,
  resolveByMediaSource,
  resolveByPlaySession,
  type ContentDescriptor,
  type DeviceProfile,
  type MediaSourceRecord,
  type PlaybackMemo,
} from '@aiostreams/core';
import {
  bodyOf,
  contextFromCredentials,
  jfOptional,
  param,
  qs,
  WEB_APP_CLIENT,
  type JellyfinRequestContext,
} from './context.js';
import {
  decodeForRequest,
  mediaSourcesFrom,
  nothingToPlayPath,
  placeholderSources,
} from './items.js';
import { enrichSourceSubtitles, resolvePlayback } from './resolve.js';

const logger = createLogger('jellyfin');
const router: Router = Router({ mergeParams: true });

interface Located {
  ctx: JellyfinRequestContext;
  descriptor: ContentDescriptor;
  itemId: string;
  memo: PlaybackMemo | null;
  /** The source id the client named, when it is not the item id. */
  requestedMsid?: string;
}

/**
 * Finds the config and item behind a request that may carry no credential:
 * the token or path if present, else the play session or media source id
 * recorded by PlaybackInfo.
 */
async function locate(
  req: Request,
  rawItemId: string,
  /* Routes that carry the source id in the path rather than the query. */
  hintMsid?: string
): Promise<Located | null> {
  const psid = qs(req, 'PlaySessionId');
  const rawMsid =
    qs(req, 'MediaSourceId') ??
    (bodyOf(req).MediaSourceId as string | undefined) ??
    hintMsid;
  let ctx = req.jf;

  if (!ctx) {
    const pointer =
      (psid ? await resolveByPlaySession(psid) : undefined) ??
      (rawMsid &&
      rawMsid.replace(/-/g, '').toLowerCase() !==
        rawItemId.replace(/-/g, '').toLowerCase()
        ? await resolveByMediaSource(rawMsid.replace(/-/g, '').toLowerCase())
        : undefined) ??
      (await resolveByMediaSource(rawItemId.replace(/-/g, '').toLowerCase()));
    if (!pointer) return null;
    ctx =
      (await contextFromCredentials(
        req,
        pointer.uuid,
        pointer.encryptedPassword
      )) ?? undefined;
    if (!ctx) return null;
  }

  let decoded = await decodeForRequest(ctx, rawItemId);
  let requestedMsid: string | undefined;
  if (decoded?.kind === 'source') {
    const pointer = await resolveByMediaSource(decoded.msid);
    if (!pointer || pointer.uuid !== ctx.uuid) return null;
    requestedMsid = decoded.msid;
    decoded = await decodeForRequest(ctx, pointer.itemId);
  }
  if (!decoded || decoded.kind !== 'descriptor') return null;
  const d = decoded.descriptor;
  if (
    d.k !== 'movie' &&
    d.k !== 'episode' &&
    d.k !== 'series' &&
    d.k !== 'boxset' &&
    d.k !== 'season'
  )
    return null;
  const itemId = rawItemId.replace(/-/g, '').toLowerCase();
  if (rawMsid) {
    const norm = rawMsid.replace(/-/g, '').toLowerCase();
    if (norm !== itemId) requestedMsid = norm;
  }
  const memo = await resolveByItem(ctx.uuid, ctx.scope(), itemId).then(
    (m) => m ?? null
  );
  return {
    ctx,
    descriptor: d as ContentDescriptor,
    itemId,
    memo,
    requestedMsid,
  };
}

/* A client retrying a failed play must not rerun the pipeline against an addon that is failing. */
const EMPTY_MEMO_REUSE_MS = 30_000;

async function ensureMemo(
  loc: Located,
  /* `current` reruns a memo past its reuse window, `force` any memo. */
  opts: { current?: boolean; force?: boolean } = {}
): Promise<PlaybackMemo | null> {
  const { memo, descriptor } = loc;
  const resolvable = descriptor.k === 'movie' || descriptor.k === 'episode';
  const rerun =
    resolvable && (opts.force || (opts.current && memo && !isMemoFresh(memo)));
  if (!rerun) {
    if (memo && playableSources(memo.sources).length) return memo;
    if (!resolvable) return null;
    if (memo && Date.now() - memo.createdAt < EMPTY_MEMO_REUSE_MS) return memo;
  }
  return resolvePlayback(loc.ctx, descriptor, { force: true });
}

/**
 * The web app resolves when its version list opens rather than when an item
 * opens, and can ask for a new run to retry addons that failed.
 */
function listingOptions(req: Request, loc: Located) {
  if (!req.jf || loc.ctx.client.name !== WEB_APP_CLIENT || loc.requestedMsid)
    return {};
  return { current: true, force: bodyOf(req).Refresh === true };
}

function pickSource(
  memo: PlaybackMemo,
  requestedMsid?: string
): MediaSourceRecord | undefined {
  return requestedMsid
    ? memo.sources.find((s) => s.msid === requestedMsid)
    : memo.sources[0];
}

/**
 * Answers "a provider covers this kind of item", not "we have some": a client
 * that gates its segments request on the flag needs it before anything has been
 * looked up. The lookup is warmed instead, and this runs on item open as well as
 * on play, so it has usually landed by the time the player asks.
 */
function hasSegments(ctx: JellyfinRequestContext, memo: PlaybackMemo): boolean {
  if (!appConfig.jellyfin.segments.enabled) return false;
  if (ctx.userData.jellyfin?.segments === false) return false;
  const lookup = lookupFor(memo.descriptor, memo.runtimeMs);
  const credentials = { pmdbApiKey: ctx.userData.pmdbApiKey };
  if (!lookup || !couldHaveSegments(lookup, credentials)) return false;
  void segmentsFor(lookup, credentials).catch(() => undefined);
  return true;
}

async function playbackInfo(req: Request, res: Response) {
  const loc = await locate(req, param(req, 'itemId'));
  if (!loc) {
    res
      .status(404)
      .json({ MediaSources: [], PlaySessionId: '', ErrorCode: 'NotAllowed' });
    return;
  }
  const profile = bodyOf(req).DeviceProfile as DeviceProfile | undefined;
  const memo = await ensureMemo(loc, listingOptions(req, loc));
  if (!memo || !memo.sources.length) {
    res.json({
      MediaSources: placeholderSources(req, loc.ctx, loc.itemId, true),
      PlaySessionId: memo?.psid ?? '',
      ErrorCode: 'NoCompatibleStream',
    });
    return;
  }
  await enrichSourceSubtitles(loc.ctx, memo, loc.requestedMsid);
  // A version no longer listed must not lend its id to another.
  const requested = memo.sources.some((s) => s.msid === loc.requestedMsid)
    ? loc.requestedMsid
    : undefined;
  const sources = mediaSourcesFrom(req, loc.ctx, memo, {
    // Other clients play the item's own id; the web app keeps a version's id.
    firstId:
      requested ??
      (loc.ctx.client.name === WEB_APP_CLIENT
        ? memo.sources[0].msid
        : loc.itemId),
    requestedMsid: requested,
    profile,
    hasSegments: hasSegments(loc.ctx, memo),
  });
  res.json({ MediaSources: sources, PlaySessionId: memo.psid });
}

router.get('/Items/:itemId/PlaybackInfo', jfOptional(playbackInfo));
router.post('/Items/:itemId/PlaybackInfo', jfOptional(playbackInfo));
router.get('/Items/:itemId/MediaSources', jfOptional(playbackInfo));

async function streamHandler(req: Request, res: Response) {
  const loc = await locate(req, param(req, 'itemId'));
  if (!loc) {
    res.status(404).json({ Message: 'Item not found' });
    return;
  }
  const memo = await ensureMemo(loc);
  const source = memo ? pickSource(memo, loc.requestedMsid) : undefined;
  if (!source) {
    res.status(404).json({ Message: 'No playable stream' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(
    302,
    source.notice ? nothingToPlayPath(req, loc.ctx) : source.url
  );
}

const STREAM_PATHS = [
  '/Videos/:itemId/stream',
  '/Videos/:itemId/stream.:ext',
  '/Videos/:itemId/stream/:filename',
  '/Videos/:itemId/original',
  '/Videos/:itemId/original.:ext',
  '/Items/:itemId/Download',
  '/Items/:itemId/File',
];
router.get(STREAM_PATHS, jfOptional(streamHandler));
router.head(STREAM_PATHS, jfOptional(streamHandler));

router.get(
  [
    '/Videos/:itemId/master.m3u8',
    '/Videos/:itemId/main.m3u8',
    '/Videos/:itemId/live.m3u8',
    '/Videos/:itemId/hls1/{*rest}',
    '/Videos/:itemId/hls/{*rest}',
  ],
  (_req, res) => {
    res.status(501).json({
      Message: 'Transcoding is not available; this server only direct plays.',
    });
  }
);

export { locate, ensureMemo, pickSource };
export default router;
