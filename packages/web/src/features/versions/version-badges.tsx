import React from 'react';
import { t } from '@lingui/core/macro';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { cn } from '@aiostreams/ui/core/styling';
import { ConnectionError } from '@/lib/jellyfin/client';
import {
  compileBadges,
  readBadges,
  type Badge,
  type CompiledBadge,
} from '@/lib/badges';
import { settings, useSetting } from '@/lib/settings';

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

/** Badge pictures loaded ahead, held so the browser keeps them decoded. */
const warmed = new Map<string, HTMLImageElement>();
const decoded = new Set<string>();
/** After the first screen's own pictures. */
const WARM_DELAY_MS = 2000;

/**
 * Loads every badge's picture once the badges are known, so a version list
 * shows them at once instead of as empty chips that fill in one by one.
 */
export function WarmBadges() {
  const compiled = useBadges();
  React.useEffect(() => {
    const images = compiled
      .map(({ badge }) => badge.image)
      .filter((src): src is string => !!src && !warmed.has(src));
    if (!images.length) return;
    const timer = setTimeout(() => {
      for (const src of images) {
        if (warmed.has(src)) continue;
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.src = src;
        warmed.set(src, img);
        img
          .decode()
          .then(() => decoded.add(src))
          .catch(() => undefined);
      }
    }, WARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [compiled]);
  return null;
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
  // Its label stands in until the picture can be drawn, rather than an empty chip.
  const [loaded, setLoaded] = React.useState(
    () => !!image && decoded.has(image)
  );
  const ready = React.useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth) setLoaded(true);
  }, []);
  const pictured = !!image && loaded;
  return (
    <span
      data-ui="version-badge"
      className={cn(
        'inline-flex h-[1.125rem] flex-none items-center rounded-md border px-1.5 text-[0.6875rem] font-semibold leading-none',
        pictured ? 'border-transparent' : 'border-white/60 text-white',
        className
      )}
      style={{
        color: badge.color,
        backgroundColor: badge.background,
        borderColor: badge.border,
      }}
    >
      {image && (
        <img
          ref={ready}
          src={image}
          alt={badge.label}
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          className={cn(
            'block max-h-3.5 w-auto max-w-[5.5rem] object-contain',
            !pictured && 'hidden'
          )}
        />
      )}
      {!pictured && badge.label}
    </span>
  );
}
