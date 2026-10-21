import React from 'react';
import { playLink } from '../lib/app-links';
import { itemTitle, ticksToMs } from '../lib/format';
import { currentHost, type WatchNextItem } from '../lib/hosts';
import { landscapeUrl } from '../lib/images';
import { mergeRows, useNextUp, useResume, watchedAt } from '../lib/queries';
import { useSession } from '../lib/session';

const MAX_ITEMS = 10;
const REPORTED_MS = 2000;

/** Hands the home page's resume points and next episodes to the system's row. */
export function WatchNextSync() {
  const { client } = useSession();
  const resume = useResume();
  const nextUp = useNextUp();
  const items = React.useMemo(() => {
    if (!resume.data || !nextUp.data) return null;
    return mergeRows(resume.data.Items, nextUp.data.Items)
      .slice(0, MAX_ITEMS)
      .map((item): WatchNextItem => {
        const episode = item.Type === 'Episode';
        const positionMs = ticksToMs(item.UserData?.PlaybackPositionTicks);
        const playedAt = watchedAt(item);
        return {
          id: item.Id!,
          kind: episode ? 'episode' : 'movie',
          title: itemTitle(item),
          episodeTitle: (episode && item.Name) || undefined,
          season: (episode && item.ParentIndexNumber) || undefined,
          episode: (episode && item.IndexNumber) || undefined,
          description: item.Overview || undefined,
          image: landscapeUrl(client, item, { maxWidth: 400 }) ?? undefined,
          positionMs,
          durationMs: ticksToMs(item.RunTimeTicks) || undefined,
          playedAt: playedAt || undefined,
          link: playLink(client.base, item.Id!, positionMs),
        };
      });
  }, [client, resume.data, nextUp.data]);
  React.useEffect(() => {
    if (items) currentHost().watchNext?.(items);
  }, [items]);
  const { refetch: refetchResume } = resume;
  const { refetch: refetchNextUp } = nextUp;
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onVisibility = () => {
      clearTimeout(timer);
      if (!document.hidden) return;
      // Once the pause the player sends as the app leaves has reached the server.
      timer = setTimeout(() => {
        void refetchResume();
        void refetchNextUp();
      }, REPORTED_MS);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(timer);
    };
  }, [refetchResume, refetchNextUp]);
  return null;
}
