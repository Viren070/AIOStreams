import React from 'react';
import { motion } from 'motion/react';
import { BiCheck, BiPlay } from 'react-icons/bi';
import { cn } from '@aiostreams/ui/core/styling';
import { useNear } from '../lib/use-in-view';
import {
  artworkKey,
  canShrink,
  drawnArtwork,
  holdArtwork,
  onDrawn,
  shrinkArtwork,
} from '../lib/artwork';
import { settings, useSetting } from '../lib/settings';
import { CachedImage } from './cached-image';
import { Anchor } from './anchor';

type Sources = string | string[] | null;

/** URLs, or a function giving them for the CSS width the image is drawn at. */
export type ArtworkSource = Sources | ((width: number) => Sources);

interface Box {
  /** CSS pixels, only ever growing, so a smaller layout keeps what it loaded. */
  width: number;
  device: { width: number; height: number };
}

function deviceSize(entry: ResizeObserverEntry) {
  const box = entry.devicePixelContentBoxSize?.[0];
  return box
    ? { width: box.inlineSize, height: box.blockSize }
    : {
        width: Math.round(entry.contentRect.width * devicePixelRatio),
        height: Math.round(entry.contentRect.height * devicePixelRatio),
      };
}

const near = (a: number, b: number) => Math.abs(a - b) <= a * 0.1;

/** The drawn size of whichever element the returned ref is on. */
function useBox() {
  const [box, setBox] = React.useState<Box>();
  const observer = React.useRef<ResizeObserver | null>(null);
  React.useEffect(() => () => observer.current?.disconnect(), []);
  const measure = React.useCallback((el: Element | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const next = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const device = deviceSize(entry);
      if (!width || !device.width || !device.height) return;
      setBox((prev) => {
        if (!prev) return { width, device };
        // Small changes are left to CSS scaling rather than redrawn.
        const same =
          near(prev.device.width, device.width) &&
          near(prev.device.height, device.height);
        if (width <= prev.width && same) return prev;
        return {
          width: Math.max(width, prev.width),
          device: same ? prev.device : device,
        };
      });
    });
    try {
      next.observe(el, { box: 'device-pixel-content-box' });
    } catch {
      next.observe(el);
    }
    observer.current = next;
  }, []);
  return [box, measure] as const;
}

function decoded(src: string): Promise<void> {
  const image = new Image();
  image.src = src;
  return image.decode();
}

const firstOf = (sources: Sources) =>
  (Array.isArray(sources) ? sources[0] : sources) ?? undefined;

/** A list is tried in order, moving on when an image fails to load. */
export function Artwork({
  src,
  alt,
  className,
  own,
  standIn,
}: {
  src: ArtworkSource;
  alt: string;
  className?: string;
  /** How many leading sources are the item's own, `standIn` covering the rest. */
  own?: number;
  standIn?: React.ReactNode;
}) {
  const [box, measure] = useBox();
  const resolved =
    typeof src === 'function' ? (box ? src(box.width) : undefined) : src;
  const sources = Array.isArray(resolved)
    ? resolved
    : resolved
      ? [resolved]
      : [];
  const key = sources.join('|');
  // What an earlier card drew of the image, shown before this one is measured,
  // so a page built again shows its artwork at once.
  const [early] = React.useState(() => {
    const first = firstOf(typeof src === 'function' ? src(1) : src);
    const kept = first ? drawnArtwork(first) : undefined;
    return kept && first ? { key: artworkKey(first), src: kept.src } : null;
  });
  // Tied to the list and the source rather than reset by an effect, which a
  // cached image can finish loading before.
  const [failed, setFailed] = React.useState({ key: '', count: 0 });
  const attempt = failed.key === key ? failed.count : 0;
  const [loadedKey, setLoadedKey] = React.useState(early?.key ?? null);
  const [plain, setPlain] = React.useState<string | null>(null);
  const current = sources[attempt];
  const currentKey = current && artworkKey(current);
  const loaded = currentKey ? loadedKey === currentKey : !!early;
  const imageClass = cn(
    // A focus's scale keeps up with focus; a loaded image fades in slower.
    'absolute inset-0 h-full w-full object-cover transition-[transform,opacity] [transition-duration:250ms,500ms]',
    loaded ? 'opacity-100' : 'opacity-0',
    className
  );
  // Laid out empty first when the URL waits on the drawn width.
  if (resolved === undefined && !early)
    return <div ref={measure} className={imageClass} />;
  const borrowed = attempt >= (own ?? sources.length) ? standIn : null;
  if (resolved !== undefined && !current) {
    if (borrowed) return borrowed;
    return (
      <div
        data-ui="artwork-fallback"
        className={cn(
          'absolute inset-0 flex items-end bg-gray-900 p-3 text-sm text-[--muted]',
          className
        )}
      >
        <span className="line-clamp-3">{alt}</span>
      </div>
    );
  }
  return (
    <>
      {canShrink && plain !== current ? (
        <ShrunkImage
          src={current}
          early={early?.src}
          alt={alt}
          className={imageClass}
          size={box?.device}
          measure={measure}
          onLoad={() => currentKey && setLoadedKey(currentKey)}
          onPlain={() => setPlain(current ?? null)}
        />
      ) : (
        <CachedImage
          ref={measure}
          data-ui="artwork"
          src={current}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => currentKey && setLoadedKey(currentKey)}
          onError={() =>
            setFailed((f) => ({
              key,
              count: (f.key === key ? f.count : 0) + 1,
            }))
          }
          className={imageClass}
        />
      )}
      {borrowed}
    </>
  );
}

