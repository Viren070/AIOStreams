import React from 'react';
import { t } from '@lingui/core/macro';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { cn } from '@aiostreams/ui/core/styling';
import { ConnectionError } from '../lib/client';
import {
  compileBadges,
  readBadges,
  type Badge,
  type CompiledBadge,
} from '../lib/badges';
import { settings, useSetting } from '../lib/settings';

const HOUR_MS = 60 * 60_000;

/** A pack of badges at an address, which the device keeps between visits. */
export const badgePackQuery = (url: string) => ({
  queryKey: ['badge-pack', url],
  queryFn: async (): Promise<Badge[]> => {
    let res: Response;
    try {
      res = await fetch(url, { cache: 'no-cache' });
    } catch {
      throw new ConnectionError();
    }
    const { status } = res;
    if (!res.ok) throw new Error(t`That address answered ${status}.`);
    const badges = readBadges(await res.json().catch(() => null));
    if (!badges?.length)
      throw new Error(
        t`There are no badges this app can read at that address.`
      );
    return badges;
  },
  staleTime: 6 * HOUR_MS,
  meta: { cache: 'account' as const },
});

const packData = (results: UseQueryResult<Badge[]>[]) =>
  results.map((result) => result.data);

/** Your own badges, then each linked pack's, ready to match. */
export function useBadges(): CompiledBadge[] {
  const [{ links, badges }] = useSetting(settings.playback.badges);
  const packs = useQueries({
    queries: links.map(badgePackQuery),
    combine: packData,
  });
  return React.useMemo(
    () => compileBadges([...badges, ...packs.flatMap((pack) => pack ?? [])]),
    [badges, packs]
  );
}

export function BadgeChip({
  badge,
  className,
}: {
  badge: Badge;
  className?: string;
}) {
  const [broken, setBroken] = React.useState(false);
  const image = broken ? undefined : badge.image;
  return (
    <span
      data-ui="version-badge"
      className={cn(
        'inline-flex h-[1.375rem] flex-none items-center rounded-md border px-1.5 text-[0.6875rem] font-semibold leading-none',
        image ? 'border-transparent' : 'border-white/60 text-white',
        className
      )}
      style={{
        color: badge.color,
        backgroundColor: badge.background,
        borderColor: badge.border,
      }}
    >
      {image ? (
        <img
          src={image}
          alt={badge.label}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="block max-h-4 w-auto max-w-[5.5rem] object-contain"
        />
      ) : (
        badge.label
      )}
    </span>
  );
}
