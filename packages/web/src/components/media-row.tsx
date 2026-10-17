import React from 'react';
import { useRouter } from '@tanstack/react-router';
import {
  Carousel,
  CarouselAnatomy,
  CarouselContent,
  CarouselNext,
  CarouselPrevious,
  useCarousel,
} from '@aiostreams/ui/carousel';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { cn } from '@aiostreams/ui/core/styling';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { currentHost } from '../lib/hosts';
import { scrolled, scrollToStart, startOf } from '../lib/direction';
import {
  settings,
  useSetting,
  type PosterLine,
  type PosterSize,
} from '../lib/settings';
import { RowScroller, ScrollRoot, watch } from '../lib/use-in-view';
import { easeLayers, GLIDE_LAYERS } from '../lib/input/glide';

/**
 * Each shape's card width, narrowed where a box sets `--row-card-h` so its
 * artwork, caption and the slide's padding fit that height.
 */
const ITEM_WIDTH = {
  poster:
    'basis-[9rem] sm:basis-[10.5rem] lg:basis-[11.5rem] 2xl:basis-[12.5rem] max-w-[calc((var(--row-card-h,100vh)-var(--poster-text))*2/3+1rem)]',
  square:
    'basis-[10rem] sm:basis-[11.5rem] lg:basis-[12.5rem] max-w-[calc(var(--row-card-h,100vh)-var(--poster-text)+1rem)]',
  wide: 'basis-[16rem] sm:basis-[18rem] lg:basis-[20rem] 2xl:basis-[22rem] max-w-[calc((var(--row-card-h,100vh)-3.25rem)*16/9+1rem)]',
};

const SKELETON_SHAPE = {
  poster: 'aspect-[2/3]',
  square: 'aspect-square',
  wide: 'aspect-video',
};

export type RowShape = keyof typeof ITEM_WIDTH;

/** A poster caption's height, which a `--row-card-h` cap leaves room for. */
const posterText = (lines: PosterLine[]) =>
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS
  `calc(${lines.length ? '0.5rem' : '0rem'}${lines.includes('title') ? ' + 1.25rem' : ''}${lines.includes('year') ? ' + 1rem' : ''})`;

const reducedMotion =
  typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : null;

// Script animations, as CSS ones send each card's start and end through the
// page's event handling.
const CARD_IN = Array.from(
  { length: 20 },
  (_, i) => (el: HTMLElement | null) =>
    void el?.animate(
      reducedMotion?.matches
        ? { opacity: [0, 1] }
        : { opacity: [0, 1], transform: ['translateY(8px)', 'none'] },
      { duration: 300, delay: i * 25, easing: 'ease-out', fill: 'backwards' }
    )
);

/** Cards fade in a little after one another, a page at a time. */
export function fadeIn(index: number) {
  return { ref: CARD_IN[index % 20] };
}

/** Past this many cards, a row draws only those near its view; the rest hold their places empty. */
const WINDOWED = 40;
/** Cards drawn past each side of the view, so the next one a key moves to is there. */
const MARGIN = 12;

/** The cards a long row draws: around its start at first, then wherever it has been scrolled. */
function useWindow(count: number, start: number, loading: boolean) {
  // Decided as the cards first arrive, so a row that grows as it pages keeps them all.
  const [windowed, setWindowed] = React.useState<boolean>();
  if (windowed === undefined && !loading && count)
    setWindowed(count > WINDOWED);
  const [first] = React.useState<[number, number]>([
    Math.max(0, start - MARGIN),
    start + 2 * MARGIN,
  ]);
  const [range, setRange] = React.useState(first);
  const view = React.useCallback((from: number, to: number) => {
    setRange((r) =>
      from - MARGIN < r[0] || to + MARGIN > r[1]
        ? [
            Math.max(0, Math.min(r[0], from - MARGIN)),
            Math.max(r[1], to + 2 * MARGIN),
          ]
        : r
    );
  }, []);
  if (!windowed) return { drawn: () => true, fades: () => true };
  return {
    drawn: (i: number) => i >= range[0] && i < range[1],
    // Only the first cards fade in; later ones are drawn ahead of the view.
    fades: (i: number) => i >= first[0] && i < first[1],
    onView: view,
  };
}

