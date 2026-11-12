import { t } from '@lingui/core/macro';
import React from 'react';
import { LuPause, LuPlay, LuX } from 'react-icons/lu';
import { LoadingSpinner } from '@aiostreams/ui/loading-spinner';
import { cn } from '@aiostreams/ui/core/styling';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { useSession } from '@/lib/jellyfin/session';
import { landscapeUrl } from '@/lib/artwork/urls';
import { itemSubtitle, itemTitle } from '@/lib/format';
import { appBridge } from '@/lib/hosts/shell/bridge';
import type { PlayerController } from '@/lib/playback/controller';
import type { VideoFrame } from '@/lib/playback/engine';
import { usePlayhead } from '@/lib/playback/playhead';
import {
  canMinimise,
  closePlayback,
  expandPlayback,
} from '@/lib/playback/session';
import { useDock } from '@/lib/playback/dock';
import { settings, useSetting, type MiniCorner } from '@/lib/settings';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { CachedImage } from '@/components/cached-image';

const NARROW = '(max-width: 639px)';
export const MINI_MOVE_MS = 220;
const MINI_MOVE_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
// eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value
const FADE = 'opacity 150ms ease-out';
const STRIP = 56;
const BAR = 64;
const BAR_INSET = 6;
const GAP = 8;
/** As `rounded-2xl` and `rounded-[10px]`, which the app's video follows. */
const CARD_RADIUS = 16;
const BAR_RADIUS = 10;
const MARGIN = 16;
const SLOP = 8;
const SWIPE = 40;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MiniVideoPlace = React.CSSProperties;

interface Layout {
  mode: 'card' | 'bar';
  box: Box;
  video: Box;
}

let probe: HTMLDivElement | undefined;

function safeProbe() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.append(probe);
  }
  return probe;
}

function safeArea() {
  const style = getComputedStyle(safeProbe());
  return {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
}

/** Where an element sits without the slide it scrolls away with. */
function placed(selector: string): Box | null {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el || !el.offsetWidth || !el.offsetHeight) return null;
  if (getComputedStyle(el).display === 'none') return null;
  const box = el.getBoundingClientRect();
  const shift = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return {
    x: box.left - shift.m41,
    y: box.top - shift.m42,
    width: box.width,
    height: box.height,
  };
}

const NAVIGATION = [
  '[data-ui="mobile-nav"]',
  '[data-ui="top-tabs"]',
  '[data-ui="sidebar"]',
  '[data-ui="touch-rail"]',
  '[data-ui="tv-rail"]',
  '[data-ui="corner-menu"]',
];

function room() {
  const safe = safeArea();
  let top = safe.top;
  let left = safe.left;
  let right = innerWidth - safe.right;
  let bottom = innerHeight - safe.bottom;
  // The navigation slides away as a whole, so its surface is placed from its box.
  const nav = document.querySelector<HTMLElement>('[data-ui="mobile-nav"]');
  const surface = nav?.firstElementChild as HTMLElement | null | undefined;
  const bar = placed('[data-ui="mobile-nav"]');
  if (bar && surface && !nav?.dataset.away)
    bottom = Math.min(bottom, bar.y + surface.offsetTop);
  const tabs = placed('[data-ui="top-tabs"]');
  if (tabs) top = Math.max(top, tabs.y + tabs.height);
  const rtl = document.documentElement.dir === 'rtl';
  for (const selector of NAVIGATION.slice(2)) {
    const side = placed(selector);
    if (!side) continue;
    // A menu in a top corner only takes the top.
    if (side.height < innerHeight / 2)
      top = Math.max(top, side.y + side.height);
    else if (rtl) right = Math.min(right, side.x);
    else left = Math.max(left, side.x + side.width);
  }
  return { top, left, right, bottom };
}