/**
 * `src` read in a worker: shown as it is when near the box's device size, else
 * drawn shrunk to it, or handed back for a plain image.
 */
function ShrunkImage({
  src,
  early,
  alt,
  className,
  size,
  measure,
  onLoad,
  onPlain,
}: {
  src: string | undefined;
  /** An earlier card's copy, shown until this one's arrives. */
  early?: string;
  alt: string;
  className: string;
  size: { width: number; height: number } | undefined;
  measure: (el: Element | null) => void;
  onLoad: () => void;
  onPlain: () => void;
}) {
  const [view, visible, sight] = useNear<HTMLElement>('300px');
  const canvas = React.useRef<HTMLCanvasElement | null>(null);
  const ref = React.useCallback(
    (el: HTMLElement | null) => {
      view.current = el;
      canvas.current = el instanceof HTMLCanvasElement ? el : null;
      measure(el);
    },
    [view, measure]
  );
  const [shown, setShown] = React.useState(early);
  const [bitmap, setBitmap] = React.useState<ImageBitmap | null>(null);
  React.useEffect(() => (shown ? holdArtwork(shown) : undefined), [shown]);
  const done = React.useRef({ onLoad, onPlain });
  done.current = { onLoad, onPlain };

  React.useEffect(() => {
    if (!src || !visible || !size) return;
    let live = true;
    const job = shrinkArtwork(src, size.width, size.height, !sight);
    void job.promise.then((result) => {
      if ('bitmap' in result) return setBitmap(result.bitmap);
      if (!('src' in result)) return done.current.onPlain();
      // Decoded first, so it shows whole, and in one render with its loading.
      decoded(result.src).then(
        () => {
          if (!live) return;
          setShown(result.src);
          done.current.onLoad();
        },
        () => live && done.current.onPlain()
      );
    });
    return () => {
      live = false;
      job.cancel();
    };
  }, [visible, sight, size, src]);

  // A canvas holds its pixels for good, so it gives way to the image's small
  // copy once the worker has made one.
  React.useEffect(() => {
    if (!src || !bitmap) return;
    let live = true;
    const stop = onDrawn(src, (copy) => {
      void decoded(copy).then(
        () => {
          if (!live) return;
          setShown(copy);
          setBitmap(null);
        },
        () => undefined
      );
    });
    return () => {
      live = false;
      stop();
    };
  }, [src, bitmap]);

  React.useLayoutEffect(() => {
    const el = canvas.current;
    if (!bitmap || !el) return;
    el.width = bitmap.width;
    el.height = bitmap.height;
    // A CPU-backed canvas paints with the page instead of becoming a layer.
    el.getContext('2d', { willReadFrequently: true })?.drawImage(bitmap, 0, 0);
    bitmap.close();
    done.current.onLoad();
  }, [bitmap]);

  return bitmap ? (
    <canvas
      ref={ref}
      data-ui="artwork"
      role="img"
      aria-label={alt || undefined}
      aria-hidden={!alt || undefined}
      className={className}
    />
  ) : (
    <img
      ref={ref}
      data-ui="artwork"
      src={shown}
      alt={alt}
      decoding="async"
      draggable={false}
      // Without a source an image would show its alt text while looking.
      style={shown ? undefined : { visibility: 'hidden' }}
      className={className}
    />
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      data-ui="progress-bar"
      className="absolute inset-x-0 bottom-0 h-1 bg-black/60"
    >
      <div
        data-ui="progress-bar-fill"
        className="h-full bg-brand-500"
        style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
      />
    </div>
  );
}

