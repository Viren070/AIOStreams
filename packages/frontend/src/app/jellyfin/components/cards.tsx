import React from 'react';
import { BiCheck, BiPlay } from 'react-icons/bi';
import { cn } from '@/components/ui/core/styling';
import { usePosterLines } from '../lib/settings';

/** A list is tried in order, moving on when an image fails to load. */
export function Artwork({
  src,
  alt,
  className,
}: {
  src: string | string[] | null;
  alt: string;
  className?: string;
}) {
  const sources = Array.isArray(src) ? src : src ? [src] : [];
  const key = sources.join('|');
  const [attempt, setAttempt] = React.useState(0);
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    setAttempt(0);
    setLoaded(false);
  }, [key]);
  const current = sources[attempt];
  if (!current) {
    return (
      <div
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
    <img
      src={current}
      alt={alt}
      loading="lazy"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => setAttempt((n) => n + 1)}
      className={cn(
        'absolute inset-0 h-full w-full object-cover transition-[transform,opacity] duration-500',
        loaded ? 'opacity-100' : 'opacity-0',
        className
      )}
    />
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
      <div
        className="h-full bg-brand-500"
        style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
      />
    </div>
  );
}

function WatchedMark() {
  return (
    <span className="absolute right-2 top-2 z-[2] flex size-6 items-center justify-center rounded-full bg-brand-500 text-white shadow">
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
  image: string | string[] | null;
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
  const [lines] = usePosterLines();
  const showTitle = lines.includes('title');
  const showSubtitle = !!subtitle && lines.includes('year');
  return (
    <a
      href={href}
      title={showTitle ? undefined : title}
      className={cn('group/poster block space-y-2', props.className)}
    >
      <div
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
        <div className="absolute inset-0 bg-black/0 transition-colors group-hover/poster:bg-black/20" />
        {watched && <WatchedMark />}
        {!watched && !!unwatched && (
          <span className="absolute right-2 top-2 z-[2] rounded-full bg-brand-500 px-2 py-0.5 text-xs font-semibold text-white shadow">
            {unwatched}
          </span>
        )}
        {progress != null && progress > 0 && <ProgressBar percent={progress} />}
      </div>
      {(showTitle || showSubtitle) && (
        <div className="min-w-0 px-0.5">
          {showTitle && (
            <p className="truncate text-sm font-medium" title={title}>
              {title}
            </p>
          )}
          {showSubtitle && (
            <p className="truncate text-xs text-[--muted]">{subtitle}</p>
          )}
        </div>
      )}
    </a>
  );
}

export interface WideCardProps {
  href?: string;
  onClick?: () => void;
  image: string | string[] | null;
  title: string;
  subtitle?: string;
  /** A couple of lines under the subtitle, such as an episode's synopsis. */
  description?: string | null;
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
  /** Actions shown over the image's top right corner. */
  actions?: React.ReactNode;
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
    description,
    meta,
    watched,
    progress,
    highlighted,
    unavailable,
    dimmed,
    badge,
    actions,
  } = props;
  const body = (
    <>
      <div
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
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/wide:bg-black/30">
            <BiPlay className="text-5xl text-white opacity-0 drop-shadow transition-opacity group-hover/wide:opacity-90" />
          </div>
        )}
        {badge && <div className="absolute left-2 top-2 z-[2]">{badge}</div>}
        {watched && !actions && <WatchedMark />}
        {progress != null && progress > 0 && <ProgressBar percent={progress} />}
      </div>
      <div className="flex min-w-0 items-start justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <p className="truncate font-semibold" title={title}>
            {title}
          </p>
          {subtitle && (
            <p className="truncate text-sm text-[--muted]" title={subtitle}>
              {subtitle}
            </p>
          )}
          {description && (
            <p className="mt-1 line-clamp-2 text-xs text-[--muted]">
              {description}
            </p>
          )}
        </div>
        {meta && (
          <div className="flex-none pt-0.5 text-xs text-[--muted]">{meta}</div>
        )}
      </div>
    </>
  );
  return (
    <div className={cn('group/wide relative space-y-2', props.className)}>
      {href ? (
        <a href={href} className="block space-y-2">
          {body}
        </a>
      ) : onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="block w-full space-y-2 text-left"
        >
          {body}
        </button>
      ) : (
        <div className="space-y-2">{body}</div>
      )}
      {actions && <div className="absolute right-2 top-2 z-[3]">{actions}</div>}
    </div>
  );
}