function ViewWatcher({
  onView,
}: {
  onView: (first: number, last: number) => void;
}) {
  const { api } = useCarousel();
  React.useEffect(() => {
    if (!api) return;
    const check = () => {
      const seen = api.slidesInView();
      if (seen.length) onView(Math.min(...seen), Math.max(...seen));
    };
    check();
    api.on('slidesInView', check);
    return () => {
      api.off('slidesInView', check);
    };
  }, [api, onView]);
  return null;
}

/** Asks for more once the row is scrolled most of the way. */
function EndWatcher({ onEnd }: { onEnd: () => void }) {
  const { api } = useCarousel();
  React.useEffect(() => {
    if (!api) return;
    const check = () => {
      if (api.scrollProgress() > 0.7 || !api.canScrollNext()) onEnd();
    };
    api.on('scroll', check);
    api.on('settle', check);
    return () => {
      api.off('scroll', check);
      api.off('settle', check);
    };
  }, [api, onEnd]);
  return null;
}

/** The row's arrows, only while there is somewhere to scroll and not on a TV, where focus scrolls it. */
function RowNav() {
  const { canScrollPrev, canScrollNext } = useCarousel();
  if (currentHost().tv || (!canScrollPrev && !canScrollNext)) return null;
  return (
    <div data-ui="media-row-nav" className="hidden gap-1 md:flex">
      <CarouselPrevious />
      <CarouselNext />
    </div>
  );
}

/** Per history entry, so a fresh visit to the page starts the row over. */
function useEntryKey(id: string | undefined) {
  const router = useRouter();
  const [entry] = React.useState(() => {
    const location = router.state.location;
    return location.state.__TSR_key ?? location.href;
  });
  return id ? `${entry}|${id}` : undefined;
}

/** A row's card, as Embla's slide or a TV row's. */
function Slide({
  className,
  children,
}: {
  className: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-hidden={children ? undefined : true}
      data-ui="media-row-item"
      className={cn(CarouselAnatomy.item({ gap: 'md' }), className)}
    >
      {children}
    </div>
  );
}

/**
 * Marks the cards in `box` out of sight of `root` (and `rootMargin` around it)
 * `data-nav-out`, so arrow navigation needn't measure them. `count` re-arms it
 * for cards added since.
 */
function useMarkOutOfView(
  box: React.RefObject<HTMLElement | null>,
  count: number,
  root: React.RefObject<Element | null> | Element | null,
  rootMargin?: string,
  enabled = true
) {
  React.useEffect(() => {
    const cards = box.current?.children;
    if (!cards || !enabled) return;
    const stops = [...cards].map((card) =>
      watch(
        card,
        root && 'current' in root ? root.current : root,
        rootMargin ?? '0px',
        (entry) => card.toggleAttribute('data-nav-out', !entry.isIntersecting)
      )
    );
    return () => stops.forEach((stop) => stop());
  }, [box, count, root, rootMargin, enabled]);
}

const savedScroll = new Map<string, number>();

/** The room after a focused card in a TV row; a card's padding leaves the room before. */
const ROOM = 16;

/**
 * A TV's or touch screen's row: a plain scroller, as Embla's measuring and
 * scripted easing are too much for a TV's CPU and stutter a swipe. Focus jumps
 * it, and an animated transform eases the jump on the compositor.
 */