function layOut(mode: Layout['mode'], corner: MiniCorner): Layout {
  const area = room();
  if (mode === 'bar') {
    const width = area.right - area.left - 2 * GAP;
    const box = {
      x: area.left + GAP,
      y: area.bottom - GAP - BAR,
      width,
      height: BAR,
    };
    const height = BAR - 2 * BAR_INSET;
    const videoWidth = Math.round((height * 16) / 9);
    const rtl = document.documentElement.dir === 'rtl';
    return {
      mode,
      box,
      video: {
        x: rtl ? box.x + box.width - BAR_INSET - videoWidth : box.x + BAR_INSET,
        y: box.y + BAR_INSET,
        width: videoWidth,
        height,
      },
    };
  }
  const width = Math.max(
    0,
    Math.round(
      Math.min(
        Math.max(256, innerWidth * 0.32),
        400,
        ((area.bottom - area.top - 2 * MARGIN - STRIP) * 16) / 9
      )
    )
  );
  const videoHeight = Math.round((width * 9) / 16);
  const height = videoHeight + STRIP;
  const rtl = document.documentElement.dir === 'rtl';
  const atEnd = corner.endsWith('end') !== rtl;
  const x = atEnd ? area.right - MARGIN - width : area.left + MARGIN;
  const y = corner.startsWith('bottom')
    ? area.bottom - MARGIN - height
    : area.top + MARGIN;
  return {
    mode,
    box: { x, y, width, height },
    video: { x, y, width, height: videoHeight },
  };
}

function nearestCorner(x: number, y: number, size: Box): MiniCorner {
  const area = room();
  const rtl = document.documentElement.dir === 'rtl';
  const right = x + size.width / 2 > (area.left + area.right) / 2;
  const bottom = y + size.height / 2 > (area.top + area.bottom) / 2;
  return `${bottom ? 'bottom' : 'top'}-${right !== rtl ? 'end' : 'start'}`;
}

const overlaps = (a: Box, b: DOMRect) =>
  a.x < b.right &&
  a.x + a.width > b.left &&
  a.y < b.bottom &&
  a.y + a.height > b.top;

/**
 * Dialogs dim the whole page; popovers, whose content is a dialog too, menus
 * and the like only hide what they cover.
 */
const MODAL = '[role="dialog"], [role="alertdialog"]';
const POPPER = '[data-radix-popper-content-wrapper]';
const OVER = `${MODAL}, [role="menu"], [role="listbox"], ${POPPER}`;

/** Something the page opened over the player, which the app's video would hide. */
function useCovered(box: Box): boolean {
  const [covered, setCovered] = React.useState(false);
  const check = React.useCallback(() => {
    const over = [...document.querySelectorAll(OVER)].some(
      (el) =>
        (el.matches(MODAL) && !el.closest(POPPER)) ||
        overlaps(box, el.getBoundingClientRect())
    );
    setCovered(over);
  }, [box]);
  React.useEffect(() => {
    check();
    // Overlays open in portals at the end of the body, and slide into place after.
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true });
    document.addEventListener('animationend', check, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('animationend', check, true);
    };
  }, [check]);
  return covered;
}

/** Counts changes to the window, the navigation and the system's bars. */
function useRoomChanges() {
  const [changes, setChanges] = React.useState(0);
  React.useEffect(() => {
    const update = () => setChanges((n) => n + 1);
    window.addEventListener('resize', update);
    const watched = new Set<Element>();
    const watch = () => {
      for (const selector of NAVIGATION) {
        const el = document.querySelector(selector);
        if (el && !watched.has(el)) {
          watched.add(el);
          observer.observe(el);
        }
      }
    };
    // A navigation going away is when another takes its place.
    const observer = new ResizeObserver(() => {
      watch();
      update();
    });
    observer.observe(safeProbe());
    watch();
    return () => {
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, []);
  return changes;
}

interface MiniPlayerProps {
  item?: BaseItemDto;
  player?: PlayerController;
  error?: string;
  /** For the page's own video, which stays where it is in the page so it plays on. */
  onVideoPlace?: (place: MiniVideoPlace) => void;
}

/** A TV has no corner card, so between pages it waits this long for a preview. */
const DOCK_GAP_MS = 300;
/** A stall shorter than this keeps its picture. */
const STALL_MS = 500;

/**
 * Until the first frame, and through a stall that lasts. The video gives way
 * to the spinner then, as the apps draw it over the page and it would hold the
 * last picture, or nothing.
 */
function useLoading(player: PlayerController | undefined): boolean {
  const state = player?.state;
  const stalled =
    !!state && !state.paused && (state.waiting || !!state.reconnecting);
  const [late, setLate] = React.useState(false);
  React.useEffect(() => {
    if (!stalled) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), STALL_MS);
    return () => clearTimeout(timer);
  }, [stalled]);
  return !state?.started || late;
}