/** Laid over the artwork, which would cover a ring drawn on its frame. */
export function FocusRing({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      data-ui="focus-ring"
      className={cn(
        'pointer-events-none absolute inset-0 z-[1] rounded-[inherit] opacity-0 ring-2 ring-inset ring-[--ring]',
        // Seen from across a room.
        '[[data-tv]_&]:ring-[3px]',
        className
      )}
    />
  );
}

/** Points out the item a page opened on with a ring that blinks, then fades. */
export function OpenedPulse() {
  return (
    <motion.span
      aria-hidden
      data-ui="opened-pulse"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0.3, 1, 0] }}
      transition={{ duration: 2, delay: 0.3, times: [0, 0.15, 0.35, 0.55, 1] }}
      className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit] ring-2 ring-inset ring-[--ring]"
    />
  );
}

function WatchedMark() {
  return (
    <span
      data-ui="watched-badge"
      className="absolute right-2 top-2 z-[2] flex size-6 items-center justify-center rounded-full bg-brand-500 text-white shadow"
    >
      <BiCheck className="text-lg" />
    </span>
  );
}

export type CardShape = 'poster' | 'landscape' | 'square';

const SHAPE_CLASS: Record<CardShape, string> = {
  poster: 'aspect-[2/3]',
  landscape: 'aspect-video',
  square: 'aspect-square',
};

export interface PosterCardProps {
  href: string;
  shape?: CardShape;
  image: ArtworkSource;
  title: string;
  subtitle?: string;
  watched?: boolean;
  /** Episodes left to watch, for a show. */
  unwatched?: number;
  progress?: number | null;
  className?: string;
}

export function PosterCard(props: PosterCardProps) {
  const { href, image, title, subtitle, watched, unwatched, progress } = props;
  const shape = props.shape ?? 'poster';
  const [lines] = useSetting(settings.posterLines);
  const showTitle = lines.includes('title');
  const showSubtitle = !!subtitle && lines.includes('year');
  return (
    <Anchor
      data-ui="poster-card"
      data-shape={shape}
      data-watched={watched || undefined}
      data-in-progress={(!!progress && progress > 0) || undefined}
      href={href}
      title={showTitle ? undefined : title}
      data-focus="own"
      className={cn('group/poster block space-y-2', props.className)}
    >
      <div
        data-ui="poster-card-image"
        className={cn(
          'relative w-full overflow-hidden rounded-lg bg-gray-900 ring-1 ring-white/5',
          SHAPE_CLASS[shape]
        )}
      >
        <Artwork
          src={image}
          alt={title}
          className="group-hover/poster:scale-[1.04] group-focus-visible/poster:scale-[1.04]"
        />
        <div
          data-ui="poster-card-shade"
          className="absolute inset-0 bg-black/20 opacity-0 transition-opacity [transition-duration:250ms] group-hover/poster:opacity-100 group-focus-visible/poster:opacity-100"
        />
        <FocusRing className="group-focus-visible/poster:opacity-100" />
        {watched && <WatchedMark />}
        {!watched && !!unwatched && (
          <span
            data-ui="unwatched-count"
            className="absolute right-2 top-2 z-[2] rounded-full bg-brand-500 px-2 py-0.5 text-xs font-semibold text-white shadow"
          >
            {unwatched}
          </span>
        )}
        {progress != null && progress > 0 && <ProgressBar percent={progress} />}
      </div>
      {(showTitle || showSubtitle) && (
        <div data-ui="poster-card-text" className="min-w-0 px-0.5">
          {showTitle && (
            <p
              data-ui="poster-card-title"
              className="truncate text-sm font-medium"
              title={title}
            >
              {title}
            </p>
          )}
          {showSubtitle && (
            <p
              data-ui="poster-card-subtitle"
              className="truncate text-xs text-[--muted]"
            >
              {subtitle}
            </p>
          )}
        </div>
      )}
    </Anchor>
  );
}

