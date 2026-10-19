import { Skeleton } from '@aiostreams/ui/skeleton';
import type { JellyfinClient } from '../lib/client';
import { cardImages, cardShape, animatedPosterOf } from '../lib/images';
import { itemSubtitle, progressOf } from '../lib/format';
import { href, itemPath } from '../lib/paths';
import type { BaseItemDto } from '../lib/types';
import { PosterCard } from './cards';
import { ItemMenu } from './item-menu';
import { GridOpenCard } from './grid-open-card';
import { CardGrid, fadeIn } from './media-row';

/** Cards in the shape their art was made for; collections may be landscape. */
export function MixedGrid({
  items,
  client,
  loading,
  opens = false,
}: {
  items: BaseItemDto[];
  client: JellyfinClient;
  loading?: boolean;
  /** Posters open out over their neighbours on focus (grid-open-card.tsx). */
  opens?: boolean;
}) {
  const landscape =
    items.length > 0 &&
    items.filter((i) => cardShape(i) === 'landscape').length > items.length / 2;
  return (
    <CardGrid shape={landscape ? 'wide' : 'poster'}>
      {loading &&
        Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="aspect-[2/3] h-auto w-full rounded-lg" />
        ))}
      {items.map((child, i) => {
        const shape = landscape ? 'landscape' : cardShape(child);
        const card = (
          <PosterCard
            href={href(itemPath(child))}
            shape={shape}
            image={(width) =>
              cardImages(client, child, shape, { maxWidth: width })
            }
            animated={animatedPosterOf(child)}
            title={child.Name ?? ''}
            subtitle={itemSubtitle(child)}
            watched={child.UserData?.Played}
            unwatched={child.UserData?.UnplayedItemCount ?? undefined}
            progress={progressOf(child)}
          />
        );
        return (
          <div key={child.Id} {...fadeIn(i)}>
            <ItemMenu item={child}>
              {opens && !landscape ? (
                <GridOpenCard item={child}>{card}</GridOpenCard>
              ) : (
                card
              )}
            </ItemMenu>
          </div>
        );
      })}
    </CardGrid>
  );
}