/** Plays on in a page's preview where one is shown, else in a corner. */
export function MiniPlayer(props: MiniPlayerProps) {
  const dock = useDock();
  const room = !!dock || canMinimise();
  React.useEffect(() => {
    if (room) return;
    const timer = setTimeout(closePlayback, DOCK_GAP_MS);
    return () => clearTimeout(timer);
  }, [room]);
  if (dock) return <DockedPlayer {...props} dock={dock} />;
  return room ? <CornerPlayer {...props} /> : null;
}

/**
 * The mini player, playing on while pages open: a card in a corner that a drag
 * moves to another, or on narrow windows a bar above the navigation that a
 * swipe up opens and a swipe down closes. An app shows its video where the
 * card leaves room for it; the page's own goes in that room.
 */
function CornerPlayer({ item, player, error, onVideoPlace }: MiniPlayerProps) {
  const { client } = useSession();
  const narrow = useMediaQuery(NARROW);
  const mode = narrow ? 'bar' : 'card';
  const [corner, setCorner] = useSetting(settings.player.miniCorner);
  const roomChanges = useRoomChanges();
  const [layout, setLayout] = React.useState(() => layOut(mode, corner));
  const [animate, setAnimate] = React.useState(false);
  const [drag, setDrag] = React.useState<{ dx: number; dy: number } | null>(
    null
  );
  /** The app drags its video, which the card hides for; the frame waits until it lets go. */
  const [appDrag, setAppDrag] = React.useState(false);
  React.useLayoutEffect(() => {
    setLayout(layOut(mode, corner));
  }, [mode, corner, roomChanges]);
  // The bar follows the navigation as it slides away and back.
  React.useEffect(() => {
    const nav = document.querySelector('[data-ui="mobile-nav"]');
    if (!nav || mode !== 'bar') return;
    const observer = new MutationObserver(() => {
      setAnimate(true);
      setLayout(layOut(mode, corner));
    });
    observer.observe(nav, { attributes: true, attributeFilter: ['data-away'] });
    return () => observer.disconnect();
  }, [mode, corner]);
  const covered = useCovered(layout.box);
  const loading = useLoading(player);

  // Pages keep the bar's room free, as they do the navigation's.
  React.useLayoutEffect(() => {
    if (mode !== 'bar') return;
    const root = document.documentElement;
    root.style.setProperty('--mini-bar', `${BAR + GAP}px`);
    return () => {
      root.style.removeProperty('--mini-bar');
    };
  }, [mode]);

  // A new function each render of the player, which must not clear the frame.
  const setFrame = player?.setFrame;
  const latestSetFrame = React.useRef(setFrame);
  latestSetFrame.current = setFrame;
  const frame = React.useMemo<VideoFrame>(
    () => ({
      ...layout.video,
      draggable: mode === 'card',
      hidden: covered || !!error || loading,
      animate,
      radius: mode === 'card' ? CARD_RADIUS : BAR_RADIUS,
      bottomRadius: mode === 'card' ? 0 : BAR_RADIUS,
      subtitles: mode === 'card',
    }),
    [layout.video, mode, covered, error, loading, animate]
  );
  const framed = !!setFrame;
  React.useEffect(() => {
    if (framed && !appDrag) latestSetFrame.current?.(frame);
  }, [framed, appDrag, frame]);
  React.useEffect(() => () => latestSetFrame.current?.(null), []);

  const moveTo = React.useCallback(
    (next: MiniCorner) => {
      setAnimate(true);
      setCorner(next);
      setLayout(layOut(mode, next));
    },
    [mode, setCorner]
  );
  React.useEffect(() => {
    if (!animate) return;
    const timer = setTimeout(() => setAnimate(false), MINI_MOVE_MS);
    return () => clearTimeout(timer);
  }, [animate, layout]);

  // The app takes presses on its video itself, as the page can't get them.
  const latestBox = React.useRef(layout.box);
  latestBox.current = layout.box;
  React.useEffect(
    () =>
      appBridge()?.subscribe((m) => {
        if (m.type !== 'player-frame') return;
        if (!('x' in m)) {
          if (m.event === 'tap') expandPlayback();
          else setAppDrag(true);
          return;
        }
        setAnimate(false);
        setLayout((current) => ({
          ...current,
          box: {
            ...current.box,
            x: m.x - (current.video.x - current.box.x),
            y: m.y - (current.video.y - current.box.y),
          },
          video: { ...current.video, x: m.x, y: m.y },
        }));
        if (m.event === 'moving') return;
        // From where the video was let go, the card and the video move together.
        const box = latestBox.current;
        setAppDrag(false);
        requestAnimationFrame(() => moveTo(nearestCorner(m.x, m.y, box)));
      }),
    [moveTo]
  );

  const press = React.useRef<{
    x: number;
    y: number;
    moved: boolean;
    onVideo: boolean;
  } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    const onVideo = !!(e.target as Element).closest(
      '[data-ui="mini-player-video"]'
    );
    press.current = { x: e.clientX, y: e.clientY, moved: false, onVideo };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const start = press.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < SLOP) return;
    start.moved = true;
    // Only the page's own video moves with the card; an app's would trail it.
    if (setFrame) return;
    if (mode === 'card') setDrag({ dx, dy });
    else setDrag({ dx: 0, dy: Math.max(-SWIPE, Math.min(dy, SWIPE)) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = press.current;
    press.current = null;
    setDrag(null);
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!start.moved) return expandPlayback();
    if (mode === 'bar') {
      if (dy <= -SWIPE) expandPlayback();
      else if (dy >= SWIPE) closePlayback();
      return;
    }
    if (!setFrame)
      moveTo(nearestCorner(layout.box.x + dx, layout.box.y + dy, layout.box));
  };

  const started = !!player?.state.started;
  const paused = !!player?.state.paused;
  const backdrop = item ? landscapeUrl(client, item, { maxWidth: 640 }) : null;
  const title = item ? itemTitle(item) : '';
  const detail = error ? t`Playback failed` : item ? itemSubtitle(item) : '';
  const { box, video: room } = layout;
  const offset = drag ? `translate(${drag.dx}px, ${drag.dy}px)` : '';
  const transition =
    animate && !drag
      ? // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value
        `transform ${MINI_MOVE_MS}ms ${MINI_MOVE_EASE}`
      : undefined;
  const videoTransform = `translate(${room.x}px, ${room.y}px) ${offset}`;
  const { radius, bottomRadius } = frame;
  React.useLayoutEffect(() => {
    onVideoPlace?.({
      width: room.width,
      height: room.height,
      transform: videoTransform,
      transition,
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value
      borderRadius: `${radius}px ${radius}px ${bottomRadius}px ${bottomRadius}px`,
      opacity: loading ? 0 : undefined,
    });
  }, [
    onVideoPlace,
    room.width,
    room.height,
    videoTransform,
    transition,
    radius,
    bottomRadius,
    loading,
  ]);
  return (
    <div
      data-ui="mini-player"
      data-mode={mode}
      data-corner={mode === 'card' ? corner : undefined}
      className={cn(
        'fixed left-0 top-0 z-40 touch-none select-none overflow-hidden bg-gray-950 shadow-[0_10px_40px_rgba(0,0,0,0.6)] ring-1 ring-white/10',
        'rounded-2xl',
        mode === 'bar' && 'flex items-center',
        // The app's video moves frames before the page can follow it.
        appDrag && 'opacity-0'
      )}
      style={{
        width: box.width,
        height: box.height,
        transform: `translate(${box.x}px, ${box.y}px) ${offset}`,
        transition: [transition, FADE].filter(Boolean).join(', '),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        press.current = null;
        setDrag(null);
      }}
    >
      <div
        data-ui="mini-player-video"
        className={cn(
          'relative flex-none overflow-hidden bg-black',
          mode === 'bar' && 'ms-1.5 rounded-[10px]'
        )}
        style={{ width: room.width, height: room.height }}
      >
        {backdrop && (!started || frame.hidden) && (
          <CachedImage
            data-ui="mini-player-image"
            src={backdrop}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-60"
          />
        )}
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <LoadingSpinner className="size-6" />
          </div>
        )}
      </div>
      <div
        data-ui="mini-player-strip"
        className={cn(
          'relative flex min-w-0 items-center gap-1',
          mode === 'bar' ? 'h-full flex-1 ps-3 pe-1.5' : 'px-3',
          mode === 'card' && 'h-14'
        )}
      >
        {player && mode === 'card' && <Progress player={player} at="top" />}
        <button
          type="button"
          data-ui="mini-player-title"
          className="min-w-0 flex-1 py-1 text-start"
          onClick={expandPlayback}
        >
          <p data-name="name" className="truncate text-sm font-semibold">
            {title}
          </p>
          {detail && (
            <p
              data-name="detail"
              className={cn(
                'truncate text-xs',
                error ? 'text-red-300' : 'text-[--muted]'
              )}
            >
              {detail}
            </p>
          )}
        </button>
        {player && !error && (
          <MiniButton
            name={paused ? 'play' : 'pause'}
            label={paused ? t`Play` : t`Pause`}
            onClick={() => player.togglePlay()}
          >
            {paused ? <LuPlay className="ms-0.5" /> : <LuPause />}
          </MiniButton>
        )}
        <MiniButton name="close" label={t`Close`} onClick={closePlayback}>
          <LuX />
        </MiniButton>
      </div>
      {player && mode === 'bar' && <Progress player={player} at="bottom" />}
    </div>
  );
}

