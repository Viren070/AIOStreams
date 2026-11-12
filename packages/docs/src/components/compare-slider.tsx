'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

interface Side {
  src: string;
  alt: string;
  label: string;
}

export function CompareSlider({
  before,
  after,
  width,
  height,
  className,
}: {
  before: Side;
  after: Side;
  width: number;
  height: number;
  className?: string;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const [split, setSplit] = React.useState(50);
  const dragging = React.useRef(false);

  const moveTo = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const at = ((clientX - rect.left) / rect.width) * 100;
    setSplit(Math.min(100, Math.max(0, at)));
  };

  return (
    <div
      ref={box}
      className={cn(
        'relative cursor-ew-resize touch-pan-y select-none overflow-hidden rounded-xl border border-fd-border',
        className
      )}
      style={{ aspectRatio: `${width} / ${height}` }}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) moveTo(e.clientX);
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={after.src}
        alt={after.alt}
        width={width}
        height={height}
        loading="lazy"
        draggable={false}
        className="absolute inset-0 size-full object-cover"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={before.src}
        alt={before.alt}
        width={width}
        height={height}
        loading="lazy"
        draggable={false}
        className="absolute inset-0 size-full object-cover"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      />
      <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
        {before.label}
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
        {after.label}
      </span>
      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_8px_rgba(0,0,0,0.5)]"
        style={{ left: `${split}%` }}
      />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(split)}
        onChange={(e) => setSplit(Number(e.target.value))}
        aria-label={`${before.label} and ${after.label} split`}
        className="peer pointer-events-none absolute inset-0 size-full opacity-0"
      />
      <div
        className="pointer-events-none absolute top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-black/50 text-white shadow-lg peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400"
        style={{ left: `${split}%` }}
        aria-hidden
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="currentColor">
          <path d="M7 5 2 10l5 5V5Zm6 0v10l5-5-5-5Z" />
        </svg>
      </div>
    </div>
  );
}
