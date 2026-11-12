import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  BiCast,
  BiCheck,
  BiDislike,
  BiGroup,
  BiHeart,
  BiListPlus,
  BiShuffle,
  BiSolidDislike,
  BiSolidHeart,
} from 'react-icons/bi';
import { IconButton } from '@aiostreams/ui/button';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { useFeature } from '@/lib/jellyfin/server-info';
import {
  useSetDropped,
  offersFavourite,
  useSetFavorite,
  useSetPlayed,
} from '@/lib/jellyfin/watch-state';
import { useRemoteDevices } from '@/lib/jellyfin/history';
import { fullTitle } from '@/lib/format';
import { RatingButton } from './rating';
import { useVersionPicker } from '@/features/versions/version-picker';
import { openAddToPlaylist } from '@/features/playlists/playlists';
import { playable } from '@/lib/playlists';
import { downloadsHost, useMayDownload } from '@/lib/downloads';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { TrailerButton } from './trailers';
import { trailersOf } from '@/lib/playback/trailers';
import { openPartySheet } from '@/features/party/sheet-state';
import { openRemote } from '@/features/remote/remote-sheet';
import { openRandom } from '@/components/media/random-pick';
import { useParty } from '@/lib/party/party';
import {
  DownloadButton,
  ShowDownloadMenu,
} from '@/features/downloads/download-button';

export const QuickShown = React.createContext<string[] | null>(null);

/** What the phone row fills its three places from, in this order. */
const QUICK = [
  'trailer',
  'watched',
  'favourite',
  'download',
  'rating',
  'add-to-playlist',
  'random',
  'party',
  'play-on',
  'drop',
] as const;

function useOffered(item: BaseItemDto, target?: BaseItemDto) {
  const devices = useRemoteDevices();
  const canDrop = useFeature('dropped');
  const mayDownload = useMayDownload();
  const type = item.Type;
  return {
    trailer: !!trailersOf(item).length,
    watched: type !== 'BoxSet',
    favourite: offersFavourite(type, !!item.UserData?.IsFavorite),
    download:
      mayDownload &&
      ((type === 'Movie' && item.LocationType !== 'Virtual') ||
        type === 'Series'),
    rating: type === 'Movie' || type === 'Series',
    'add-to-playlist': type === 'Movie' && playable(item),
    random: type === 'Series',
    party: type !== 'BoxSet',
    'play-on': !!target && !!devices.data?.length,
    drop: canDrop && type === 'Series',
  } satisfies Record<(typeof QUICK)[number], boolean>;
}

export function useQuickActions(
  item: BaseItemDto,
  target?: BaseItemDto
): string[] {
  const offered = useOffered(item, target);
  return QUICK.filter((name) => offered[name]).slice(0, 3);
}

export function Captioned({
  ui,
  name,
  label,
  order,
  children,
}: {
  ui?: string;
  name: string;
  label: string;
  order?: number;
  children: React.ReactNode;
}) {
  const shown = React.useContext(QuickShown);
  if (!ui) return children;
  const at = shown?.indexOf(name) ?? -1;
  return (
    <div
      data-ui={ui}
      data-name={name}
      data-shown={at >= 0 || undefined}
      style={{ order: at >= 0 ? at : order }}
      className="flex min-w-0 flex-col items-center gap-1.5 text-center text-xs text-gray-300"
    >
      {children}
      <span className="w-full truncate">{label}</span>
    </div>
  );
}

