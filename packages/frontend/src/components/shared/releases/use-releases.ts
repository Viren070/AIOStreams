import React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  GithubRelease,
  ReleaseChannel,
  compareVersions,
  fetchReleasePage,
  releaseMatchesChannel,
} from '@/lib/changelog';

/** Stop paging once we have this many of the caller's channel. */
const TARGET_PER_LOAD = 20;
/** Nightlies dominate the feed, so cap how far we chase stable tags. */
const MAX_PAGES_PER_LOAD = 4;
/**
 * The first load only has to answer "is anything newer than me?", and GitHub
 * returns newest first, so one request always settles it. Chasing more pages
 * happens when the archive is actually opened, which keeps the default path
 * at a single request against a 60/hour unauthenticated limit.
 */
const MAX_PAGES_INITIAL = 1;

export interface UseReleases {
  releases: GithubRelease[];
  newer: GithubRelease[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
}

async function collect(
  channel: ReleaseChannel,
  fromPage: number,
  maxPages: number
) {
  const collected: GithubRelease[] = [];
  let page = fromPage;
  let more = true;

  for (let i = 0; i < maxPages; i++) {
    const result = await fetchReleasePage(page);
    collected.push(
      ...result.releases.filter((release) =>
        releaseMatchesChannel(release.tag_name, channel)
      )
    );
    page += 1;
    more = result.hasNextPage;
    if (!more || collected.length >= TARGET_PER_LOAD) break;
  }

  collected.sort(
    (a, b) =>
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  );
  return { collected, page, more };
}

/**
 * Releases for one channel, paged. GitHub returns every tag mixed together, so
 * a request can yield almost nothing for the stable channel; this keeps pulling
 * pages until it has a useful batch instead of surfacing an empty "load more".
 */
export function useReleases(
  version: string,
  channel: ReleaseChannel,
  enabled: boolean
): UseReleases {
  const query = useInfiniteQuery({
    queryKey: ['github-releases', channel],
    queryFn: ({ pageParam }) =>
      collect(
        channel,
        pageParam,
        pageParam === 1 ? MAX_PAGES_INITIAL : MAX_PAGES_PER_LOAD
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.more ? last.page : undefined),
    enabled: enabled && channel !== 'dev',
    // A refetch replays every loaded page.
    staleTime: Infinity,
  });
  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const loading = query.isLoading;

  const releases = React.useMemo(() => {
    const seen = new Set<string>();
    const all: GithubRelease[] = [];
    for (const page of data?.pages ?? []) {
      for (const release of page.collected) {
        if (seen.has(release.tag_name)) continue;
        seen.add(release.tag_name);
        all.push(release);
      }
    }
    return all;
  }, [data]);

  const loadMore = React.useCallback(() => {
    if (isFetchingNextPage || loading || !hasNextPage) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, loading]);

  const newer = React.useMemo(
    () =>
      version && version.toLowerCase() !== 'unknown'
        ? releases.filter(
            (release) => compareVersions(release.tag_name, version, channel) > 0
          )
        : [],
    [releases, version, channel]
  );

  return {
    releases,
    newer,
    loading,
    loadingMore: isFetchingNextPage,
    error: error ? error.message : null,
    hasMore: hasNextPage,
    loadMore,
  };
}