function NativeRow({
  restoreKey,
  start,
  onEnd,
  onView,
  count,
  children,
}: {
  restoreKey: string | undefined;
  start: number;
  onEnd?: () => void;
  /** Told the first and last card in view as the row scrolls. */
  onView?: (first: number, last: number) => void;
  /** How many cards, so new ones are watched too. */
  count: number;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const layer = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = restoreKey ? savedScroll.get(restoreKey) : undefined;
    const card = content.current?.children[start];
    if (saved !== undefined) el.scrollLeft = saved;
    else if (start && card instanceof HTMLElement && content.current)
      scrollToStart(
        el,
        startOf(content.current, el) + startOf(card, content.current)
      );
    // Once, as the carousel reads its start once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    const el = ref.current;
    const row = content.current;
    if (!el || !row) return;
    const follow = (e: FocusEvent) => {
      const card =
        e.target instanceof Element
          ? e.target.closest('[data-ui=media-row-item]')
          : null;
      if (!(card instanceof HTMLElement) || card.parentElement !== row) return;
      // Layout's own offsets, which a glide under way leaves alone.
      const left = startOf(row, el) + startOf(card, row);
      const right = left + card.offsetWidth;
      const from = scrolled(el);
      const to =
        left < from
          ? left
          : right + ROOM > from + el.clientWidth
            ? Math.min(right + ROOM - el.clientWidth, left)
            : from;
      if (to === from) return;
      const was = el.scrollLeft;
      scrollToStart(el, to);
      if (layer.current) easeLayers(layer.current, 'X', el.scrollLeft - was);
    };
    el.addEventListener('focusin', follow);
    return () => el.removeEventListener('focusin', follow);
  }, []);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      if (restoreKey) savedScroll.set(restoreKey, el.scrollLeft);
      const range = el.scrollWidth - el.clientWidth;
      if (onEnd && (range <= 1 || scrolled(el) / range > 0.7)) onEnd();
      const row = content.current;
      const [first, second] = row?.children ?? [];
      if (
        !onView ||
        !row ||
        !(first instanceof HTMLElement) ||
        !(second instanceof HTMLElement)
      )
        return;
      // The cards are all one width.
      const pitch = startOf(second, row) - startOf(first, row);
      const from = scrolled(el) - startOf(row, el) - startOf(first, row);
      if (pitch > 0)
        onView(
          Math.floor(from / pitch),
          Math.ceil((from + el.clientWidth) / pitch)
        );
    };
    // In a frame, which lays the row out anyway, rather than forcing it now.
    const first = requestAnimationFrame(check);
    el.addEventListener('scroll', check, { passive: true });
    return () => {
      cancelAnimationFrame(first);
      el.removeEventListener('scroll', check);
    };
  }, [restoreKey, onEnd, onView, count]);
  useMarkOutOfView(content, count, ref, undefined, !!currentHost().tv);
  return (
    <div
      ref={ref}
      data-nav-self-scroll
      className={cn(
        CarouselAnatomy.content(),
        // Room for a focused card's ring, which the scroller clips; the row pads its start.
        'relative -mb-1.5 -me-4 -ms-1.5 overflow-x-auto overflow-y-hidden pb-1.5 [scrollbar-width:none] lg:-me-10 [&::-webkit-scrollbar]:hidden'
      )}
    >
      {Array.from({ length: GLIDE_LAYERS }).reduceRight<React.ReactNode>(
        (inside, _, i) => (
          <div
            ref={i === 0 ? layer : undefined}
            data-glide-layer
            // Kept as layers, since one made as a glide starts draws nothing for a frame.
            className="will-change-transform"
          >
            {inside}
          </div>
        ),
        <div
          ref={content}
          data-nav-row
          className={cn(
            CarouselAnatomy.innerContent({ gap: 'md' }),
            // A scroller leaves the last card's margin out of its end.
            "relative mt-3 ps-1.5 after:shrink-0 after:basis-4 after:content-['']"
          )}
        >
          <RowScroller.Provider value={ref}>{children}</RowScroller.Provider>
        </div>
      )}
    </div>
  );
}