export function SecondaryActions({
  item,
  season,
  target,
  resumeMs,
  caption,
}: {
  item: BaseItemDto;
  season?: BaseItemDto;
  target?: BaseItemDto;
  resumeMs: number;
  caption?: string;
}) {
  const picker = useVersionPicker();
  const inParty = !!useParty();
  const offered = useOffered(item, target);
  return (
    <>
      {offered.trailer && (
        <Captioned ui={caption} name="trailer" label={t`Trailer`}>
          <TrailerButton item={item} compact={!!caption} />
        </Captioned>
      )}
      {offered.random && (
        <Captioned ui={caption} name="random" label={t`Random`}>
          <Tooltip
            trigger={
              <IconButton
                data-ui="item-action"
                data-name="random"
                intent="gray-subtle"
                className="rounded-full"
                icon={<BiShuffle />}
                aria-label={t`Random episode`}
                onClick={() => openRandom({ kind: 'episode', series: item })}
              />
            }
          >
            <Trans>Random episode</Trans>
          </Tooltip>
        </Captioned>
      )}
      {offered.party && (
        <Captioned
          ui={caption}
          name="party"
          label={inParty ? t`Watch party` : t`Watch together`}
        >
          <Tooltip
            trigger={
              <IconButton
                data-ui="item-action"
                data-name="party"
                intent="gray-subtle"
                className="rounded-full"
                icon={<BiGroup />}
                aria-label={inParty ? t`Watch party` : t`Watch together`}
                onClick={() =>
                  openPartySheet(
                    target && !inParty
                      ? {
                          play: {
                            title: fullTitle(target),
                            run: () =>
                              picker.play(target, { startMs: resumeMs }),
                          },
                        }
                      : {}
                  )
                }
              />
            }
          >
            {inParty ? t`Watch party` : t`Watch together`}
          </Tooltip>
        </Captioned>
      )}
      {target && offered['play-on'] && (
        <Captioned ui={caption} name="play-on" label={t`Play on`}>
          <Tooltip
            trigger={
              <IconButton
                data-ui="item-action"
                data-name="play-on"
                intent="gray-subtle"
                className="rounded-full"
                icon={<BiCast />}
                aria-label={t`Play on another device`}
                onClick={() =>
                  openRemote({ play: { item: target, startMs: resumeMs } })
                }
              />
            }
          >
            <Trans>Play on another device</Trans>
          </Tooltip>
        </Captioned>
      )}
      {offered['add-to-playlist'] && (
        <Captioned ui={caption} name="add-to-playlist" label={t`Playlist`}>
          <Tooltip
            trigger={
              <IconButton
                data-ui="item-action"
                data-name="add-to-playlist"
                intent="gray-subtle"
                className="rounded-full"
                icon={<BiListPlus />}
                aria-label={t`Add to playlist`}
                onClick={() => openAddToPlaylist([item])}
              />
            }
          >
            <Trans>Add to playlist</Trans>
          </Tooltip>
        </Captioned>
      )}
      <ItemToggles
        itemId={item.Id!}
        type={item.Type}
        played={!!item.UserData?.Played}
        favorite={!!item.UserData?.IsFavorite}
        dropped={item.UserData?.Likes === false}
        caption={caption}
      />
      {offered.rating && (
        <Captioned ui={caption} name="rating" label={t`Rate`}>
          <RatingButton item={item} />
        </Captioned>
      )}
      {offered.download && item.Type === 'Movie' && (
        <Captioned ui={caption} name="download" label={t`Download`}>
          <DownloadButton item={item} className="size-10 text-lg" />
        </Captioned>
      )}
      {offered.download && item.Type === 'Series' && (
        <Captioned ui={caption} name="download" label={t`Download`}>
          <ShowDownloadMenu series={item} season={season} />
        </Captioned>
      )}
    </>
  );
}

// Apart from the header, which redraws as the next episode and the season arrive.
const ItemToggles = React.memo(function ItemToggles({
  itemId,
  type,
  played,
  favorite,
  dropped,
  caption,
}: {
  itemId: string;
  type: BaseItemDto['Type'];
  played: boolean;
  favorite: boolean;
  dropped: boolean;
  caption?: string;
}) {
  const setPlayed = useSetPlayed();
  const setFavorite = useSetFavorite();
  const setDropped = useSetDropped();
  const canDrop = useFeature('dropped');
  return (
    <>
      {type !== 'BoxSet' && (
        <Captioned ui={caption} name="watched" label={t`Watched`}>
          <Tooltip
            trigger={
              <IconButton
                data-ui="item-action"
                data-name="watched"
                data-active={played || undefined}
                intent={played ? 'primary-subtle' : 'gray-subtle'}
                className="rounded-full"
                icon={<BiCheck />}
                aria-label={played ? t`Mark unwatched` : t`Mark watched`}
                loading={setPlayed.isPending}
                onClick={() => setPlayed.mutate({ itemId, played: !played })}
              />
            }
          >
            {played ? t`Mark unwatched` : t`Mark watched`}
          </Tooltip>
        </Captioned>
      )}
      {offersFavourite(type, favorite) && (
        <Captioned ui={caption} name="favourite" label={t`Favourite`}>
          <Tooltip
            trigger={
              <IconButton
                data-ui="item-action"
                data-name="favourite"
                data-active={favorite || undefined}
                intent={favorite ? 'alert-subtle' : 'gray-subtle'}
                className="rounded-full"
                icon={favorite ? <BiSolidHeart /> : <BiHeart />}
                aria-label={favorite ? t`Remove favourite` : t`Add favourite`}
                loading={setFavorite.isPending}
                onClick={() =>
                  setFavorite.mutate({ itemId, favorite: !favorite })
                }
              />
            }
          >
            {favorite ? t`Remove favourite` : t`Add favourite`}
          </Tooltip>
        </Captioned>
      )}
      {canDrop && type === 'Series' && (
        <Captioned ui={caption} name="drop" label={t`Drop`}>
          <Tooltip
            trigger={
              <IconButton
                data-ui="item-action"
                data-name="drop"
                data-active={dropped || undefined}
                intent={dropped ? 'warning-subtle' : 'gray-subtle'}
                className="rounded-full"
                icon={dropped ? <BiSolidDislike /> : <BiDislike />}
                aria-label={dropped ? t`Undrop show` : t`Drop show`}
                loading={setDropped.isPending}
                onClick={() => setDropped.mutate({ itemId, dropped: !dropped })}
              />
            }
          >
            {dropped ? t`Undrop show` : t`Drop show`}
          </Tooltip>
        </Captioned>
      )}
    </>
  );
});
