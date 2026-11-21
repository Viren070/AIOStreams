import React from 'react';
import { t } from '@lingui/core/macro';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { useSession } from '@/lib/jellyfin/session';
import { useItem, useShowAhead } from '@/lib/jellyfin/queries';
import { cn } from '@aiostreams/ui/core/styling';
import {
  backdropUrl,
  backdropUrls,
  backgroundVideoOf,
  posterUrl,
  shownFirst,
  settleBackdrop,
  useBackdropsSettled,
} from '@/lib/artwork/urls';
import { useArtBackground } from '@/lib/artwork/background';
import { lacksDetails } from '@/lib/format';
import { itemPath, navigate } from '@/lib/paths';
import { PAGE_TOP, PageMessage } from '@/components/shell/page';
import { NoDetails } from './_components/no-details';
import { CastAndCrew } from '@/components/media/people';
import { PickOnArrival } from '@/features/versions/version-picker';
import { useTrailersAllowed } from '@/features/trailers/preview';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { useExternalReturn } from '@/lib/playback/external-return';
import { Backdrop } from './_components/backdrop';
import { Header, HeaderSkeleton } from './_components/header';
import { Seasons } from './_components/seasons';
import { Collection } from './_components/collection';
import { Details } from './_components/details';
import { Similar } from './_components/similar';
import { ItemTrailerContext, useItemTrailer } from './_components/trailer';

export function ItemPage({
  itemId,
  seasonId,
  episodeId,
  pickId,
  playlistId,
}: {
  itemId: string;
  seasonId?: string;
  episodeId?: string;
  /** Opens this item's version list as the page arrives. */
  pickId?: string;
  /** The playlist a version picked from that list plays on through. */
  playlistId?: string;
}) {
  const { client } = useSession();
  const item = useItem(itemId, { page: true });
  const data = item.data;
  // Its own details settle its backdrop, not what the list it came from knew.
  if (data && !item.isPlaceholderData) settleBackdrop(data, 'details');
  useBackdropsSettled();
  // The picture this visit settled on, kept as its details come; a later
  // visit opens on what's settled by then.
  const [kept, setKept] = React.useState<{ id: string; src: string }>();
  useShowAhead(itemId, data?.Type === 'Series', seasonId);
  useArtBackground(data);
  const [season, setSeason] = React.useState<BaseItemDto>();
  useExternalReturn();
  const trailer = useItemTrailer(
    data && !lacksDetails(data) ? data : undefined
  );
  // A collection's cover is made for a tile, never the top of its page.
  const collection = data?.Type === 'BoxSet';
  const backdrops = !data
    ? []
    : collection
      ? [backdropUrl(client, data, { maxWidth: 1920 })].filter(
          (url): url is string => !!url
        )
      : // Led by the picture it was just shown with, so it opens on the same.
        shownFirst(itemId, backdropUrls(client, data, { maxWidth: 1920 }));
  const lead = kept?.id === itemId ? kept.src : undefined;
  const art = lead
    ? [lead, ...backdrops.filter((url) => url !== lead)]
    : backdrops;
  const videoAllowed = useTrailersAllowed('item');
  const video =
    collection && data && videoAllowed ? backgroundVideoOf(data) : undefined;
  const heroArt = [...art, video ?? ''].join('|');
  const [bare, setBare] = React.useState<string>();
  const onBare = React.useCallback(() => setBare(heroArt), [heroArt]);
  const hero = !collection || ((art.length > 0 || !!video) && bare !== heroArt);

  React.useEffect(() => {
    if (data?.Type === 'Episode' && data.SeriesId) {
      navigate(itemPath(data), { replace: true });
    }
  }, [data]);

  if (item.isError) {
    return (
      <PageMessage>
        <LuffyError title={t`Could not load this title`} className="mt-0" />
      </PageMessage>
    );
  }
  if (data && lacksDetails(data)) {
    return (
      <PageMessage>
        <NoDetails
          item={data}
          refreshing={item.isFetching}
          onRefresh={() => void item.refetch()}
        />
      </PageMessage>
    );
  }

  return (
    <div
      data-ui="item-page"
      data-type={data?.Type}
      data-watched={data?.UserData?.Played || undefined}
      data-favourite={data?.UserData?.IsFavorite || undefined}
      className="relative"
    >
      {pickId && <PickOnArrival itemId={pickId} playlist={playlistId} />}
      <Backdrop
        images={art}
        poster={
          data && !collection
            ? posterUrl(client, data, { maxWidth: 160 })
            : null
        }
        trailer={trailer.shown}
        video={video}
        band={collection}
        onBare={collection ? onBare : undefined}
        onShown={(src) =>
          setKept((was) =>
            was?.id === itemId && was.src === src ? was : { id: itemId, src }
          )
        }
      />
      {trailer.preview}
      {trailer.hint}
      <div
        data-ui="item-body"
        className={cn(
          'relative z-[1] space-y-12 px-4 pb-16 lg:ps-0 lg:pe-10',
          hero ? 'pt-[38vh] lg:pt-[26vh]' : PAGE_TOP
        )}
      >
        {!data || data.Type === 'Episode' ? (
          <HeaderSkeleton />
        ) : (
          <ItemTrailerContext.Provider value={trailer.context}>
            <Header item={data} season={season} hero={hero} />
            {data.Type === 'Series' && (
              <Seasons
                series={data}
                initialSeasonId={seasonId}
                focusEpisodeId={episodeId}
                onSeason={setSeason}
              />
            )}
            {data.Type === 'BoxSet' && <Collection parent={data} />}
            <CastAndCrew people={data.People} />
            <Details item={data} />
            {(data.Type === 'Movie' || data.Type === 'Series') && (
              <Similar itemId={data.Id!} />
            )}
          </ItemTrailerContext.Provider>
        )}
      </div>
    </div>
  );
}
