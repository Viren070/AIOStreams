import React from 'react';
import { flushSync } from 'react-dom';
import {
  BiCheck,
  BiCheckDouble,
  BiDownload,
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
import {
  useClearResume,
  useSetFavorite,
  useSetPlayed,
  useSetPlayedUpTo,
} from '../lib/queries';
import { toast } from 'sonner';
import { itemTitle, ticksToMs } from '../lib/format';
import { itemPath, navigate, to } from '../lib/paths';
import {
  downloadsHost,
  useDownloadOf,
  useEpisodesToDownload,
} from '../lib/downloads';
import { useStraightPlay, useVersionPicker } from './version-picker';
import { useHeroTarget } from './hero';
import type { BaseItemDto } from '../lib/types';

function PlayEntries({ item }: { item: BaseItemDto }) {
  const picker = useVersionPicker();
  const resumeMs = ticksToMs(item.UserData?.PlaybackPositionTicks);
  const straight = useStraightPlay()(item, resumeMs);
  return (
    <>
      <ContextMenuItem
        data-name="play"
        onSelect={() => picker.play(item, { startMs: resumeMs })}
      >
        <BiPlay /> {resumeMs ? 'Resume' : 'Play'}
      </ContextMenuItem>
      <ContextMenuItem
        data-name={straight ? 'choose-version' : 'play-now'}
        onSelect={() => picker.play(item, { startMs: resumeMs, held: true })}
      >
        {straight ? <BiListUl /> : <BiSkipNext />}
        {straight ? 'Choose a version' : 'Play straight away'}
      </ContextMenuItem>
    </>
  );
}

function DownloadEntry({
  item,
  playable,
}: {
  item: BaseItemDto;
  playable: boolean;
}) {
  const picker = useVersionPicker();
  const episodes = useEpisodesToDownload();
  const download = useDownloadOf(item.Id);
  if (!downloadsHost() || (!playable && item.Type !== 'Series')) return null;
  if (download)
    return (
      <ContextMenuItem
        data-name="downloads"
        onSelect={() => navigate(to.downloads)}
      >
        <BiDownload /> See the download
      </ContextMenuItem>
    );
  return (
    <ContextMenuItem
      data-name="download"
      onSelect={() =>
        item.Type === 'Series'
          ? void episodes(item.Id!).then(
              (items) => items.length && picker.download(items),
              () => toast.error('Could not list the episodes')
            )
          : picker.download([item])
      }
    >
      <BiDownload /> {item.Type === 'Series' ? 'Download the show' : 'Download'}
    </ContextMenuItem>
  );
}

interface MenuTarget {
  item: BaseItemDto;
  /** Shown on the page the item opens, so it offers no way there. */
  onPage?: boolean;
  /** Opens the item's details, from a card that has them. */
  onDetails?: () => void;
}

interface Point {
  clientX: number;
  clientY: number;
}

const OpenMenu = React.createContext<
  ((target: MenuTarget, at: Point) => void) | null
>(null);

/** A phone's menu width, as `max-sm:w-60`, and the room kept beside it. */
const PHONE_MENU = 240 + 8;

/** The one menu all cards open, so a page of cards doesn't mount one each. */
export function ItemMenuHost({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = React.useState<MenuTarget | null>(null);
  const trigger = React.useRef<HTMLSpanElement>(null);
  const open = React.useCallback((next: MenuTarget, at: Point) => {
    flushSync(() => setTarget(next));
    // The menu opens beside the point and never slides, so a phone's point leaves it room.
    const clientX =
      innerWidth < 640
        ? Math.min(at.clientX, innerWidth - PHONE_MENU)
        : at.clientX;
    // The trigger places the menu where it was right clicked.
    trigger.current?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY: at.clientY,
      })
    );
  }, []);
  return (
    <OpenMenu.Provider value={open}>
      {children}
      {/* Not modal: a modal menu turns the whole page's pointer events off and
          on, restyling every element as it opens and closes. */}
      <ContextMenu modal={false}>
        <ContextMenuTrigger ref={trigger} className="hidden" />
        {target && <ItemMenuContent {...target} />}
      </ContextMenu>
    </OpenMenu.Provider>
  );
}

let pressTimer = 0;

/** Right click, or a long press on touch, for what a card's item offers. */
export function ItemMenu({
  children,
  ...target
}: MenuTarget & { children: React.ReactNode }) {
  const heroTarget = useHeroTarget(target.item);
  const open = React.useContext(OpenMenu);
  if (!open) return <div {...heroTarget}>{children}</div>;
  const endPress = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') window.clearTimeout(pressTimer);
  };
  return (
    <div
      {...heroTarget}
      style={{ WebkitTouchCallout: 'none' }}
      onContextMenu={(e) => {
        window.clearTimeout(pressTimer);
        e.preventDefault();
        open(target, e);
      }}
      // Some touch browsers never send a long press as a right click.
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return;
        window.clearTimeout(pressTimer);
        const card = e.currentTarget;
        const at = { clientX: e.clientX, clientY: e.clientY };
        pressTimer = window.setTimeout(
          () => card.isConnected && open(target, at),
          700
        );
      }}
      onPointerMove={endPress}
      onPointerUp={endPress}
      onPointerCancel={endPress}
    >
      {children}
    </div>
  );
}

function ItemMenuContent({ item, onPage, onDetails }: MenuTarget) {
  const setPlayed = useSetPlayed();
  const setPlayedUpTo = useSetPlayedUpTo();
  const clearResume = useClearResume();
  const setFavorite = useSetFavorite();
  // Jellyfin cannot play a virtual item, such as an episode not yet aired.
  const playable =
    (item.Type === 'Movie' || item.Type === 'Episode') &&
    item.LocationType !== 'Virtual';
  const played = !!item.UserData?.Played;
  const favorite = !!item.UserData?.IsFavorite;
  const resumeMs = ticksToMs(item.UserData?.PlaybackPositionTicks);

  return (
    <ContextMenuContent data-ui="item-menu" className="max-sm:w-60">
      <ContextMenuLabel className="line-clamp-1">
        {onPage ? item.Name : itemTitle(item)}
      </ContextMenuLabel>
      {playable && <PlayEntries item={item} />}
      {onDetails && (
        <ContextMenuItem data-name="details" onSelect={onDetails}>
          <BiInfoCircle /> Details
        </ContextMenuItem>
      )}
      <DownloadEntry item={item} playable={playable} />
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
          {resumeMs > 0 && (
            <ContextMenuItem
              data-name="remove-resume"
              onSelect={() => clearResume.mutate(item.Id!)}
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
  );
}
