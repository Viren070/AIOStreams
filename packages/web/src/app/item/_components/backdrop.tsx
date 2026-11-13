import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { BackdropFrame } from '@/components/media/hero';
import { CachedImage } from '@/components/cached-image';

/** Art that arrives within this was never seen missing, so it just appears. */
const UNSEEN_MS = 250;

/** Past the landscape art, the poster stands in as a blurred wash of its colours. */
export function Backdrop({
  images,
  poster,
  trailer,
}: {
  images: string[];
  poster: string | null;
  /** A trailer plays in its place, behind the whole page. */
  trailer?: boolean;
}) {
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
      onLoad={(e) =>
        void e.currentTarget
          .decode()
          .catch(() => undefined)
          .then(() =>
            setArrived((was) =>
              was?.src === src
                ? was
                : { src, late: performance.now() - opened > UNSEEN_MS }
            )
          )
      }
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
  return (
    <div
      aria-hidden
      data-ui="item-backdrop"
      // Fades out at its edge, where some GPUs draw the art's last row past the shade.
      className={cn(
        'pointer-events-none absolute inset-x-0 top-[calc(var(--top-bar,0px)*-1)] h-[calc(55vh+var(--top-bar,0px))] overflow-hidden transition-opacity duration-500 [mask-image:linear-gradient(to_top,transparent,black_2px)] landscape:h-[calc(85vh+var(--top-bar,0px))] lg:h-[calc(85vh+var(--top-bar,0px))]',
        trailer && 'opacity-0'
      )}
    >
      {wash ? (
        image
      ) : (
        <BackdropFrame className="max-w-[calc(55vh*2.6)] landscape:max-w-[calc(85vh*2.6)] lg:max-w-[calc(85vh*2.6)]">
          {image}
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
