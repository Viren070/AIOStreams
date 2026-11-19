import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { flushSync } from 'react-dom';
import {
  BiCast,
  BiCheck,
  BiCheckDouble,
  BiDownload,
  BiHeart,
  BiInfoCircle,
  BiListPlus,
  BiListUl,
  BiPlay,
  BiReset,
  BiShuffle,
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
  offersFavourite,
  useClearResume,
  useDropFromContinue,
  useRefreshAll,
  useSetFavorite,
  useSetPlayed,
  useSetPlayedUpTo,
} from '@/lib/jellyfin/watch-state';
import { useRemoteDevices } from '@/lib/jellyfin/history';
import { openRemote } from '@/features/remote/remote-sheet';
import { openRandom } from './random-pick';
import { toast } from 'sonner';
import { itemTitle, ticksToMs } from '@/lib/format';
import { itemPath, navigate, to } from '@/lib/paths';
import {
  downloadsHost,
  useDownloadOf,
  useEpisodesToDownload,
  useMayDownload,
} from '@/lib/downloads';
import {
  useStraightPlay,
  useVersionPicker,
} from '@/features/versions/version-picker';
import { useHeroTarget } from './hero';
import { closeCardPreview, useCardPreview } from './card-preview';
import { useArtTarget } from '@/lib/artwork/background';
import { focusOn } from '@/lib/input';
import { focusBeforeMenu } from '@/lib/input/restore-focus';
import { openAddToPlaylist } from '@/features/playlists/playlists';
import { playable as canPlay } from '@/lib/playlists';
import { usingKeys } from '@/lib/input';
import type { BaseItemDto } from '@/lib/jellyfin/types';