/** A titled, draggable row of cards that pages as it nears its end. */
export function MediaRow({
  id,
  title,
  header,
  shape,
  itemClass,
  loading,
  waiting,
  loadingMore,
  onEndReached,
  startIndex,
  action,
  rowRef,
  children,
}: {
  id?: string;
  title?: React.ReactNode;
  /** Shown as it is in place of a title. */
  header?: React.ReactNode;
  shape: RowShape;
  /** Replaces the shape's card width, for rows of something else. */
  itemClass?: string;
  loading?: boolean;
  /** Not fetching yet, out of sight, so one still placeholder holds its place. */
  waiting?: boolean;
  loadingMore?: boolean;
  onEndReached?: () => void;
  /** Read once, so the row stays put as its items change. */
  startIndex?: number;
  action?: React.ReactNode;
  rowRef?: React.Ref<HTMLElement>;
  children?: React.ReactNode;
}) {
  const restoreKey = useEntryKey(id);
  const [start] = React.useState(startIndex ?? 0);
  const [lines] = useSetting(settings.interface.posterLines);
  const width = itemClass ?? ITEM_WIDTH[shape];
  const items = React.Children.toArray(children);
  const { drawn, fades, onView } = useWindow(items.length, start, !!loading);
  // A finger scrolls a plain scroller on the compositor; Embla is for a mouse to drag.
  const touch = useMediaQuery('(pointer: coarse)');
  if (!loading && !items.length) return null;
  const native = !!currentHost().tv || touch;
  const skeletons = (count: number) =>
    Array.from({ length: count }, (_, i) => (
      <Slide key={`skeleton-${i}`} className={width}>
        <Skeleton
          className={cn(
            'h-auto w-full rounded-xl',
            SKELETON_SHAPE[shape],
            waiting && 'animate-none'
          )}
        />
      </Slide>
    ));
  const cards = [
    ...(loading
      ? skeletons(waiting ? 1 : 8)
      : items.map((child, i) =>
          drawn(i) ? (
            <Slide key={i} className={width}>
              <div {...(fades(i) ? fadeIn(i) : {})}>{child}</div>
            </Slide>
          ) : (
            <Slide key={i} className={width} />
          )
        )),
    ...(!loading && loadingMore ? skeletons(4) : []),
  ];
  const head = (
    <div className="-me-4 flex items-center justify-between gap-3 pe-4 lg:-me-10">
      {title ? (
        <h2
          data-ui="media-row-title"
          data-nav-tv="skip"
          // Room inside the truncating box for a link's focus outline.
          className="-m-1 min-w-0 truncate p-1 text-lg font-semibold sm:text-xl"
        >
          {title}
        </h2>
      ) : (
        <div data-nav-tv="skip" className="min-w-0">
          {header}
        </div>
      )}
      <div className="flex flex-none items-center gap-2">
        {action && (
          <div data-ui="media-row-action" className="flex">
            {action}
          </div>
        )}
        {!native && <RowNav />}
      </div>
    </div>
  );
  return (
    <section
      ref={rowRef}
      data-ui="media-row"
      data-row={id}
      data-shape={shape}
      data-nav-group
      data-nav-box
      style={{ '--poster-text': posterText(lines) } as React.CSSProperties}
    >
      {native ? (
        <>
          {head}
          <NativeRow
            restoreKey={restoreKey}
            start={start}
            onEnd={onEndReached}
            onView={onView}
            count={cards.length}
          >
            {cards}
          </NativeRow>
        </>
      ) : (
        <Carousel
          opts={{ align: 'start', dragFree: true, startIndex: start }}
          restoreKey={restoreKey}
        >
          {onEndReached && <EndWatcher onEnd={onEndReached} />}
          {onView && <ViewWatcher onView={onView} />}
          {head}
          {/* Embla counts the last card's margin as the row's end gap. */}
          <CarouselContent
            contentClass="-me-4 lg:-me-10"
            className="mt-3 [&>*:last-child]:me-4"
          >
            {cards}
          </CarouselContent>
        </Carousel>
      )}
    </section>
  );
}

const GRID_COLUMNS: Record<PosterSize, { poster: string; wide: string }> = {
  small: {
    poster:
      'grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-9 2xl:grid-cols-12',
    wide: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6',
  },
  medium: {
    poster:
      'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-10',
    wide: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5',
  },
  large: {
    poster:
      'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8',
    wide: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
  },
};

export function CardGrid({
  shape = 'poster',
  children,
}: {
  shape?: RowShape;
  children: React.ReactNode;
}) {
  const [size] = useSetting(settings.interface.posterSize);
  const grid = React.useRef<HTMLDivElement>(null);
  // Half a screen past each edge, so the next row down is still weighed.
  useMarkOutOfView(
    grid,
    React.Children.count(children),
    React.useContext(ScrollRoot),
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a root margin
    '50% 0px'
  );
  return (
    <div
      ref={grid}
      data-ui="card-grid"
      data-shape={shape}
      data-size={size}
      data-nav-group
      data-nav-wrap
      className={cn(
        'grid gap-4',
        shape === 'wide' ? GRID_COLUMNS[size].wide : GRID_COLUMNS[size].poster
      )}
    >
      {children}
    </div>
  );
}
