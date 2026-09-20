import {
  addonSubtitleTracks,
  config as appConfig,
  constants,
  createFormatter,
  createLogger,
  DistributedLock,
  hasProgrammeVideos,
  encodeItemId,
  requestLockType,
  isPlayable,
  resolveMarkerId as markerIdFor,
  newPlaySessionId,
  noticeRecordFrom,
  parseRuntimeMs,
  playableSources,
  rememberShowEpisodes,
  labelFrom,
  isMemoFresh,
  resolveByItem,
  sourceRecordFrom,
  writePlaybackMemo,
  type ContentDescriptor,
  type MediaSourceRecord,
  type ParsedMeta,
  type ParsedStream,
  type PlaybackMemo,
  type SubtitleTrack,
} from '@aiostreams/core';
import type { JellyfinRequestContext } from './context.js';

const logger = createLogger('jellyfin');

/** Anime metas are often served under `series`, and the other way round. */
export function getMetaLoose(
  ctx: JellyfinRequestContext,
  type: string,
  id: string
): Promise<ParsedMeta | null> {
  const key = `${type}|${id}`;
  let pending = ctx.metas.get(key);
  if (!pending) {
    pending = fetchMetaLoose(ctx, type, id);
    ctx.metas.set(key, pending);
  }
  return pending;
}

async function fetchMetaLoose(
  ctx: JellyfinRequestContext,
  type: string,
  id: string
): Promise<ParsedMeta | null> {
  const engine = await ctx.engine();
  const order =
    type === 'anime'
      ? [type, 'series']
      : type === 'series'
        ? [type, 'anime']
        : [type];
  for (const t of order) {
    try {
      const res = await engine.getMeta(t, id);
      if (res.data) {
        if (
          type !== 'movie' &&
          res.data.videos?.length &&
          !hasProgrammeVideos(res.data)
        ) {
          rememberShowEpisodes(ctx.scope(), type, id, res.data);
        }
        return res.data;
      }
    } catch (error) {
      logger.debug(
        {
          type: t,
          id,
          err: error instanceof Error ? error.message : String(error),
        },
        'meta failed'
      );
    }
  }
  return null;
}

export interface PlayTarget {
  type: string;
  videoId: string;
  runtimeMs?: number;
  streams?: ParsedStream[];
}

type MetaVideo = NonNullable<ParsedMeta['videos']>[number] &
  Record<string, unknown>;

/**
 * Stream requests use the root type and the video's id; a movie may name its
 * playable id in `defaultVideoId`.
 */
export async function playTargetFor(
  ctx: JellyfinRequestContext,
  d: ContentDescriptor
): Promise<PlayTarget | null> {
  if (d.k === 'episode') {
    const meta = await getMetaLoose(ctx, d.t, d.i).catch(() => null);
    const video = meta?.videos?.find((v) => v.id === d.v) as
      | MetaVideo
      | undefined;
    return {
      type: d.t,
      videoId: d.v,
      runtimeMs:
        parseRuntimeMs(video?.runtime) ?? parseRuntimeMs(meta?.runtime),
      streams: video?.streams ?? undefined,
    };
  }
  if (d.k === 'movie') {
    // A collection's movie is one of its parent's videos.
    const meta = await getMetaLoose(ctx, d.t, d.p ?? d.i).catch(() => null);
    const hinted = d.p ? undefined : meta?.behaviorHints?.defaultVideoId;
    const videoId = typeof hinted === 'string' && hinted ? hinted : d.i;
    const video = meta?.videos?.find((v) => v.id === videoId) as
      | MetaVideo
      | undefined;
    const runtimeMs =
      parseRuntimeMs(video?.runtime) ??
      (d.p
        ? parseRuntimeMs(
            (await getMetaLoose(ctx, d.t, d.i).catch(() => null))?.runtime
          )
        : parseRuntimeMs(meta?.runtime));
    return {
      type: d.t,
      videoId,
      runtimeMs,
      streams: video?.streams ?? undefined,
    };
  }
  return null;
}

function maxVersionsFor(ctx: JellyfinRequestContext): number {
  const cap = appConfig.jellyfin.maxVersions;
  const wanted = ctx.userData.jellyfin?.maxVersions ?? cap;
  return Math.max(1, Math.min(cap, wanted));
}

const NOTICE_TYPES: string[] = [
  constants.EXTERNAL_STREAM_TYPE,
  constants.INFO_STREAM_TYPE,
];

