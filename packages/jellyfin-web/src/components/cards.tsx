import React from 'react';
import { BiCheck, BiPlay } from 'react-icons/bi';
import { cn } from '@aiostreams/ui/core/styling';
import { useHold } from '../lib/use-hold';
import { useInView } from '../lib/use-in-view';
import { canShrink, shrinkArtwork } from '../lib/artwork';
import { settings, useSetting } from '../lib/settings';

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
  // Tied to the list and the source rather than reset by an effect, which a
  // cached image can finish loading before.
  const [failed, setFailed] = React.useState({ key: '', count: 0 });
  const attempt = failed.key === key ? failed.count : 0;
  const [loadedSrc, setLoadedSrc] = React.useState<string | null>(null);
  const [plain, setPlain] = React.useState<string | null>(null);
  const current = sources[attempt];
  const loaded = !!current && loadedSrc === current;
  const imageClass = cn(
    'absolute inset-0 h-full w-full object-cover transition-[transform,opacity] duration-500',
    loaded ? 'opacity-100' : 'opacity-0',
    className
  );
  // Laid out empty first when the URL waits on the drawn width.
  if (resolved === undefined)
    return <div ref={measure} className={imageClass} />;
  const borrowed = attempt >= (own ?? sources.length) ? standIn : null;
  if (!current) {
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
          alt={alt}
          className={imageClass}
          size={box?.device}
          measure={measure}
          onLoad={() => setLoadedSrc(current)}
          onPlain={() => setPlain(current)}
        />
      ) : (
        <img
          ref={measure}
          data-ui="artwork"
          src={current}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedSrc(current)}
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

/** `src` drawn at the canvas's device size, or handed back for a plain image. */
function ShrunkImage({
  src,
  alt,
  className,
  size,
  measure,
  onLoad,
  onPlain,
}: {
  src: string;
  alt: string;
  className: string;
  size: { width: number; height: number } | undefined;
  measure: (el: Element | null) => void;
  onLoad: () => void;
  onPlain: () => void;
}) {
  const [visible, setVisible] = React.useState(false);
  const view = useInView<HTMLCanvasElement>(() => setVisible(true), '300px');
  const ref = React.useCallback(
    (el: HTMLCanvasElement | null) => {
      view.current = el;
      measure(el);
    },
    [view, measure]
  );
  const done = React.useRef({ onLoad, onPlain });
  done.current = { onLoad, onPlain };

  React.useEffect(() => {
    if (!visible || !size) return;
    const job = shrinkArtwork(src, size.width, size.height);
    void job.promise.then((result) => {
      if (!('bitmap' in result)) return done.current.onPlain();
      const el = view.current;
      if (el) {
        el.width = result.bitmap.width;
        el.height = result.bitmap.height;
        // A CPU-backed canvas paints with the page instead of becoming a layer.
        el.getContext('2d', { willReadFrequently: true })?.drawImage(
          result.bitmap,
          0,
          0
        );
        done.current.onLoad();
      }
      result.bitmap.close();
    });
    return job.cancel;
  }, [visible, size, src, view]);

  return (
    <canvas
      ref={ref}
      data-ui="artwork"
      role="img"
      aria-label={alt || undefined}
      aria-hidden={!alt || undefined}
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
    <a
      data-ui="poster-card"
      data-shape={shape}
      data-watched={watched || undefined}
      data-in-progress={(!!progress && progress > 0) || undefined}
      href={href}
      title={showTitle ? undefined : title}
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
          className="group-hover/poster:scale-[1.04]"
        />
        <div
          data-ui="poster-card-shade"
          className="absolute inset-0 bg-black/0 transition-colors group-hover/poster:bg-black/20"
        />
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
    </a>
  );
}

export interface WideCardProps {
  href?: string;
  onClick?: () => void;
  /** A mouse press held down; touch keeps its long press for the item menu. */
  onHold?: () => void;
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
    onHold,
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
  const hold = useHold(onHold, { touch: false });
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
            'group-hover/wide:scale-[1.03]',
            dimmed && 'opacity-40 grayscale'
          )}
        />
        {!unavailable && (
          <div
            data-ui="wide-card-play"
            className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/wide:bg-black/30"
          >
            <BiPlay className="text-5xl text-white opacity-0 drop-shadow transition-opacity group-hover/wide:opacity-90" />
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
        <a href={href} className="block space-y-2">
          {body}
        </a>
      ) : onClick ? (
        <button
          type="button"
          onClick={onClick}
          {...hold}
          className="block w-full space-y-2 text-left"
        >
          {body}
        </button>
      ) : (
        <div className="space-y-2">{body}</div>
      )}
    </div>
  );
}
