import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { settings, useSetting } from '@/lib/settings';

/** Only Chromium draws an SVG filter over what's behind an element. */
export const canRefract =
  typeof CSS !== 'undefined' &&
  CSS.supports('backdrop-filter', 'url(#a)') &&
  /Chrome\//.test(navigator.userAgent);

interface Lens {
  start: string;
  end: string;
  middle: string;
  scale: number;
}

const lenses = new Map<string, Lens | null>();

/** Chromium sends a filter's images with every frame, so a lens is drawn at most this many points across. */
const SAMPLES = 64;

/** How much of its distance from the middle a point keeps, by depth into the glass (0 at the rim). */
const keepAt = (depth: number) =>
  1 - 2.3 * Math.pow(5.2 * Math.E, -6.9 * depth - 0.7);

interface Piece {
  width: number;
  height: number;
  moves: [number, number][];
}

function sample(
  width: number,
  height: number,
  move: (x: number, y: number) => [number, number]
): Piece {
  const moves: [number, number][] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) moves.push(move(x, y));
  return { width, height, moves };
}

function draw(piece: Piece, scale: number): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = piece.width;
  canvas.height = piece.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(piece.width, piece.height);
  piece.moves.forEach(([x, y], i) => {
    image.data[i * 4] = 127.5 + (x / scale) * 255;
    image.data[i * 4 + 1] = 127.5 + (y / scale) * 255;
    image.data[i * 4 + 2] = 128;
    image.data[i * 4 + 3] = 255;
  });
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/**
 * Each point of a rounded box shows what lies nearer its middle line, the
 * more so toward the rim. The halves of a square lens cap the box's ends, and
 * its middle line repeats between them.
 */
function lens(width: number, height: number, radius: number): Lens | null {
  const wide = width >= height;
  const short = Math.min(width, height);
  const half = short / 2;
  const r = Math.min(radius, half);
  const key = `${short}/${r}/${wide}`;
  if (lenses.has(key)) return lenses.get(key)!;
  const n = 2 * Math.ceil(Math.min(short, SAMPLES) / 2);
  const at = (i: number) => ((i + 0.5) * short) / n - half;
  let most = 0;
  const move = (px: number, py: number): [number, number] => {
    const qx = Math.abs(px) - (half - r);
    const qy = Math.abs(py) - (half - r);
    const inset = Math.max(
      0,
      qx > 0 && qy > 0 ? r - Math.hypot(qx, qy) : r - Math.max(qx, qy)
    );
    // A wide rim and a slightly magnified middle, so small glass still reads as a lens.
    const keep = keepAt((inset / half) * 0.6) * 0.87;
    most = Math.max(most, Math.abs(px * (1 - keep)), Math.abs(py * (1 - keep)));
    return [px * (keep - 1), py * (keep - 1)];
  };
  const pieces = wide
    ? [
        sample(n / 2, n, (x, y) => move(at(x), at(y))),
        sample(n / 2, n, (x, y) => move(at(x + n / 2), at(y))),
        sample(1, n, (_, y) => move(0, at(y))),
      ]
    : [
        sample(n, n / 2, (x, y) => move(at(x), at(y))),
        sample(n, n / 2, (x, y) => move(at(x), at(y + n / 2))),
        sample(n, 1, (x) => move(at(x), 0)),
      ];
  const scale = Math.ceil(most * 2) || 1;
  const [start, end, middle] = pieces.map((piece) => draw(piece, scale));
  const made = start && end && middle ? { start, end, middle, scale } : null;
  lenses.set(key, made);
  return made;
}

function endSize(el: HTMLElement): { width: number; height: number } | null {
  let width: number | undefined;
  let height: number | undefined;
  for (const animation of el.getAnimations()) {
    if (!(animation.effect instanceof KeyframeEffect)) continue;
    const end = animation.effect.getKeyframes().at(-1);
    if (typeof end?.width === 'string') width = parseFloat(end.width);
    if (typeof end?.height === 'string') height = parseFloat(end.height);
  }
  if (width === undefined && height === undefined) return null;
  return {
    width: Math.round(width ?? el.offsetWidth),
    height: Math.round(height ?? el.offsetHeight),
  };
}

/** The box a lens is drawn for, which it stretches from while the box resizes. */
interface Shape {
  width: number;
  height: number;
  radius: number;
}

const sameShape = (a: Shape, b: Shape) =>
  a.width === b.width && a.height === b.height && a.radius === b.radius;

/**
 * What a navigation bar sits on: the app's own background, or glass, frosted
 * or with a bending rim where set and drawable.
 */
export function GlassSurface({
  className,
  style,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const [look] = useSetting(settings.theme.glassSurface);
  const liquid = look === 'liquid' && canRefract;
  const ref = React.useRef<HTMLDivElement>(null);
  const [shape, setShape] = React.useState<Shape>();
  const id = `lens-${React.useId().replace(/[^\w-]/g, '')}`;
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!liquid || !el) return setShape(undefined);
    const measure = () => {
      const end = endSize(el);
      const next = {
        width: end?.width ?? Math.round(el.offsetWidth),
        height: end?.height ?? Math.round(el.offsetHeight),
        radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
      };
      setShape((was) => (was && sameShape(was, next) ? was : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [liquid]);
  const map =
    liquid && shape?.width && shape.height
      ? lens(shape.width, shape.height, shape.radius)
      : null;
  const wide = shape && shape.width >= shape.height;
  const cap = shape
    ? Math.min(shape.width, shape.height) /
      2 /
      Math.max(shape.width, shape.height)
    : 0;
  const piece = (from: number) =>
    wide
      ? { x: from, y: 0, width: cap, height: 1 }
      : { x: 0, y: from, width: 1, height: cap };
  return (
    <div
      ref={ref}
      data-surface={map ? 'liquid' : look === 'solid' ? 'solid' : 'frosted'}
      className={cn('glass-surface', className)}
      style={
        map ? { ...style, backdropFilter: `blur(2px) url(#${id})` } : style
      }
      {...props}
    >
      {map && shape && (
        <svg aria-hidden className="pointer-events-none absolute size-0">
          <filter
            id={id}
            x="0"
            y="0"
            width="1"
            height="1"
            primitiveUnits="objectBoundingBox"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={map.middle}
              x="0"
              y="0"
              width="1"
              height="1"
              preserveAspectRatio="none"
              result="middle"
            />
            <feImage
              href={map.start}
              {...piece(0)}
              preserveAspectRatio="none"
              result="start"
            />
            <feImage
              href={map.end}
              {...piece(1 - cap)}
              preserveAspectRatio="none"
              result="end"
            />
            <feMerge result="bend">
              <feMergeNode in="middle" />
              <feMergeNode in="start" />
              <feMergeNode in="end" />
            </feMerge>
            {/* In the box's units, the scale is a share of its width. */}
            <feDisplacementMap
              in="SourceGraphic"
              in2="bend"
              scale={map.scale / shape.width}
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
