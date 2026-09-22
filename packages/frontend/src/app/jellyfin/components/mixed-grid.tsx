import { Skeleton } from '@/components/ui/skeleton';
import type { JellyfinClient } from '../lib/client';
import { cardShape, posterUrl } from '../lib/images';
import { itemSubtitle, progressOf } from '../lib/format';
import { href, itemPath } from '../lib/paths';
import type { BaseItemDto } from '../lib/types';
import { PosterCard } from './cards';
import { ItemMenu } from './item-menu';
import { motion } from 'motion/react';
import { CardGrid, fadeIn } from './media-row';

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
  const landscape =
    items.length > 0 &&
    items.filter((i) => cardShape(i) === 'landscape').length > items.length / 2;
  return (
    <CardGrid shape={landscape ? 'wide' : 'poster'}>
      {loading &&
        Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="aspect-[2/3] h-auto w-full rounded-lg" />
        ))}
      {items.map((child, i) => (
        <motion.div key={child.Id} {...fadeIn(i)}>
          <ItemMenu item={child}>
            <PosterCard
              href={href(itemPath(child))}
              shape={landscape ? 'landscape' : cardShape(child)}
              image={posterUrl(client, child, {
                maxWidth: landscape ? 640 : 400,
              })}
              title={child.Name ?? ''}
              subtitle={itemSubtitle(child)}
              watched={child.UserData?.Played}
              unwatched={child.UserData?.UnplayedItemCount ?? undefined}
              progress={progressOf(child)}
            />
          </ItemMenu>
        </motion.div>
      ))}
    </CardGrid>
  );
}
