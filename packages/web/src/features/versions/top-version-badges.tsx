import React from 'react';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { usePlaybackInfo } from '@/lib/jellyfin/playback-info';
import { playableSources } from '@/lib/playback/sources';
import { versionText } from '@/lib/versions';
import { matchBadges } from '@/lib/badges';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { BadgeChip, useBadges } from './version-badges';

/**
 * The badges of the version the list shows first, once its versions are
 * found: as a page opens with that setting on, or by an earlier list. The
 * `separator` goes before them, as the row they join draws its own.
 */
export function TopVersionBadges({
  item,
  separator,
}: {
  item: BaseItemDto;
  separator?: React.ReactNode;
}) {
  const badges = useBadges();
  // Only watches the list's own answer, so opening the list reuses it.
  const info = usePlaybackInfo(item.Id!, { enabled: false });
  const top = playableSources(info.data)[0];
  const shown = React.useMemo(
    () => (top ? matchBadges(versionText(top), badges) : []),
    [top, badges]
  );
  if (!badges.length || (!info.isLoading && !shown.length)) return null;
  return (
    <>
      {separator}
      {info.isLoading ? (
        <Skeleton data-name="badges" className="h-[1.125rem] w-16 rounded-md" />
      ) : (
        <span
          data-name="badges"
          className="flex flex-wrap items-center gap-1 duration-300 animate-in fade-in-0 max-sm:justify-center"
        >
          {shown.map((badge) => (
            // Shorter than the row's text, so the row keeps its height.
            <BadgeChip key={badge.image ?? badge.label} badge={badge} />
          ))}
        </span>
      )}
    </>
  );
}