function PlayEntries({ item }: { item: BaseItemDto }) {
  const picker = useVersionPicker();
  const resumeMs = ticksToMs(item.UserData?.PlaybackPositionTicks);
  const straight = useStraightPlay()(item, resumeMs);
  const devices = useRemoteDevices();
  return (
    <>
      <ContextMenuItem
        data-name="play"
        onSelect={() => picker.play(item, { startMs: resumeMs })}
      >
        <BiPlay /> {resumeMs ? t`Resume` : t`Play`}
      </ContextMenuItem>
      <ContextMenuItem
        data-name={straight ? 'choose-version' : 'play-now'}
        onSelect={() => picker.play(item, { startMs: resumeMs, held: true })}
      >
        {straight ? <BiListUl /> : <BiSkipNext />}
        {straight ? t`Choose a version` : t`Play straight away`}
      </ContextMenuItem>
      {!!devices.data?.length && (
        <ContextMenuItem
          data-name="play-on"
          onSelect={() => openRemote({ play: { item, startMs: resumeMs } })}
        >
          <BiCast /> <Trans>Play on another device</Trans>
        </ContextMenuItem>
      )}
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
  const mayDownload = useMayDownload();
  if (!downloadsHost() || (!playable && item.Type !== 'Series')) return null;
  if (download)
    return (
      <ContextMenuItem
        data-name="downloads"
        onSelect={() => navigate(to.downloads)}
      >
        <BiDownload /> <Trans>See the download</Trans>
      </ContextMenuItem>
    );
  if (!mayDownload) return null;
  return (
    <ContextMenuItem
      data-name="download"
      onSelect={() =>
        item.Type === 'Series'
          ? void episodes(item.Id!).then(
              (items) => items.length && picker.download(items),
              () => toast.error(t`Could not list the episodes`)
            )
          : picker.download([item])
      }
    >
      <BiDownload />{' '}
      {item.Type === 'Series' ? t`Download the show` : t`Download`}
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
  ((target: MenuTarget, at: Point, card?: Element) => void) | null
>(null);

/** Opens the menu from a list that draws its own rows. */
export const useOpenItemMenu = () => React.useContext(OpenMenu);

/** A phone's menu width, as `max-sm:w-60`, and the room kept beside it. */
const PHONE_MENU = 240 + 8;

/** The one menu all cards open, so a page of cards doesn't mount one each. */
export function ItemMenuHost({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = React.useState<MenuTarget | null>(null);
  const trigger = React.useRef<HTMLSpanElement>(null);
  const owner = React.useRef<Element>(undefined);
  // The card keeps its spoilers shown while focus is in its menu.
  const own = React.useCallback((card?: Element) => {
    owner.current?.removeAttribute('data-menu-open');
    owner.current = card;
    card?.setAttribute('data-menu-open', '');
  }, []);
  const open = React.useCallback(
    (next: MenuTarget, at: Point, card?: Element) => {
      flushSync(() => setTarget(next));
      own(card);
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
    },
    [own]
  );
  return (
    <OpenMenu.Provider value={open}>
      {children}
      {/* Not modal: a modal menu turns the whole page's pointer events off and
          on, restyling every element as it opens and closes. */}
      <ContextMenu modal={false} onOpenChange={(on) => on || own()}>
        <ContextMenuTrigger ref={trigger} className="hidden" />
        {target && <ItemMenuContent {...target} />}
      </ContextMenu>
    </OpenMenu.Provider>
  );
}

/** How long a removed card's row may take to be drawn without it. */
const DRAWN_WITHOUT_MS = 2000;

interface Leaving {
  /** Its card fades as those after slide over, then `drop` takes it out of the row's data in that same frame. */
  go(drop: () => void): Promise<void>;
  /** The server kept it: all stays as it was. */
  undo(): void;
}

/**
 * The card a menu was opened on, by its place in its row. It waits under a
 * spinner while the server takes it out; then it fades as the cards after
 * it slide over into its place, the row drops it the frame they arrive,
 * and the card now there takes focus. Nothing moves before the server has
 * answered, and nothing jumps as the row is drawn again.
 */
function leaveRow(): Leaving {
  // The card the menu was opened for, which a long press needn't have focused.
  const owner = document.querySelector('[data-menu-open]');
  const card =
    owner?.closest<HTMLElement>('[data-focus="own"]') ??
    owner?.querySelector<HTMLElement>('[data-focus="own"]') ??
    focusBeforeMenu()?.closest<HTMLElement>('[data-focus="own"]');
  const slide = card?.closest<HTMLElement>('[data-ui=media-row-item]');
  const row = slide?.parentElement;
  const slides = () =>
    row
      ? [...row.children].filter(
          (el): el is HTMLElement =>
            el instanceof HTMLElement && el.dataset.ui === 'media-row-item'
        )
      : [];
  closeCardPreview(card);
  // It keeps from opening again as focus comes back to it from the menu.
  card?.setAttribute('data-leaving', '');
  card?.setAttribute('data-removing', '');
  const moving = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    async go(drop) {
      card?.removeAttribute('data-removing');
      const all = slides();
      const at = slide ? all.indexOf(slide) : -1;
      const step =
        all.length > 1
          ? Math.abs(all[1].offsetLeft - all[0].offsetLeft)
          : (slide?.offsetWidth ?? 0);
      const timing = {
        duration: moving ? 320 : 0,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        fill: 'forwards',
      } as const;
      const fade = card?.animate([{ opacity: 1 }, { opacity: 0 }], {
        ...timing,
        duration: moving ? 220 : 0,
        easing: 'cubic-bezier(0.4, 0, 1, 1)',
      });
      const over =
        at >= 0
          ? all
              .slice(at + 1)
              .map((each) =>
                each.animate(
                  [
                    { transform: 'none' },
                    { transform: `translateX(${-step}px)` },
                  ],
                  timing
                )
              )
          : [];
      await Promise.all(
        [fade, ...over].map((a) => a?.finished.catch(() => undefined))
      );
      // The row is drawn without it a task after its data changes. Its cards
      // stand where they slid to until then, and the moment it's drawn, before
      // that frame shows, they're let go where the row now draws them.
      const settle = () => {
        for (const animation of over) animation.cancel();
        fade?.cancel();
        const now = slides();
        const to = at >= 0 ? now[Math.min(at, now.length - 1)] : undefined;
        const target = to?.querySelector<HTMLElement>('[data-focus="own"]');
        const active = document.activeElement;
        if (
          target &&
          (!active ||
            active === document.body ||
            !active.isConnected ||
            active === card)
        )
          focusOn(target);
      };
      await new Promise<void>((done) => {
        let ended = false;
        const finish = () => {
          if (ended) return;
          ended = true;
          observer.disconnect();
          clearTimeout(giveUp);
          settle();
          done();
        };
        const observer = new MutationObserver(() => {
          if (!card?.isConnected) finish();
        });
        if (row) observer.observe(row, { childList: true, subtree: true });
        const giveUp = setTimeout(finish, DRAWN_WITHOUT_MS);
        drop();
        if (!card?.isConnected) finish();
      });
    },
    undo() {
      card?.removeAttribute('data-removing');
      card?.removeAttribute('data-leaving');
    },
  };
}

let pressTimer = 0;

/** Right click, or a long press on touch, for what a card's item offers. */
export function ItemMenu({
  children,
  ...target
}: MenuTarget & { children: React.ReactNode }) {
  const heroTarget = useHeroTarget(target.item);
  const preview = useCardPreview(target.item);
  const art = useArtTarget(target.item);
  const open = React.useContext(OpenMenu);
  const watched = {
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      heroTarget?.onPointerMove(e);
      preview?.onPointerMove(e);
      art?.onPointerMove(e);
    },
    onPointerLeave: () => {
      heroTarget?.onPointerLeave();
      preview?.onPointerLeave();
      art?.onPointerLeave();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      heroTarget?.onFocus();
      preview?.onFocus(e);
      art?.onFocus(e);
    },
    onBlur: () => {
      preview?.onBlur();
      art?.onBlur();
    },
  };
  if (!open) return <div {...watched}>{children}</div>;
  const endPress = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') window.clearTimeout(pressTimer);
  };
  return (
    <div
      {...watched}
      style={{ WebkitTouchCallout: 'none' }}
      onContextMenu={(e) => {
        window.clearTimeout(pressTimer);
        e.preventDefault();
        open(target, e, e.currentTarget);
      }}
      // Some touch browsers never send a long press as a right click.
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return;
        window.clearTimeout(pressTimer);
        const card = e.currentTarget;
        const at = { clientX: e.clientX, clientY: e.clientY };
        pressTimer = window.setTimeout(
          () => card.isConnected && open(target, at, card),
          700
        );
      }}
      onPointerMove={(e) => {
        watched.onPointerMove(e);
        endPress(e);
      }}
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
  const clearResume = useClearResume({ refresh: false });
  const dropFromContinue = useDropFromContinue();
  const refreshAll = useRefreshAll();
  const setFavorite = useSetFavorite();
  const playable = canPlay(item);
  // A channel keeps no watch state, and has no page or download of its own.
  const channel = item.Type === 'TvChannel';
  const played = !!item.UserData?.Played;
  const favorite = !!item.UserData?.IsFavorite;
  const resumeMs = ticksToMs(item.UserData?.PlaybackPositionTicks);

  return (
    <ContextMenuContent
      data-ui="item-menu"
      className="max-sm:w-60"
      // Radix starts on the first entry only for keys it sees, and the input
      // layer takes a remote's held Enter and a gamepad's buttons first.
      onFocus={(e) => {
        const menu = e.currentTarget;
        if (e.target !== menu || !usingKeys()) return;
        if (menu.contains(e.relatedTarget as Node | null)) return;
        menu
          .querySelector<HTMLElement>('[role=menuitem]:not([data-disabled])')
          ?.focus({ preventScroll: true });
      }}
    >
      <ContextMenuLabel className="line-clamp-1">
        {onPage ? item.Name : itemTitle(item)}
      </ContextMenuLabel>
      {playable && <PlayEntries item={item} />}
      {playable && !channel && (
        <ContextMenuItem
          data-name="add-to-playlist"
          onSelect={() => openAddToPlaylist([item])}
        >
          <BiListPlus /> <Trans>Add to playlist</Trans>
        </ContextMenuItem>
      )}
      {onDetails && (
        <ContextMenuItem data-name="details" onSelect={onDetails}>
          <BiInfoCircle /> <Trans>Details</Trans>
        </ContextMenuItem>
      )}
      {item.Type === 'Series' && (
        <ContextMenuItem
          data-name="random-episode"
          onSelect={() => openRandom({ kind: 'episode', series: item })}
        >
          <BiShuffle /> <Trans>Random episode</Trans>
        </ContextMenuItem>
      )}
      <DownloadEntry item={item} playable={playable && !channel} />
      {!onPage && !channel && (
        <ContextMenuItem
          data-name="open"
          onSelect={() => navigate(itemPath(item))}
        >
          {item.Type === 'Episode' ? (
            <>
              <BiTv /> <Trans>Go to show</Trans>
            </>
          ) : (
            <>
              <BiInfoCircle /> <Trans>Open</Trans>
            </>
          )}
        </ContextMenuItem>
      )}
      {item.Type !== 'BoxSet' && !channel && (
        <>
          {(playable || !onPage) && <ContextMenuSeparator />}
          <ContextMenuItem
            data-name="watched"
            onSelect={() =>
              setPlayed.mutate({ itemId: item.Id!, played: !played })
            }
          >
            <BiCheck /> {played ? t`Mark unwatched` : t`Mark watched`}
          </ContextMenuItem>
          {item.Type === 'Episode' && item.SeriesId && (
            <ContextMenuItem
              data-name="watched-up-to"
              onSelect={() => setPlayedUpTo.mutate(item)}
            >
              <BiCheckDouble /> <Trans>Mark watched up to here</Trans>
            </ContextMenuItem>
          )}
          {resumeMs > 0 && (
            <ContextMenuItem
              data-name="remove-resume"
              onSelect={() => {
                const leaving = leaveRow();
                const id = item.Id!;
                clearResume.mutate(id, {
                  onSuccess: () =>
                    void leaving
                      .go(() => dropFromContinue(id))
                      .finally(() => void refreshAll()),
                  onError: () => leaving.undo(),
                });
              }}
            >
              <BiReset /> <Trans>Remove from continue watching</Trans>
            </ContextMenuItem>
          )}
        </>
      )}
      {offersFavourite(item.Type, favorite) && (
        <ContextMenuItem
          data-name="favourite"
          onSelect={() =>
            setFavorite.mutate({ itemId: item.Id!, favorite: !favorite })
          }
        >
          {favorite ? <BiSolidHeart /> : <BiHeart />}
          {favorite ? t`Remove favourite` : t`Add favourite`}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );
}