export interface WideCardProps {
  href?: string;
  onClick?: () => void;
  image: ArtworkSource;
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  watched?: boolean;
  progress?: number | null;
  /** Rings the card, for the item a page was opened on. */
  highlighted?: boolean;
  /** No play hint, for what cannot play yet. */
  unavailable?: boolean;
  /** Greyed out, to set it apart from playable neighbours. */
  dimmed?: boolean;
  /** Shown over the image's top left corner. */
  badge?: React.ReactNode;
  className?: string;
}

/** A landscape card for an episode, a resume point or a live playback. */
export function WideCard(props: WideCardProps) {
  const {
    href,
    onClick,
    image,
    title,
    subtitle,
    meta,
    watched,
    progress,
    highlighted,
    unavailable,
    dimmed,
    badge,
  } = props;
  const body = (
    <>
      <div
        data-ui="wide-card-image"
        className={cn(
          'relative aspect-video w-full overflow-hidden rounded-xl bg-gray-900 ring-1 ring-white/5',
          highlighted && 'ring-2 ring-brand-400'
        )}
      >
        <Artwork
          src={image}
          alt={title}
          className={cn(
            'group-hover/wide:scale-[1.03] group-focus-visible/wide-link:scale-[1.03]',
            dimmed && 'opacity-40 grayscale'
          )}
        />
        {!unavailable && (
          <div
            data-ui="wide-card-play"
            className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity [transition-duration:250ms] group-hover/wide:opacity-100 group-focus-visible/wide-link:opacity-100"
          >
            <BiPlay className="text-5xl text-white opacity-90 drop-shadow" />
          </div>
        )}
        {badge && (
          <div
            data-ui="wide-card-badge"
            className="absolute left-2 top-2 z-[2]"
          >
            {badge}
          </div>
        )}
        {watched && <WatchedMark />}
        {progress != null && progress > 0 && <ProgressBar percent={progress} />}
        <FocusRing className="group-focus-visible/wide-link:opacity-100" />
      </div>
      <div
        data-ui="wide-card-text"
        className="flex min-w-0 items-start justify-between gap-2 px-0.5"
      >
        <div className="min-w-0">
          <p
            data-ui="wide-card-title"
            className="truncate font-semibold"
            title={title}
          >
            {title}
          </p>
          {subtitle && (
            <p
              data-ui="wide-card-subtitle"
              className="truncate text-sm text-[--muted]"
              title={subtitle}
            >
              {subtitle}
            </p>
          )}
        </div>
        {meta && (
          <div
            data-ui="wide-card-meta"
            className="flex-none pt-0.5 text-xs text-[--muted]"
          >
            {meta}
          </div>
        )}
      </div>
    </>
  );
  return (
    <div
      data-ui="wide-card"
      data-watched={watched || undefined}
      data-in-progress={(!!progress && progress > 0) || undefined}
      data-highlighted={highlighted || undefined}
      data-dimmed={dimmed || undefined}
      data-unavailable={unavailable || undefined}
      className={cn('group/wide relative space-y-2', props.className)}
    >
      {href ? (
        <Anchor
          href={href}
          data-focus="own"
          className="group/wide-link block space-y-2"
        >
          {body}
        </Anchor>
      ) : onClick ? (
        <button
          type="button"
          onClick={onClick}
          data-focus="own"
          className="group/wide-link block w-full space-y-2 text-left"
        >
          {body}
        </button>
      ) : (
        <div className="space-y-2">{body}</div>
      )}
    </div>
  );
}