/**
 * Streams with nothing to play but something to say. A link that repeats a
 * stream already in the list is left out; it would only be that stream again.
 */
function noticeStreamsOf(
  all: ParsedStream[],
  playable: ParsedStream[]
): ParsedStream[] {
  const playableUrls = new Set(
    playable.map((stream) => stream.url).filter(Boolean)
  );
  return all.filter(
    (stream) =>
      !isPlayable(stream) &&
      NOTICE_TYPES.includes(stream.type) &&
      !(stream.externalUrl && playableUrls.has(stream.externalUrl))
  );
}

function showErrors(ctx: JellyfinRequestContext): boolean {
  return (
    !ctx.userData.hideErrors &&
    !ctx.userData.hideErrorsForResources?.includes('stream')
  );
}

/**
 * Runs the stream pipeline once for an item and records everything the
 * anonymous routes need. Reuses a live memo unless `force` is set.
 *
 * Concurrent resolves of one item share a single run, across replicas when
 * there is Redis: each run writes its own source list, and a client holding
 * one list's ids must not be served from another's.
 */
export async function resolvePlayback(
  ctx: JellyfinRequestContext,
  d: ContentDescriptor,
  opts: { force?: boolean } = {}
): Promise<PlaybackMemo | null> {
  const itemId = encodeItemId(d);
  const scope = ctx.scope();
  if (!opts.force) {
    // An empty result is cached too, so a title with nothing available is not
    // re-resolved on every open; the TTL is what retries it.
    const existing = await resolveByItem(ctx.uuid, scope, itemId);
    if (existing && isMemoFresh(existing)) return existing;
  }

  let ran = false;
  let resolved: PlaybackMemo | null = null;
  const run = async () => {
    ran = true;
    resolved = await resolveUncached(ctx, d, itemId, scope);
    return true;
  };
  const wait = appConfig.userLimits.timeouts.maxTimeout + 10_000;
  try {
    const { cached } = await DistributedLock.getInstance().withLock(
      `jellyfin-resolve:${ctx.uuid}|${scope}|${itemId}`,
      run,
      { type: requestLockType(), timeout: wait, ttl: wait }
    );
    if (!cached) return resolved;
  } catch (error) {
    if (ran) throw error;
    // The shared run failed or never reported back, so try it here.
    return resolveUncached(ctx, d, itemId, scope);
  }
  // The memo, not the lock, carries the result, so it is never published.
  return (await resolveByItem(ctx.uuid, scope, itemId)) ?? null;
}

/** Live by the content when the url says nothing: a channel, or a schedule. */
function isLiveContent(type: string, meta: ParsedMeta | null): boolean {
  return type === 'tv' || type === 'channel' || hasProgrammeVideos(meta);
}

