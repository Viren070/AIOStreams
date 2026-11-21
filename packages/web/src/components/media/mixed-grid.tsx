import React from 'react';
import { Skeleton } from '@aiostreams/ui/skeleton';
import type { JellyfinClient } from '@/lib/jellyfin/client';
import { cardImages, cardShape, animatedPosterOf } from '@/lib/artwork/urls';
import { itemSubtitle, progressOf } from '@/lib/format';
import { href, itemPath } from '@/lib/paths';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { PosterCard } from './cards';
import { ItemMenu } from './item-menu';
import { CardPreviewHost } from './card-preview';
import { CardGrid, fadeIn } from './media-row';
import { NearCell } from './near-cell';

const FIRST_DRAWN = 30;

/** Cards in the shape their art was made for; collections may be landscape. */
export function MixedGrid({
  items,
  client,
  loading,
}: {
  items: BaseItemDto[];
  client: JellyfinClient;
  loading?: boolean;
}) {
  const height = React.useRef(0);
  const landscape =
    items.length > 0 &&
    items.filter((i) => cardShape(i) === 'landscape').length > items.length / 2;
  return (
    <CardPreviewHost>
      <CardGrid shape={landscape ? 'wide' : 'poster'}>
        {loading &&
          Array.from({ length: 12 }, (_, i) => (
            <Skeleton
              key={i}
              className="aspect-[2/3] h-auto w-full rounded-lg"
            />
          ))}
        {items.map((child, i) => (
          <NearCell
            key={child.Id}
            first={i < FIRST_DRAWN}
            height={height}
            estimate={landscape ? 'aspect-video' : 'aspect-[2/3]'}
            {...fadeIn(i)}
          >
            <ItemMenu item={child}>
              <PosterCard
                href={href(itemPath(child))}
                shape={landscape ? 'landscape' : cardShape(child)}
                image={(width) =>
                  cardImages(
                    client,
                    child,
                    landscape ? 'landscape' : cardShape(child),
                    { maxWidth: width }
                  )
                }
                animated={animatedPosterOf(child)}
                title={child.Name ?? ''}
                subtitle={itemSubtitle(child)}
                itemType={child.Type}
                watched={child.UserData?.Played}
                favourite={child.UserData?.IsFavorite}
                unwatched={child.UserData?.UnplayedItemCount ?? undefined}
                progress={progressOf(child)}
              />
            </ItemMenu>
          </NearCell>
        ))}
      </CardGrid>
    </CardPreviewHost>
  );
}