function MiniButton({
  name,
  label,
  onClick,
  children,
}: {
  name: string;
  label: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-ui="mini-player-button"
      data-name={name}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-10 flex-none items-center justify-center rounded-full text-xl transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

function Progress({
  player,
  at,
}: {
  player: PlayerController;
  at: 'top' | 'bottom';
}) {
  const { durationMs } = player.state;
  const share = usePlayhead(player.playhead, (head) =>
    durationMs ? Math.round((head.positionMs / durationMs) * 200) / 200 : 0
  );
  return (
    <div
      data-ui="mini-player-progress"
      className={cn(
        'pointer-events-none absolute inset-x-0 h-0.5 bg-white/15',
        at === 'top' ? 'top-0' : 'bottom-0'
      )}
    >
      <div
        data-ui="mini-player-progress-fill"
        className="h-full bg-brand-400"
        style={{ width: `${share * 100}%` }}
      />
    </div>
  );
}

/** As the page's own fade moves it into place after it mounts. */
const SETTLE_MS = 600;

const sameBox = (a: Box, b: Box) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function useBoxOf(el: HTMLElement): Box {
  const [box, setBox] = React.useState<Box>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  React.useLayoutEffect(() => {
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { x: r.left, y: r.top, width: r.width, height: r.height };
      setBox((last) => (sameBox(last, next) ? last : next));
    };
    measure();
    const until = performance.now() + SETTLE_MS;
    let frame = requestAnimationFrame(function settle(at) {
      measure();
      if (at < until) frame = requestAnimationFrame(settle);
    });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(document.documentElement);
    document.addEventListener('scroll', measure, {
      capture: true,
      passive: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('scroll', measure, { capture: true });
    };
  }, [el]);
  return box;
}

/** The video in a page's preview: the page draws around it and takes its presses. */
function DockedPlayer({
  dock,
  player,
  error,
  onVideoPlace,
}: MiniPlayerProps & { dock: HTMLElement }) {
  const box = useBoxOf(dock);
  const covered = useCovered(box);
  const loading = useLoading(player);
  const [radius] = React.useState(
    () => parseFloat(getComputedStyle(dock).borderTopLeftRadius) || 0
  );
  const setFrame = player?.setFrame;
  const latestSetFrame = React.useRef(setFrame);
  latestSetFrame.current = setFrame;
  const frame = React.useMemo<VideoFrame>(
    () => ({
      ...box,
      draggable: false,
      hidden: covered || !!error || !box.width || loading,
      animate: false,
      radius,
      bottomRadius: radius,
      subtitles: true,
    }),
    [box, covered, error, loading, radius]
  );
  const framed = !!setFrame;
  React.useEffect(() => {
    if (framed) latestSetFrame.current?.(frame);
  }, [framed, frame]);
  React.useEffect(() => () => latestSetFrame.current?.(null), []);
  React.useEffect(
    () =>
      appBridge()?.subscribe((m) => {
        if (m.type === 'player-frame' && !('x' in m) && m.event === 'tap')
          expandPlayback();
      }),
    []
  );
  React.useLayoutEffect(() => {
    onVideoPlace?.({
      width: box.width,
      height: box.height,
      transform: `translate(${box.x}px, ${box.y}px)`,
      borderRadius: `${radius}px`,
      opacity: loading ? 0 : undefined,
    });
  }, [onVideoPlace, box, radius, loading]);
  return (
    <div
      data-ui="docked-player"
      className="pointer-events-none fixed left-0 top-0 z-40 flex items-center justify-center"
      style={{
        width: box.width,
        height: box.height,
        transform: `translate(${box.x}px, ${box.y}px)`,
      }}
    >
      {error ? (
        <p
          data-name="error"
          className="rounded-full bg-black/70 px-3 py-1 text-sm text-red-300"
        >
          {t`Playback failed`}
        </p>
      ) : (
        loading && <LoadingSpinner className="size-8" />
      )}
    </div>
  );
}