async function resolveUncached(
  ctx: JellyfinRequestContext,
  d: ContentDescriptor,
  itemId: string,
  scope: string
): Promise<PlaybackMemo | null> {
  const target = await playTargetFor(ctx, d);
  if (!target) return null;

  const engine = await ctx.engine();
  const liveContent = isLiveContent(
    target.type,
    await getMetaLoose(ctx, d.t, d.k === 'movie' ? (d.p ?? d.i) : d.i).catch(
      () => null
    )
  );
  /* Copied, not marked in place: the pipeline result is cached and shared. */
  const asLive = (stream: ParsedStream): ParsedStream =>
    liveContent && stream.type !== 'live'
      ? { ...stream, type: constants.LIVE_STREAM_TYPE }
      : stream;
  const inline = (target.streams ?? []) as ParsedStream[];
  const ownPlayable = inline.filter(isPlayable);
  const streamsRes = ownPlayable.length
    ? undefined
    : await engine.getStreams(target.videoId, target.type);
  const all = (
    ownPlayable.length ? inline : (streamsRes?.data?.streams ?? [])
  ) as ParsedStream[];
  const playable = all.filter(isPlayable);
  const addonSubtitles: SubtitleTrack[] = [];

  const streamContext = engine.getStreamContext();
  const formatter = streamContext
    ? createFormatter(streamContext.toFormatterContext(playable))
    : null;
  const format = async (stream: ParsedStream) => {
    const fallback = {
      name: stream.originalName || stream.addon.name,
      description: stream.originalDescription || '',
    };
    if (!formatter || stream.addon.formatPassthrough) return fallback;
    try {
      return await formatter.format(stream);
    } catch {
      return fallback;
    }
  };
  const top = playable.slice(0, maxVersionsFor(ctx));

  const sources: MediaSourceRecord[] = [];
  for (const raw of top) {
    const stream = asLive(raw);
    const formatted = await format(stream);
    sources.push(
      sourceRecordFrom(
        ctx.uuid,
        stream,
        formatted,
        labelFrom(formatted, stream),
        addonSubtitles
      )
    );
  }

  /* Last and outside the version cap: the first source is what a client plays
   * when it is given no choice. */
  const notice = (
    label: string,
    type: string,
    text: { name: string; description: string },
    addon = ''
  ) =>
    sources.push(
      noticeRecordFrom(ctx.uuid, `notice|${itemId}|${sources.length}`, label, {
        ...text,
        addon,
        type,
      })
    );

  for (const stream of noticeStreamsOf(all, playable)) {
    const formatted = await format(stream);
    notice(
      labelFrom(formatted, stream),
      stream.type,
      formatted,
      stream.addon?.name ?? ''
    );
  }
  if (showErrors(ctx)) {
    for (const error of streamsRes?.errors ?? []) {
      const text = {
        name: error.title || appConfig.branding.addonName,
        description: error.description || 'Unknown error',
      };
      notice(labelFrom(text), constants.ERROR_STREAM_TYPE, text);
    }
  }
  for (const statistic of streamsRes?.data?.statistics ?? []) {
    if (!statistic.forced && !ctx.userData.statistics?.enabled) continue;
    const text = {
      name: statistic.title,
      description: statistic.description,
    };
    notice(labelFrom(text), constants.STATISTIC_STREAM_TYPE, text);
  }

  const memo: PlaybackMemo = {
    uuid: ctx.uuid,
    encryptedPassword: ctx.encryptedPassword,
    itemId,
    descriptor: d,
    type: target.type,
    videoId: target.videoId,
    psid: newPlaySessionId(),
    sources,
    addonSubtitles,
    runtimeMs: target.runtimeMs,
    createdAt: Date.now(),
  };
  await writePlaybackMemo(memo, scope);
  if (!playableSources(sources).length) {
    const reason = (streamsRes?.errors ?? [])
      .map((e) => [e.title, e.description].filter(Boolean).join(': '))
      .join('; ');
    logger.info(
      {
        uuid: ctx.uuid,
        itemId,
        type: target.type,
        videoId: target.videoId,
        reason,
      },
      'no playable streams'
    );
  }
  return memo;
}

function fileExtrasFor(record: MediaSourceRecord): string {
  const parts: string[] = [];
  if (record.videoHash) parts.push(`videoHash=${record.videoHash}`);
  if (record.size) parts.push(`videoSize=${record.size}`);
  if (record.filename)
    parts.push(`filename=${encodeURIComponent(record.filename)}`);
  return parts.join('&');
}

export async function enrichSourceSubtitles(
  ctx: JellyfinRequestContext,
  memo: PlaybackMemo,
  msid?: string
): Promise<void> {
  const record =
    (msid ? memo.sources.find((s) => s.msid === msid) : undefined) ??
    memo.sources[0];
  if (!record || record.notice || record.subtitlesEnriched) return;
  const extras = fileExtrasFor(record);

  const engine = await ctx.engine();
  const res = await engine
    .getSubtitles(memo.type, memo.videoId, extras || undefined)
    .catch((error) => {
      logger.debug(
        {
          itemId: memo.itemId,
          msid: record.msid,
          err: error instanceof Error ? error.message : String(error),
        },
        'file-matched subtitle request failed'
      );
      return null;
    });
  if (!res) return;

  const seen = new Set(record.subtitles.map((t) => t.url));
  let added = 0;
  for (const track of addonSubtitleTracks(res.data ?? [])) {
    if (!track.url || seen.has(track.url)) continue;
    seen.add(track.url);
    record.subtitles.push(track);
    added++;
  }
  record.subtitlesEnriched = true;
  logger.debug(
    { itemId: memo.itemId, msid: record.msid, added },
    'file-matched subtitles merged'
  );
  await writePlaybackMemo(memo, ctx.scope());
}

export function resolveMarkerId(
  ctx: JellyfinRequestContext,
  itemId: string
): string {
  return markerIdFor(ctx.uuid, itemId);
}
