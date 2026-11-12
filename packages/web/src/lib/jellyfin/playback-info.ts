import React from 'react';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { JellyfinClient, Purpose } from './client';
import { useSession } from './session';
import { playerSupport } from '@/lib/playback/player-choice';
import { deviceProfile } from '@/lib/playback/device-profile';
import { settings, useSetting } from '@/lib/settings';
import { mayConvert } from '@/lib/playback/quality';
import type {
  MediaSegmentDtoQueryResult,
  PlaybackInfoResponse,
  SourceInfo,
} from './types';
import { useKey } from './queries';

/** The quality cap, where the user may have the server convert. */
export function useMaxBitrate(): number | undefined {
  const { user } = useSession();
  const [quality] = useSetting(settings.player.quality);
  return quality && mayConvert(user) ? quality : undefined;
}

/** The first version carries the item's id; the web app keys every version by its own. */
function withOwnId(source: SourceInfo): SourceInfo {
  const id = source.aiostreams?.id;
  return id ? { ...source, Id: id } : source;
}

/** What a list is read for; playing a version names it, which answers with all of it. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- Jellyfin's field names
const LISTED_FIELDS = ['Id', 'Type', 'Name', 'RunTimeTicks', 'aiostreams'];

/**
 * Naming a version also gets its subtitles from subtitle addons, as does a
 * download's list, which saves the first version's.
 */
export async function requestPlaybackInfo(
  client: JellyfinClient,
  userId: string,
  itemId: string,
  opts: {
    refresh?: boolean;
    sourceId?: string;
    profile?: object;
    /** The list the server kept, however old. */
    kept?: boolean;
    /** What the versions may need; the chosen player's by default. */
    support?: { headers: boolean; youtube: boolean };
    purpose?: Purpose;
    full?: boolean;
    maxBitrate?: number;
  } = {}
): Promise<PlaybackInfoResponse> {
  const support = opts.support ?? playerSupport();
  const listed =
    !opts.sourceId && !opts.full && opts.purpose !== 'download'
      ? { MediaSourceFields: LISTED_FIELDS.join(',') }
      : {};
  const ask = (extra?: object) =>
    client.post<PlaybackInfoResponse>(
      `/Items/${itemId}/PlaybackInfo`,
      {
        ...extra,
        UserId: userId,
        DeviceProfile: opts.profile ?? deviceProfile(opts.maxBitrate),
        ...(opts.maxBitrate && { MaxStreamingBitrate: opts.maxBitrate }),
        ...(opts.sourceId
          ? { MediaSourceId: opts.sourceId }
          : !opts.kept && { Fresh: true }),
        ...(!opts.sourceId &&
          opts.purpose !== 'download' && { SkipSubtitles: true }),
        ...(opts.refresh && { Refresh: true }),
        AllVersions: true,
        ...(support.headers && { EnableRequiredHttpHeaders: true }),
        ...(support.youtube && { EnableYouTube: true }),
      },
      { userId, ...listed },
      opts.purpose
    );
  let info = await ask();
  // A server that converts weighs a file by the sound named, else it can skip
  // the check; subtitles are the player's own to draw.
  const named = opts.sourceId
    ? info.MediaSources?.find((s) => s.Id === opts.sourceId)
    : undefined;
  if (named?.SupportsTranscoding && named.DefaultAudioStreamIndex != null)
    info = await ask({
      AudioStreamIndex: named.DefaultAudioStreamIndex,
      SubtitleStreamIndex: -1,
    });
  return { ...info, MediaSources: info.MediaSources?.map(withOwnId) };
}

function usePlaybackInfoRequest() {
  const { client, user } = useSession();
  const maxBitrate = useMaxBitrate();
  return React.useCallback(
    (
      itemId: string,
      opts: {
        refresh?: boolean;
        sourceId?: string;
        kept?: boolean;
        purpose?: Purpose;
        full?: boolean;
      } = {}
    ) =>
      requestPlaybackInfo(client, user.Id!, itemId, {
        ...opts,
        // Only playing a version takes the cap, which a list never shows.
        maxBitrate: opts.sourceId ? maxBitrate : undefined,
      }),
    [client, user.Id, maxBitrate]
  );
}

export function usePlaybackInfoOptions() {
  const request = usePlaybackInfoRequest();
  const key = useKey();
  const maxBitrate = useMaxBitrate();
  return React.useCallback(
    (
      itemId: string,
      sourceId?: string,
      opts: { purpose?: Purpose; full?: boolean } = {}
    ) =>
      queryOptions({
        queryKey: [
          ...key,
          'playback-info',
          itemId,
          sourceId ?? null,
          ...(opts.purpose ? [opts.purpose] : []),
          ...(opts.full ? ['full'] : []),
          ...(sourceId && maxBitrate ? [maxBitrate] : []),
        ],
        queryFn: () => request(itemId, { sourceId, ...opts }),
        staleTime: 10 * 60_000,
      }),
    [key, request, maxBitrate]
  );
}

/** About as long as the server reuses a list by default. */
export const PRELOADED_MS = 3 * 60_000;

/**
 * The version list asks on every open, as the server decides when a result is
 * too old; the player reuses whatever the list showed. The player's own list
 * (`kept`) asks once, as asking again can search every indexer anew.
 */
export function usePlaybackInfo(
  itemId: string,
  opts: {
    listing?: boolean;
    /** The list takes one asked for in the last `PRELOADED_MS`. */
    preloaded?: boolean;
    kept?: boolean;
    sourceId?: string;
    enabled?: boolean;
    purpose?: Purpose;
  } = {}
) {
  const options = usePlaybackInfoOptions();
  const request = usePlaybackInfoRequest();
  return useQuery({
    ...options(itemId, opts.sourceId, { purpose: opts.purpose }),
    ...(opts.kept && {
      queryFn: () => request(itemId, { kept: true }),
      staleTime: Infinity,
    }),
    refetchOnMount: opts.listing
      ? (query) =>
          opts.preloaded &&
          Date.now() - query.state.dataUpdatedAt < PRELOADED_MS
            ? false
            : 'always'
      : true,
    enabled: opts.enabled ?? true,
  });
}

export function useRefreshPlaybackInfo(itemId: string, purpose?: Purpose) {
  const queryClient = useQueryClient();
  const request = usePlaybackInfoRequest();
  const options = usePlaybackInfoOptions();
  return useMutation({
    mutationFn: () => request(itemId, { refresh: true, purpose }),
    onSuccess: (data) =>
      queryClient.setQueryData(
        options(itemId, undefined, { purpose }).queryKey,
        data
      ),
  });
}

/** Intro, recap and credits times, looked up once the server has a runtime. */
export function useSegments(itemId: string) {
  const { client } = useSession();
  return useQuery({
    queryKey: [...useKey(), 'segments', itemId],
    meta: { cache: 'titles' },
    queryFn: () =>
      client.get<MediaSegmentDtoQueryResult>(`/MediaSegments/${itemId}`),
    staleTime: 60 * 60_000,
  });
}
