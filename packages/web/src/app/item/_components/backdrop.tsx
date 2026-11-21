import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { BackdropFrame } from '@/components/media/hero';
import { useTrailersOn } from '@/features/trailers/preview';
import { CachedImage } from '@/components/cached-image';

/** Art that arrives within this was never seen missing, so it just appears. */
const UNSEEN_MS = 250;

/** Past the landscape art, the poster stands in as a blurred wash of its colours. */
export function Backdrop({
  images,
  poster,
  trailer,
  video,
  band,
  onBare,
  onShown,
}: {
  images: string[];
  poster: string | null;
  /** A trailer plays in its place, behind the whole page. */
  trailer?: boolean;
  video?: string;
  /** As tall as Home's hero. */
  band?: boolean;
  /** Everything it was given has failed to load. */
  onBare?: () => void;
  /** The picture it settled on, which it keeps as the title's details come. */
  onShown?: (src: string) => void;
}) {
  const playable = useTrailersOn('item');
  const [playing, setPlaying] = React.useState<string>();
  const [videoFailed, setVideoFailed] = React.useState<string>();
  const usable = video !== videoFailed ? video : undefined;
  const sources = poster ? [...images, poster] : images;
  const key = sources.join('|');
  // Tied to the sources, not reset by an effect, which a cached image can load before.
  const [failed, setFailed] = React.useState({ key: '', count: 0 });
  const attempt = failed.key === key ? failed.count : 0;
  const [opened] = React.useState(() => performance.now());
  const [arrived, setArrived] = React.useState<{
    src: string;
    late: boolean;
  } | null>(null);
  const src = sources[attempt];
  const loaded = !!src && arrived?.src === src;
  const wash = attempt >= images.length;
  // Shown before the first frame when another image already holds it in memory.
  const held = React.useCallback(
    (el: HTMLImageElement | null) => {
      if (src && el?.complete && el.naturalWidth)
        setArrived({ src, late: false });
    },
    [src]
  );
  const image = src && (
    <CachedImage
      key={src}
      ref={held}
      data-ui="item-backdrop-image"
      data-wash={wash || undefined}
      src={src}
      alt=""
      // Decoded first, as a large image would otherwise appear a moment after it's shown.
      onLoad={(e) => {
        const el = e.currentTarget;
        void el
          .decode()
          .catch(() => undefined)
          .then(() => {
            // One replaced while it decoded is gone, and isn't what it shows.
            if (!el.isConnected) return;
            if (!wash) onShown?.(src);
            setArrived((was) =>
              was?.src === src
                ? was
                : { src, late: performance.now() - opened > UNSEEN_MS }
            );
          });
      }}
      onError={() =>
        setFailed((f) => ({
          key,
          count: (f.key === key ? f.count : 0) + 1,
        }))
      }
      className={cn(
        'absolute inset-0 h-full w-full object-cover',
        loaded && arrived.late && 'transition-opacity duration-700',
        wash ? 'scale-125 blur-3xl saturate-150' : 'object-top',
        !loaded ? 'opacity-0' : wash ? 'opacity-50' : 'opacity-100'
      )}
    />
  );
  const moving = usable && playable && (
    <video
      key={usable}
      data-ui="item-backdrop-video"
      src={usable}
      autoPlay
      muted
      loop
      playsInline
      onPlaying={() => setPlaying(usable)}
      onError={() => setVideoFailed(usable)}
      className={cn(
        'absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-700',
        playing === usable ? 'opacity-100' : 'opacity-0'
      )}
    />
  );
  const bare = !src && !usable;
  React.useEffect(() => {
    if (bare) onBare?.();
  }, [bare, onBare]);
  return (
    <div
      aria-hidden
      data-ui="item-backdrop"
      data-band={band || undefined}
      // Fades out at its edge, where some GPUs draw the art's last row past the shade.
      className={cn(
        'pointer-events-none absolute inset-x-0 top-[calc(var(--top-bar,0px)*-1)] h-[calc(55vh+var(--top-bar,0px))] overflow-hidden transition-opacity duration-500 [mask-image:linear-gradient(to_top,transparent,black_2px)]',
        band
          ? 'landscape:h-[calc(min(85vh,var(--hero-height))+var(--top-bar,0px))] lg:h-[calc(min(85vh,var(--hero-height))+var(--top-bar,0px))]'
          : 'landscape:h-[calc(85vh+var(--top-bar,0px))] lg:h-[calc(85vh+var(--top-bar,0px))]',
        trailer && 'opacity-0'
      )}
    >
      {wash && !moving ? (
        image
      ) : (
        <BackdropFrame
          className={
            band
              ? 'max-w-[calc(55vh*2.6)] landscape:max-w-[calc(min(85vh,var(--hero-height))*2.6)] lg:max-w-[calc(min(85vh,var(--hero-height))*2.6)]'
              : 'max-w-[calc(55vh*2.6)] landscape:max-w-[calc(85vh*2.6)] lg:max-w-[calc(85vh*2.6)]'
          }
        >
          {!wash && image}
          {moving}
        </BackdropFrame>
      )}
      <div
        data-ui="item-backdrop-shade"
        data-name="side"
        className="absolute inset-0 hidden bg-gradient-to-r from-[--background] to-transparent landscape:block lg:block rtl:bg-gradient-to-l"
      />
      <div
        data-ui="item-backdrop-shade"
        data-name="bottom"
        className="absolute inset-x-0 bottom-0 h-3/4 bg-[--background] [mask-image:linear-gradient(to_top,black,rgb(0_0_0/0.7),transparent)] max-sm:h-1/2"
      />
    </div>
  );
}
