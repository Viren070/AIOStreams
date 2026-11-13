import React from 'react';
import { t } from '@lingui/core/macro';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { useSession } from '@/lib/jellyfin/session';
import { useItem, useShowAhead } from '@/lib/jellyfin/queries';
import { backdropUrls, posterUrl } from '@/lib/artwork/urls';
import { useArtBackground } from '@/lib/artwork/background';
import { lacksDetails } from '@/lib/format';
import { itemPath, navigate } from '@/lib/paths';
import { PageMessage } from '@/components/shell/page';
import { NoDetails } from './_components/no-details';
import { CastAndCrew } from '@/components/media/people';
import { PickOnArrival } from '@/features/versions/version-picker';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { useExternalReturn } from '@/lib/playback/external-return';
import { Backdrop } from './_components/backdrop';
import { Header, HeaderSkeleton } from './_components/header';
import { Seasons } from './_components/seasons';
import { Members, SubCollections } from './_components/collection';
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
  useShowAhead(itemId, data?.Type === 'Series', seasonId);
  useArtBackground(data);
  const [season, setSeason] = React.useState<BaseItemDto>();
  useExternalReturn();
  const trailer = useItemTrailer(
    data && !lacksDetails(data) ? data : undefined
  );

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
        images={data ? backdropUrls(client, data, { maxWidth: 1920 }) : []}
        poster={data ? posterUrl(client, data, { maxWidth: 160 }) : null}
        trailer={trailer.shown}
      />
      {trailer.preview}
      {trailer.hint}
      <div
        data-ui="item-body"
        className="relative z-[1] space-y-12 px-4 pb-16 pt-[38vh] lg:ps-0 lg:pe-10 lg:pt-[26vh]"
      >
        {!data || data.Type === 'Episode' ? (
          <HeaderSkeleton />
        ) : (
          <ItemTrailerContext.Provider value={trailer.context}>
            <Header item={data} season={season} />
            {data.Type === 'Series' && (
              <Seasons
                series={data}
                initialSeasonId={seasonId}
                focusEpisodeId={episodeId}
                onSeason={setSeason}
              />
            )}
            {data.Type === 'BoxSet' && <SubCollections parent={data} />}
            {data.Type === 'BoxSet' && <Members parent={data} />}
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
