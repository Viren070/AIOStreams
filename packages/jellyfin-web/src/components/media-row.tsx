import React from 'react';
import { motion } from 'motion/react';
import { useRouter } from '@tanstack/react-router';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  useCarousel,
} from '@aiostreams/ui/carousel';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { cn } from '@aiostreams/ui/core/styling';
import { usePosterSize, type PosterSize } from '../lib/settings';

const ITEM_WIDTH = {
  poster:
    'basis-[9rem] sm:basis-[10.5rem] lg:basis-[11.5rem] 2xl:basis-[12.5rem]',
  square: 'basis-[10rem] sm:basis-[11.5rem] lg:basis-[12.5rem]',
  wide: 'basis-[16rem] sm:basis-[18rem] lg:basis-[20rem] 2xl:basis-[22rem]',
};

const SKELETON_SHAPE = {
  poster: 'aspect-[2/3]',
  square: 'aspect-square',
  wide: 'aspect-video',
};

export type RowShape = keyof typeof ITEM_WIDTH;

/** Cards fade in a little after one another, a page at a time. */
export function fadeIn(index: number) {
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, delay: (index % 20) * 0.025 },
  };
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

/** The row's arrows, only while there is somewhere to scroll. */
function RowNav() {
  const { canScrollPrev, canScrollNext } = useCarousel();
  if (!canScrollPrev && !canScrollNext) return null;
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

/** A titled, draggable row of cards that pages as it nears its end. */
export function MediaRow({
  id,
  title,
  header,
  shape,
  itemClass,
  loading,
  loadingMore,
  onEndReached,
  startIndex,
  action,
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
  loadingMore?: boolean;
  onEndReached?: () => void;
  /** Read once, so the row stays put as its items change. */
  startIndex?: number;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const restoreKey = useEntryKey(id);
  const [start] = React.useState(startIndex ?? 0);
  const width = itemClass ?? ITEM_WIDTH[shape];
  const items = React.Children.toArray(children);
  if (!loading && !items.length) return null;
  const skeletons = (count: number) =>
    Array.from({ length: count }, (_, i) => (
      <CarouselItem key={`skeleton-${i}`} className={width}>
        <Skeleton
          className={cn('h-auto w-full rounded-xl', SKELETON_SHAPE[shape])}
        />
      </CarouselItem>
    ));
  return (
    <section data-ui="media-row" data-row={id}>
      <Carousel
        opts={{ align: 'start', dragFree: true, startIndex: start }}
        restoreKey={restoreKey}
      >
        {onEndReached && <EndWatcher onEnd={onEndReached} />}
        <div className="-mr-4 flex items-center justify-between gap-3 pr-4 lg:-mr-10">
          {title ? (
            <h2
              data-ui="media-row-title"
              className="min-w-0 truncate text-lg font-semibold sm:text-xl"
            >
              {title}
            </h2>
          ) : (
            <div className="min-w-0">{header}</div>
          )}
          <div className="flex flex-none items-center gap-2">
            {action}
            <RowNav />
          </div>
        </div>
        {/* Embla counts the last card's margin as the row's end gap. */}
        <CarouselContent
          contentClass="-mr-4 lg:-mr-10"
          className="mt-3 [&>*:last-child]:mr-4"
        >
          {loading
            ? skeletons(8)
            : items.map((child, i) => (
                <CarouselItem key={i} className={width}>
                  <motion.div {...fadeIn(i)}>{child}</motion.div>
                </CarouselItem>
              ))}
          {!loading && loadingMore && skeletons(4)}
        </CarouselContent>
      </Carousel>
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
  const [size] = usePosterSize();
  return (
    <div
      data-ui="card-grid"
      className={cn(
        'grid gap-4',
        shape === 'wide' ? GRID_COLUMNS[size].wide : GRID_COLUMNS[size].poster
      )}
    >
      {children}
    </div>
  );
}
