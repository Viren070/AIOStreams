import { t } from '@lingui/core/macro';
import { useSession } from '@/lib/jellyfin/session';
import { useSimilar } from '@/lib/jellyfin/queries';
import { posterUrl, animatedPosterOf } from '@/lib/artwork/urls';
import { itemSubtitle } from '@/lib/format';
import { href, itemPath } from '@/lib/paths';
import { useNear } from '@/hooks/use-in-view';
import { MediaRow } from '@/components/media/media-row';
import { PosterCard } from '@/components/media/cards';
import { ItemMenu } from '@/components/media/item-menu';

/** Loaded once scrolled near, since it reads a catalog. */
export function Similar({ itemId }: { itemId: string }) {
  const { client } = useSession();
  const [ref, near] = useNear<HTMLDivElement>('400px');
  const similar = useSimilar(itemId, near);
  return (
    <div
      ref={ref}
      hidden={!!similar.data && !similar.data.Items?.length}
      className="min-h-[2rem]"
    >
      {near && (
        <MediaRow
          id="similar"
          title={t`More like this`}
          shape="poster"
          loading={similar.isLoading}
        >
          {similar.data?.Items?.map((item) => (
            <ItemMenu key={item.Id} item={item}>
              <PosterCard
                href={href(itemPath(item))}
                image={(width) => posterUrl(client, item, { maxWidth: width })}
                animated={animatedPosterOf(item)}
                title={item.Name ?? ''}
                subtitle={itemSubtitle(item)}
                itemType={item.Type}
                watched={item.UserData?.Played}
                favourite={item.UserData?.IsFavorite}
              />
            </ItemMenu>
          ))}
        </MediaRow>
      )}
    </div>
  );
}
