import React from 'react';
import {
  BiCheck,
  BiCheckDouble,
  BiHeart,
  BiInfoCircle,
  BiListUl,
  BiPlay,
  BiReset,
  BiSkipNext,
  BiSolidHeart,
  BiTv,
} from 'react-icons/bi';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@aiostreams/ui/context-menu';
import { useSetFavorite, useSetPlayed, useSetPlayedUpTo } from '../lib/queries';
import { itemTitle, ticksToMs } from '../lib/format';
import { itemPath, navigate } from '../lib/paths';
import { settings, useSetting } from '../lib/settings';
import { useVersionPicker } from './version-picker';
import { useHeroTarget } from './hero';
import type { BaseItemDto } from '../lib/types';

/** Right click, or a long press on touch, for what a card's item offers. */
export function ItemMenu({
  item,
  onPage,
  children,
}: {
  item: BaseItemDto;
  /** Shown on the page the item opens, so it offers no way there. */
  onPage?: boolean;
  children: React.ReactNode;
}) {
  const picker = useVersionPicker();
  const heroTarget = useHeroTarget(item);
  const setPlayed = useSetPlayed();
  const setPlayedUpTo = useSetPlayedUpTo();
  const setFavorite = useSetFavorite();
  // Jellyfin cannot play a virtual item, such as an episode not yet aired.
  const playable =
    (item.Type === 'Movie' || item.Type === 'Episode') &&
    item.LocationType !== 'Virtual';
  const played = !!item.UserData?.Played;
  const favorite = !!item.UserData?.IsFavorite;
  const resumeMs = ticksToMs(item.UserData?.PlaybackPositionTicks);
  const [skipList] = useSetting(settings.skipVersionList);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div {...heroTarget}>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent data-ui="item-menu">
        <ContextMenuLabel className="line-clamp-1">
          {onPage ? item.Name : itemTitle(item)}
        </ContextMenuLabel>
        {playable && (
          <ContextMenuItem
            data-name="play"
            onSelect={() => picker.play(item, { startMs: resumeMs })}
          >
            <BiPlay /> {resumeMs ? 'Resume' : 'Play'}
          </ContextMenuItem>
        )}
        {playable && (
          <ContextMenuItem
            data-name={skipList ? 'choose-version' : 'play-now'}
            onSelect={() =>
              picker.play(item, { startMs: resumeMs, held: true })
            }
          >
            {skipList ? <BiListUl /> : <BiSkipNext />}
            {skipList ? 'Choose a version' : 'Play straight away'}
          </ContextMenuItem>
        )}
        {!onPage && (
          <ContextMenuItem
            data-name="open"
            onSelect={() => navigate(itemPath(item))}
          >
            {item.Type === 'Episode' ? (
              <>
                <BiTv /> Go to show
              </>
            ) : (
              <>
                <BiInfoCircle /> Open
              </>
            )}
          </ContextMenuItem>
        )}
        {item.Type !== 'BoxSet' && (
          <>
            {(playable || !onPage) && <ContextMenuSeparator />}
            <ContextMenuItem
              data-name="watched"
              onSelect={() =>
                setPlayed.mutate({ itemId: item.Id!, played: !played })
              }
            >
              <BiCheck /> {played ? 'Mark unwatched' : 'Mark watched'}
            </ContextMenuItem>
            {item.Type === 'Episode' && item.SeriesId && (
              <ContextMenuItem
                data-name="watched-up-to"
                onSelect={() => setPlayedUpTo.mutate(item)}
              >
                <BiCheckDouble /> Mark watched up to here
              </ContextMenuItem>
            )}
            {!played && resumeMs > 0 && (
              <ContextMenuItem
                data-name="remove-resume"
                onSelect={() =>
                  setPlayed.mutate({ itemId: item.Id!, played: false })
                }
              >
                <BiReset /> Remove from continue watching
              </ContextMenuItem>
            )}
          </>
        )}
        <ContextMenuItem
          data-name="favourite"
          onSelect={() =>
            setFavorite.mutate({ itemId: item.Id!, favorite: !favorite })
          }
        >
          {favorite ? <BiSolidHeart /> : <BiHeart />}
          {favorite ? 'Remove favourite' : 'Add favourite'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
