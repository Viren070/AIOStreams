import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { settings, useSetting } from '../lib/settings';

/** Only Chromium draws an SVG filter over what's behind an element. */
export const canRefract =
  typeof CSS !== 'undefined' &&
  CSS.supports('backdrop-filter', 'url(#a)') &&
  /Chrome\//.test(navigator.userAgent);

/** How wide the bent rim is, and how far at most it moves what's behind, in CSS pixels. */
const RIM = 30;
const BEND = 45;

const maps = new Map<string, string>();

/**
 * A displacement map for a rounded box: red and green move each point of the
 * rim toward the middle, as a lens's edge bends light, and leave the middle.
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
  const rim = Math.min(RIM, width / 2, height / 2);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const qx = Math.abs(px) - (cx - r);
      const qy = Math.abs(py) - (cy - r);
      // How far in from the edge, and which way is out.
      let depth: number;
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const out = Math.hypot(qx, qy);
        depth = r - out;
        nx = qx / out;
        ny = qy / out;
      } else if (qx > qy) {
        depth = r - qx;
        nx = 1;
      } else {
        depth = r - qy;
        ny = 1;
      }
      const t = Math.min(1, Math.max(0, 1 - depth / rim));
      const bend = t * t * (3 - 2 * t) * 127;
      const i = (y * width + x) * 4;
      image.data[i] = 128 - Math.sign(px) * nx * bend;
      image.data[i + 1] = 128 - Math.sign(py) * ny * bend;
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
  const [look] = useSetting(settings.barBackground);
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
              scale={BEND * 2}
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
