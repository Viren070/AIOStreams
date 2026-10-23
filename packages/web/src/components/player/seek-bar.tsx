import { t } from '@lingui/core/macro';
import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { clock } from '../../lib/format';
import { chapterAt, type Chapter } from '../../lib/playback/chapters';
import { usePlayhead, type Playhead } from '../../lib/playback/playhead';
import type { ThumbnailFeed } from '../../lib/playback/thumbnails';
import type { Segment } from './segments';

const still = () => () => {};

/** How long a skip's picture stays once the skip lands, or once a late picture arrives. */
const SKIP_PICTURE_MS = 1000;

export const arrowDirection = (key: string) =>
  key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;

export function SeekBar({
  playhead,
  live,
  durationMs,
  segments,
  chapters,
  previewMs,
  previewPicture,
  handle,
  thumbnails,
  onSeek,
  onStep,
  onTogglePlay,
}: {
  playhead: Playhead;
  /** Held still while the controls hide. */
  live: boolean;
  durationMs: number;
  segments: Segment[];
  chapters: Chapter[];
  /** Where a swipe on the video would seek to. */
  previewMs: number | null;
  previewPicture: boolean;
  /** Shows the handle at rest, where nothing hovers. */
  handle: boolean;
  thumbnails?: ThumbnailFeed;
  onSeek(ms: number): void;
  onStep(direction: number): void;
  onTogglePlay(): void;
}) {
  const positionMs = usePlayhead(playhead, (h) => h.positionMs, live);
  const buffered = usePlayhead(playhead, (h) => h.buffered, live);
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
  const previewPeek = previewPicture ? previewMs : null;
  // A skip lands about when its picture does, so the picture outlasts it.
  const [held, setHeld] = React.useState<number | null>(null);
  if (previewPeek !== null && previewPeek !== held) setHeld(previewPeek);
  const peekMs = durationMs > 0 ? (drag ?? hover ?? previewPeek ?? held) : null;
  React.useEffect(() => thumbnails?.want(peekMs), [thumbnails, peekMs]);
  React.useEffect(() => () => thumbnails?.want(null), [thumbnails]);
  const picture = React.useSyncExternalStore(
    thumbnails?.subscribe ?? still,
    () => thumbnails?.current() ?? null
  );
  React.useEffect(() => {
    if (previewPeek !== null || held === null) return;
    const timer = setTimeout(() => setHeld(null), SKIP_PICTURE_MS);
    return () => clearTimeout(timer);
  }, [previewPeek, held, picture]);

  return (
    <div
      ref={bar}
      role="slider"
      aria-label={t`Seek`}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(shown / 1000)}
      aria-valuetext={clock(shown)}
      tabIndex={0}
      data-ui="seek-bar"
      // A timeline runs left to right in every language.
      dir="ltr"
      data-focus="own"
      // The space above it takes presses too, so a finger finds it.
      className="group/seek relative flex h-5 cursor-pointer touch-none items-center rounded-full outline-none before:absolute before:inset-x-0 before:-top-6 before:bottom-0 before:content-['']"
      onKeyDown={(e) => {
        const direction = arrowDirection(e.key);
        if (!direction && e.key !== 'Enter') return;
        e.preventDefault();
        if (direction) onStep(direction);
        else onTogglePlay();
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
        {buffered.map((r) => (
          <div
            key={r.startMs}
            data-ui="seek-bar-buffered"
            className="absolute inset-y-0 bg-white/30"
            style={{
              left: percent(r.startMs),
              width: percent(r.endMs - r.startMs),
            }}
          />
        ))}
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
      {peekMs !== null && (hover !== null || picture) && (
        <div
          data-ui="seek-bar-tooltip"
          className={cn(
            'pointer-events-none absolute bottom-6 flex -translate-x-1/2 flex-col items-center gap-1',
            picture && 'w-32 [--half:4rem] sm:w-48 sm:[--half:6rem]'
          )}
          style={{
            left: picture
              ? `clamp(var(--half), ${percent(peekMs)}, calc(100% - var(--half)))`
              : percent(peekMs),
          }}
        >
          {picture && (
            <img
              data-ui="seek-bar-thumbnail"
              src={picture.src}
              alt=""
              decoding="async"
              className="w-full rounded-md bg-black shadow-lg ring-1 ring-white/15"
            />
          )}
          {hover !== null && (
            <span className="rounded-md bg-black/80 px-2 py-1 text-xs tabular-nums">
              {segments.find((s) => peekMs >= s.startMs && peekMs < s.endMs)
                ?.type ?? chapters[chapterAt(chapters, peekMs)]?.title}{' '}
              {clock(peekMs)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
