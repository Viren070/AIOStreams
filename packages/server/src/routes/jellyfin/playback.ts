import { Router, type Request, type Response } from 'express';
import {
  config as appConfig,
  createLogger,
  lookupFor,
  couldHaveSegments,
  isMemoFresh,
  offeredSources,
  playableSources,
  resolveByItem,
  segmentsFor,
  resolveByMediaSource,
  resolveByPlaySession,
  resolveByClient,
  writeClientSession,
  type ContentDescriptor,
  type DeviceProfile,
  type MediaSourceRecord,
  type MemoPointer,
  type PlaybackMemo,
  type PlaySupport,
} from '@aiostreams/core';
import {
  bodyField,
  bodyOf,
  contextFromCredentials,
  jfOptional,
  param,
  qs,
  type JellyfinRequestContext,
} from './context.js';
import {
  decodeForRequest,
  mediaSourcesFrom,
  trackPreferences,
  nothingToPlayPath,
  placeholderSources,
} from './items.js';
import {
  applyProbedMediaInfo,
  enrichSourceSubtitles,
  maxVersionsFor,
  resolvePlayback,
} from './resolve.js';

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
  opts: {
    /* Routes that carry the source id in the path rather than the query. */
    hintMsid?: string;
    /* The session's list, which the request itself may no longer select. */
    bySession?: boolean;
  } = {}
): Promise<Located | null> {
  const psid = qs(req, 'PlaySessionId');
  const bodyMsid = bodyField(req, 'MediaSourceId');
  const rawMsid =
    qs(req, 'MediaSourceId') ??
    (typeof bodyMsid === 'string' && bodyMsid ? bodyMsid : undefined) ??
    opts.hintMsid;
  const itemId = rawItemId.replace(/-/g, '').toLowerCase();
  let ctx = req.jf;
  let session: MemoPointer | undefined;
  if (psid && (!ctx || opts.bySession))
    session = await resolveByPlaySession(psid);
  else if (ctx && opts.bySession)
    session = await resolveByClient(ctx.token, itemId);

  if (!ctx) {
    const pointer =
      session ??
      (rawMsid && rawMsid.replace(/-/g, '').toLowerCase() !== itemId
        ? await resolveByMediaSource(rawMsid.replace(/-/g, '').toLowerCase())
        : undefined) ??
      (await resolveByMediaSource(itemId));
    if (!pointer) return null;
    ctx =
      (await contextFromCredentials(
        req,
        pointer.uuid,
        pointer.encryptedPassword,
        pointer.persona
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
  if (rawMsid) {
    const norm = rawMsid.replace(/-/g, '').toLowerCase();
    if (norm !== itemId) requestedMsid = norm;
  }
  // No persona check: personas on the same variants share a memo and its session.
  const scope =
    opts.bySession && session?.scope && session.uuid === ctx.uuid
      ? session.scope
      : ctx.scope();
  const memo = await resolveByItem(ctx.uuid, scope, itemId).then(
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
 * A client that lists versions here rather than from the item page can ask
 * for a list no older than the reuse window (`Fresh`) or a new run that
 * retries failed addons (`Refresh`). A named version keeps its list.
 */
function listingOptions(req: Request, loc: Located) {
  if (!req.jf || loc.requestedMsid) return {};
  const body = bodyOf(req);
  return { current: body.Fresh === true, force: body.Refresh === true };
}

// These clients ask for PlaybackInfo only from their player, without IsPlayback.
const PLAY_ONLY_CLIENTS =
  /^(jellyfin for android|swiftfin|wholphin|fladder|pelagica|blink)\b/i;
// ARVIO's Android app sends IsPlayback while listing versions, then plays the
// listed URL without asking again.
const LISTING_CLIENTS = /^arvio$/i;

function isPlaying(req: Request, loc: Located): boolean {
  if (loc.requestedMsid) return true;
  if (LISTING_CLIENTS.test(loc.ctx.client.name)) return false;
  const flag = qs(req, 'IsPlayback') ?? bodyField(req, 'IsPlayback');
  if (flag !== undefined) return flag === 'true' || flag === true;
  return PLAY_ONLY_CLIENTS.test(loc.ctx.client.name);
}

/** Without an id, the first version every client is offered. */
function pickSource(
  memo: PlaybackMemo,
  requestedMsid?: string
): MediaSourceRecord | undefined {
  return requestedMsid
    ? memo.sources.find((s) => s.msid === requestedMsid)
    : memo.sources.find((s) => !s.needs);
}

function playSupportOf(req: Request): PlaySupport {
  const body = bodyOf(req);
  return {
    headers: body.EnableRequiredHttpHeaders === true,
    youtube: body.EnableYouTube === true,
  };
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
  const support = playSupportOf(req);
  const memo = await ensureMemo(loc, listingOptions(req, loc));
  const offered = memo
    ? offeredSources(memo.sources, support, maxVersionsFor(loc.ctx))
    : [];
  if (!memo || !offered.length) {
    res.json({
      MediaSources: placeholderSources(req, loc.ctx, loc.itemId, true),
      PlaySessionId: memo?.psid ?? '',
      ErrorCode: 'NoCompatibleStream',
    });
    return;
  }
  if (req.jf)
    await writeClientSession(
      req.jf.token,
      memo,
      loc.ctx.scope(),
      loc.ctx.persona?.id
    );
  const target = loc.requestedMsid ?? offered[0].msid;
  await enrichSourceSubtitles(loc.ctx, memo, target);
  await applyProbedMediaInfo(loc.ctx, memo, target, {
    playing: isPlaying(req, loc),
  });
  // A version no longer listed must not lend its id to another.
  const requested = offered.some((s) => s.msid === loc.requestedMsid)
    ? loc.requestedMsid
    : undefined;
  const sources = mediaSourcesFrom(req, loc.ctx, memo, {
    firstId: requested ?? loc.itemId,
    tracks: await trackPreferences(loc.ctx),
    requestedMsid: requested,
    onlyRequested: true,
    support,
    profile,
    hasSegments: hasSegments(loc.ctx, memo),
  });
  res.json({ MediaSources: sources, PlaySessionId: memo.psid });
}

router.get('/Items/:itemId/PlaybackInfo', jfOptional(playbackInfo));
router.post('/Items/:itemId/PlaybackInfo', jfOptional(playbackInfo));
router.get('/Items/:itemId/MediaSources', jfOptional(playbackInfo));

async function streamHandler(req: Request, res: Response) {
  const loc = await locate(req, param(req, 'itemId'), { bySession: true });
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
