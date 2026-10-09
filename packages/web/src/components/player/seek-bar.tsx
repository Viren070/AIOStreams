import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { clock } from '../../lib/format';
import { chapterAt, type Chapter } from '../../lib/playback/chapters';
import type { Segment } from './segments';

export const arrowDirection = (key: string) =>
  key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;

export function SeekBar({
  positionMs,
  durationMs,
  bufferedMs,
  segments,
  chapters,
  previewMs,
  handle,
  onSeek,
  onStep,
}: {
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  segments: Segment[];
  chapters: Chapter[];
  /** Where a swipe on the video would seek to. */
  previewMs: number | null;
  /** Shows the handle at rest, where nothing hovers. */
  handle: boolean;
  onSeek(ms: number): void;
  onStep(direction: number): void;
}) {
  const bar = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  const [drag, setDrag] = React.useState<number | null>(null);
  const at = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || !durationMs) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * durationMs;
  };
  const percent = (ms: number) =>
    durationMs ? `${Math.min(100, (ms / durationMs) * 100)}%` : '0%';
  const shown = drag ?? previewMs ?? positionMs;

  return (
    <div
      ref={bar}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(shown / 1000)}
      aria-valuetext={clock(shown)}
      tabIndex={0}
      data-ui="seek-bar"
      data-focus="own"
      // The space above it takes presses too, so a finger finds it.
      className="group/seek relative flex h-5 cursor-pointer touch-none items-center rounded-full outline-none before:absolute before:inset-x-0 before:-top-6 before:bottom-0 before:content-['']"
      onKeyDown={(e) => {
        const direction = arrowDirection(e.key);
        if (!direction) return;
        e.preventDefault();
        onStep(direction);
      }}
      onPointerDown={(e) => {
        if (!durationMs) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(at(e.clientX));
      }}
      onPointerMove={(e) => {
        const ms = at(e.clientX);
        setHover(ms);
        if (drag !== null) setDrag(ms);
      }}
      onPointerUp={() => {
        if (drag !== null) onSeek(drag);
        setDrag(null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div
        data-ui="seek-bar-track"
        className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover/seek:h-1.5 group-focus-visible/seek:h-1.5"
      >
        <div
          data-ui="seek-bar-buffered"
          className="absolute inset-y-0 left-0 bg-white/30"
          style={{ width: percent(bufferedMs) }}
        />
        {segments.map((s) => (
          <div
            key={`${s.type}-${s.startMs}`}
            data-ui="seek-bar-segment"
            data-type={s.type}
            className="absolute inset-y-0 bg-amber-300/60"
            style={{
              left: percent(s.startMs),
              width: percent(s.endMs - s.startMs),
            }}
          />
        ))}
        <div
          data-ui="seek-bar-progress"
          className="absolute inset-y-0 left-0 bg-brand-400"
          style={{ width: percent(shown) }}
        />
        {chapters.map(
          (c) =>
            c.startMs > 0 && (
              <div
                key={c.startMs}
                data-ui="seek-bar-chapter"
                className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-black/70"
                style={{ left: percent(c.startMs) }}
              />
            )
        )}
      </div>
      <div
        data-ui="seek-bar-thumb"
        className={cn(
          'absolute size-3.5 -translate-x-1/2 rounded-full bg-white shadow transition-[opacity,box-shadow] group-hover/seek:opacity-100 group-focus-visible/seek:size-4 group-focus-visible/seek:opacity-100 group-focus-visible/seek:ring-4 group-focus-visible/seek:ring-white/40',
          handle || drag !== null || previewMs !== null
            ? 'opacity-100'
            : 'opacity-0'
        )}
        style={{ left: percent(shown) }}
      />
      {hover !== null && durationMs > 0 && (
        <div
          data-ui="seek-bar-tooltip"
          className="pointer-events-none absolute bottom-6 -translate-x-1/2 rounded-md bg-black/80 px-2 py-1 text-xs tabular-nums"
          style={{ left: percent(hover) }}
        >
          {segments.find((s) => hover >= s.startMs && hover < s.endMs)?.type ??
            chapters[chapterAt(chapters, hover)]?.title}{' '}
          {clock(hover)}
        </div>
      )}
    </div>
  );
}
