import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { settings, useSetting } from '../lib/settings';

/** Only Chromium draws an SVG filter over what's behind an element. */
export const canRefract =
  typeof CSS !== 'undefined' &&
  CSS.supports('backdrop-filter', 'url(#a)') &&
  /Chrome\//.test(navigator.userAgent);

const maps = new Map<string, string>();

/** How much of its distance from the middle a point keeps in what it shows, by depth (0 at the edge, 1 at the middle). */
const pull = (depth: number) =>
  (1 - 2.3 * Math.pow(5.2 * Math.E, -6.9 * depth - 0.7)) ** 3;

/** The filter's scale, as the map's red and green span the box's longer side. */
const span = (width: number, height: number) => Math.max(width, height);

/**
 * A displacement map for a rounded box: each point shows what lies nearer the
 * middle, the more so toward the rim, as a lens does.
 */
function displacementMap(width: number, height: number, radius: number) {
  const key = `${width}x${height}/${radius}`;
  const known = maps.get(key);
  if (known) return known;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(width, height);
  const r = Math.min(radius, width / 2, height / 2);
  const cx = width / 2;
  const cy = height / 2;
  const short = Math.min(cx, cy);
  const scale = 255 / span(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const qx = Math.abs(px) - (cx - r);
      const qy = Math.abs(py) - (cy - r);
      const depth =
        qx > 0 && qy > 0 ? r - Math.hypot(qx, qy) : r - Math.max(qx, qy);
      const moved = pull(Math.max(0, depth) / short) - 1;
      const i = (y * width + x) * 4;
      image.data[i] = 127.5 + px * moved * scale;
      image.data[i + 1] = 127.5 + py * moved * scale;
      image.data[i + 2] = 128;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  maps.set(key, url);
  return url;
}

interface Size {
  width: number;
  height: number;
  radius: number;
}

/**
 * What a navigation bar sits on: the app's own background, or glass, frosted
 * or with a bending rim where set and drawable.
 */
export function BarSurface({
  className,
  style,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const [look] = useSetting(settings.interface.barBackground);
  const liquid = look === 'liquid' && canRefract;
  const ref = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState<Size>();
  // Only blurred while its size changes, as a bend drawn for one size leaves
  // the rest of another unblurred.
  const [moving, setMoving] = React.useState(false);
  const id = `lens-${React.useId().replace(/[^\w-]/g, '')}`;
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!liquid || !el) return setSize(undefined);
    const measure = () => {
      const next = {
        width: Math.round(el.offsetWidth),
        height: Math.round(el.offsetHeight),
        radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
      };
      setSize((was) =>
        was &&
        was.width === next.width &&
        was.height === next.height &&
        was.radius === next.radius
          ? was
          : next
      );
    };
    let waiting = false;
    const settle = () => {
      const running = el.getAnimations();
      if (!running.length) {
        setMoving(false);
        return measure();
      }
      setMoving(true);
      if (waiting) return;
      waiting = true;
      void Promise.allSettled(running.map((a) => a.finished)).then(() => {
        waiting = false;
        settle();
      });
    };
    measure();
    const observer = new ResizeObserver(settle);
    observer.observe(el);
    return () => observer.disconnect();
  }, [liquid]);
  const map =
    liquid && !moving && size?.width && size.height
      ? displacementMap(size.width, size.height, size.radius)
      : null;
  const glass = !!map || (liquid && moving);
  return (
    <div
      ref={ref}
      data-surface={glass ? 'liquid' : look === 'solid' ? 'solid' : 'frosted'}
      className={cn('bar-surface', className)}
      style={
        glass
          ? {
              ...style,
              // Blurred before bending: enough that text behind doesn't fight the
              // labels, and the bent rim doesn't fray into streaks.
              backdropFilter: `blur(4px)${map ? ` url(#${id})` : ''} saturate(1.8)`,
            }
          : style
      }
      {...props}
    >
      {map && size && (
        <svg aria-hidden className="pointer-events-none absolute size-0">
          <filter
            id={id}
            filterUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={size.width}
            height={size.height}
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={map}
              x="0"
              y="0"
              width={size.width}
              height={size.height}
              preserveAspectRatio="none"
              result="map"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={span(size.width, size.height)}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </svg>
      )}
      {children}
    </div>
  );
}
