import React from 'react';
import { BiCheck } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  useCarousel,
} from '@aiostreams/ui/carousel';
import { cn } from '@aiostreams/ui/core/styling';
import { currentHost } from '../lib/hosts';
import { scrolled, scrollToStart, startOf } from '../lib/direction';
import type { BaseItemDto } from '../lib/types';
import { ItemMenu } from './item-menu';

export function SeasonPills({
  seasons,
  selected,
  onSelect,
}: {
  seasons: BaseItemDto[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  const pills = seasons.map((s) => (
    <ItemMenu key={s.Id} item={s} onPage>
      <Button
        data-ui="season-pill"
        data-selected={s.Id === selected || undefined}
        size="sm"
        intent={s.Id === selected ? 'white' : 'gray-subtle'}
        className="rounded-full"
        rightIcon={s.UserData?.Played ? <BiCheck /> : undefined}
        iconSpacing="0.25rem"
        onClick={() => onSelect(s.Id!)}
      >
        {s.Name}
      </Button>
    </ItemMenu>
  ));
  // Embla watches its slides with an intersection observer (see lib/use-in-view.ts).
  if (currentHost().tv) return <TvPills selected={selected}>{pills}</TvPills>;
  return (
    <Carousel
      data-ui="season-pills"
      gap="sm"
      opts={{ align: 'start', dragFree: true, slidesToScroll: 'auto' }}
      className="flex items-center gap-2"
    >
      <PillArrow
        arrow="prev"
        follow={seasons.findIndex((s) => s.Id === selected)}
      />
      <PillTrack>
        {pills.map((pill) => (
          <CarouselItem key={pill.key} className="basis-auto">
            {pill}
          </CarouselItem>
        ))}
      </PillTrack>
      <PillArrow arrow="next" />
    </Carousel>
  );
}

/** Starts scrolled to the selected pill. */
function TvPills({
  selected,
  children,
}: {
  selected: string | undefined;
  children: React.ReactNode;
}) {
  const track = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const el = track.current;
    const pill = el?.querySelector<HTMLElement>('[data-selected]');
    if (!el || !pill) return;
    const at = startOf(pill, el);
    if (
      at < scrolled(el) ||
      at + pill.offsetWidth > scrolled(el) + el.clientWidth
    )
      scrollToStart(el, at);
  }, [selected]);
  return (
    <div
      ref={track}
      data-ui="season-pills"
      // Room for a focused pill's ring, which the scroller would clip.
      className="relative -m-1 flex gap-2 overflow-x-auto p-1"
    >
      {children}
    </div>
  );
}

/** `follow` scrolls that pill into view when it is out of it. */
function PillArrow({
  arrow,
  follow,
}: {
  arrow: 'prev' | 'next';
  follow?: number;
}) {
  const { api, canScrollPrev, canScrollNext } = useCarousel();
  React.useEffect(() => {
    if (!api || follow == null || follow < 0) return;
    const node = api.slideNodes()[follow];
    if (!node) return;
    const root = api.rootNode().getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    if (rect.left < root.left || rect.right > root.right) {
      api.scrollTo(Math.min(follow, api.scrollSnapList().length - 1));
    }
  }, [api, follow]);
  if (!canScrollPrev && !canScrollNext) return null;
  const Arrow = arrow === 'prev' ? CarouselPrevious : CarouselNext;
  return (
    <Arrow className="hidden flex-none disabled:opacity-30 md:inline-flex" />
  );
}

function PillTrack({ children }: { children: React.ReactNode }) {
  const { canScrollPrev, canScrollNext } = useCarousel();
  return (
    <CarouselContent
      contentClass={cn(
        'min-w-0 flex-1',
        canScrollPrev && canScrollNext
          ? '[mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%-2.5rem),transparent)]'
          : canScrollPrev
            ? '[mask-image:linear-gradient(to_right,transparent,black_2.5rem)] rtl:[mask-image:linear-gradient(to_left,transparent,black_2.5rem)]'
            : canScrollNext &&
              '[mask-image:linear-gradient(to_left,transparent,black_2.5rem)] rtl:[mask-image:linear-gradient(to_right,transparent,black_2.5rem)]'
      )}
    >
      {children}
    </CarouselContent>
  );
}
