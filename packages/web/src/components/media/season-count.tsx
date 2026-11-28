import { plural } from '@lingui/core/macro';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { useSeasons } from '@/lib/jellyfin/queries';
import type { BaseItemDto } from '@/lib/jellyfin/types';

/**
 * How many seasons a show has, leaving out specials, as IMDb counts them; its
 * place held while they're found. A show's page asks for its seasons anyway.
 */
export function SeasonCount({
  series,
  enabled = true,
}: {
  series: BaseItemDto;
  enabled?: boolean;
}) {
  const seasons = useSeasons(series.Id ?? '', enabled && !!series.Id);
  if (seasons.isError || !enabled) return null;
  if (!seasons.data)
    return <Skeleton className="inline-block h-4 w-16 align-middle" />;
  const count = (seasons.data.Items ?? []).filter(
    (season) => (season.IndexNumber ?? 1) > 0
  ).length;
  if (!count) return null;
  return <>{plural(count, { one: '# season', other: '# seasons' })}</>;
}
