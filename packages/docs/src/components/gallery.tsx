'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';

export interface GallerySlide {
  src: string;
  alt: string;
  caption?: string;
  width: number;
  height: number;
}

const AUTOPLAY_MS = 5000;

/** Screenshots in a strip that snaps one at a time; each opens full size. */
export function Gallery({ slides }: { slides: GallerySlide[] }) {
  const figure = React.useRef<HTMLElement>(null);
  const track = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(0);
  const activeRef = React.useRef(0);
  activeRef.current = active;
  const held = React.useRef(false);
  const stopped = React.useRef(false);
  const stop = () => {
    stopped.current = true;
  };

  // scrollIntoView would also scroll the page, so only the strip moves.
  const go = React.useCallback((index: number) => {
    const el = track.current;
    const slide = el?.children[index] as HTMLElement | undefined;
    if (!el || !slide) return;
    el.scrollTo({
      left: slide.offsetLeft - (el.clientWidth - slide.clientWidth) / 2,
      behavior: 'smooth',
    });
  }, []);

  React.useEffect(() => {
    const el = figure.current;
    if (!el || slides.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let visible = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0.6 }
    );
    observer.observe(el);
    const timer = window.setInterval(() => {
      if (visible && !held.current && !stopped.current && !document.hidden)
        go((activeRef.current + 1) % slides.length);
    }, AUTOPLAY_MS);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [go, slides.length]);

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const middle = el.scrollLeft + el.clientWidth / 2;
    const distances = Array.from(el.children, (child) => {
      const slide = child as HTMLElement;
      return Math.abs(slide.offsetLeft + slide.clientWidth / 2 - middle);
    });
    setActive(distances.indexOf(Math.min(...distances)));
  };

  return (
    <figure
      ref={figure}
      className="not-prose my-6"
      onPointerDown={stop}
      onKeyDown={stop}
      onWheel={(e) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) stop();
      }}
      onMouseEnter={() => (held.current = true)}
      onMouseLeave={() => (held.current = false)}
      onFocus={() => (held.current = true)}
      onBlur={() => (held.current = false)}
    >
      <div
        ref={track}
        onScroll={onScroll}
        role="region"
        aria-label="Screenshots"
        tabIndex={0}
        className="relative flex snap-x snap-mandatory gap-3 overflow-x-auto px-[5%] pb-1 outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, i) => (
          <div
            key={slide.src}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${slides.length}`}
            className="w-[94%] shrink-0 snap-center"
          >
            <ImageZoom
              src={slide.src}
              alt={slide.alt}
              width={slide.width}
              height={slide.height}
              loading={i === 0 ? 'eager' : 'lazy'}
              sizes="(min-width: 1024px) 760px, 90vw"
              className="rounded-lg border border-fd-border"
            />
          </div>
        ))}
      </div>
      {/* One caption, since a neighbour's would show at the edges. */}
      <figcaption className="mt-2 min-h-5 px-[5%] text-center text-sm text-fd-muted-foreground">
        {slides[active]?.caption}
      </figcaption>
      <div className="mt-3 flex items-center justify-center gap-3">
        <button
          type="button"
          aria-label="Previous screenshot"
          disabled={active === 0}
          onClick={() => go(active - 1)}
          className="rounded-full border border-fd-border p-1.5 text-fd-muted-foreground transition-colors hover:text-fd-foreground disabled:opacity-40"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="flex items-center gap-1.5">
          {slides.map((slide, i) => (
            <button
              key={slide.src}
              type="button"
              aria-label={`Show screenshot ${i + 1}`}
              aria-current={i === active}
              onClick={() => go(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === active
                  ? 'w-5 bg-fd-primary'
                  : 'w-1.5 bg-fd-muted-foreground/40 hover:bg-fd-muted-foreground'
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Next screenshot"
          disabled={active === slides.length - 1}
          onClick={() => go(active + 1)}
          className="rounded-full border border-fd-border p-1.5 text-fd-muted-foreground transition-colors hover:text-fd-foreground disabled:opacity-40"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </figure>
  );
}
