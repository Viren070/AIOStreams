import {
  addonSubtitleTracks,
  config as appConfig,
  createFormatter,
  createLogger,
  encodeItemId,
  isPlayable,
  resolveMarkerId as markerIdFor,
  newPlaySessionId,
  parseRuntimeMs,
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
} from '@aiostreams/core';
import type { JellyfinRequestContext } from './context.js';

const logger = createLogger('jellyfin');

/** Anime metas are often served under `series`, and the other way round. */
export async function getMetaLoose(
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
      if (res.data) return res.data;
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
}

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
      | (Record<string, unknown> & { id: string })
      | undefined;
    return {
      type: d.t,
      videoId: d.v,
      runtimeMs:
        parseRuntimeMs(video?.runtime) ?? parseRuntimeMs(meta?.runtime),
    };
  }
  if (d.k === 'movie') {
    const meta = await getMetaLoose(ctx, d.t, d.i).catch(() => null);
    const hinted = meta?.behaviorHints?.defaultVideoId;
    return {
      type: d.t,
      videoId: typeof hinted === 'string' && hinted ? hinted : d.i,
      runtimeMs: parseRuntimeMs(meta?.runtime),
    };
  }
  return null;
}

function maxVersionsFor(ctx: JellyfinRequestContext): number {
  const cap = appConfig.jellyfin.maxVersions;
  const wanted = ctx.userData.jellyfin?.maxVersions ?? cap;
  return Math.max(1, Math.min(cap, wanted));
}

/**
 * Runs the stream pipeline once for an item and records everything the
 * anonymous routes need. Reuses a live memo unless `force` is set.
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
  const target = await playTargetFor(ctx, d);
  if (!target) return null;

  const engine = await ctx.engine();
  const [streamsRes, subtitlesRes] = await Promise.all([
    engine.getStreams(target.videoId, target.type),
    engine
      .getSubtitles(target.type, target.videoId)
      .catch(() => ({ data: [] })),
  ]);
  const playable = (streamsRes.data?.streams ?? []).filter(
    isPlayable
  ) as ParsedStream[];
  const addonSubtitles = addonSubtitleTracks(subtitlesRes.data ?? []);

  const streamContext = engine.getStreamContext();
  const formatter = streamContext
    ? createFormatter(streamContext.toFormatterContext(playable))
    : null;
  const top = playable.slice(0, maxVersionsFor(ctx));

  const sources: MediaSourceRecord[] = [];
  for (const stream of top) {
    let formatted = {
      name: stream.originalName || stream.addon.name,
      description: stream.originalDescription || '',
    };
    if (formatter && !stream.addon.formatPassthrough) {
      try {
        formatted = await formatter.format(stream);
      } catch {}
    }
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
  if (!sources.length) {
    const reason = (streamsRes.errors ?? [])
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
  if (record.filename) parts.push(`filename=${record.filename}`);
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
  if (!record || record.subtitlesEnriched) return;
  const extras = fileExtrasFor(record);
  if (!extras) {
    record.subtitlesEnriched = true;
    return;
  }

  const engine = await ctx.engine();
  const res = await engine
    .getSubtitles(memo.type, memo.videoId, extras)
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
