import React from 'react';
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
 * happens when the archive is actually opened — which keeps the default path
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
  const [releases, setReleases] = React.useState<GithubRelease[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [nextPage, setNextPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(true);
  const startedRef = React.useRef(false);

  const collect = React.useCallback(
    async (fromPage: number, maxPages: number) => {
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
          new Date(b.published_at).getTime() -
          new Date(a.published_at).getTime()
      );
      return { collected, page, more };
    },
    [channel]
  );

  React.useEffect(() => {
    if (!enabled || channel === 'dev' || startedRef.current) return;
    startedRef.current = true;
    setLoading(true);
    setError(null);
    collect(1, MAX_PAGES_INITIAL)
      .then(({ collected, page, more }) => {
        setReleases(collected);
        setNextPage(page);
        setHasMore(more);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [enabled, channel, collect]);

  const loadMore = React.useCallback(() => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    collect(nextPage, MAX_PAGES_PER_LOAD)
      .then(({ collected, page, more }) => {
        setReleases((prev) => {
          const seen = new Set(prev.map((r) => r.tag_name));
          return [...prev, ...collected.filter((r) => !seen.has(r.tag_name))];
        });
        setNextPage(page);
        setHasMore(more);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMore(false));
  }, [collect, hasMore, loading, loadingMore, nextPage]);

  const newer = React.useMemo(
    () =>
      version && version.toLowerCase() !== 'unknown'
        ? releases.filter(
            (release) => compareVersions(release.tag_name, version, channel) > 0
          )
        : [],
    [releases, version, channel]
  );

  return { releases, newer, loading, loadingMore, error, hasMore, loadMore };
}
