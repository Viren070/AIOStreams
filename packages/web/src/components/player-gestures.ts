import React from 'react';
import { currentHost } from '../lib/hosts';
import type { PlayerController } from '../lib/playback/controller';
import { useLatest } from '../lib/use-latest';

/** A second tap on the same side this soon seeks. */
const DOUBLE_TAP_MS = 300;
/** Once seeking, each tap this soon after the last seeks again. */
const SEEK_RUN_MS = 700;
/** Moving this far turns a press into a swipe. */
const SWIPE_PX = 12;
/** A swipe over this share of the height goes from nothing to full. */
const SWIPE_RANGE = 0.8;

type Level = 'volume' | 'brightness';

interface Swipe {
  level: Level;
  height: number;
  startY: number;
  y: number;
  /** The level when the swipe began, once the app has said. */
  from: number | null;
  shown: number | null;
}

interface Press {
  id: number;
  x: number;
  y: number;
  side: -1 | 1;
  moved: boolean;
  swipe: Swipe | null;
}

interface Gestures {
  player: PlayerController;
  seekBy(deltaMs: number): void;
  seekStepMs: number;
  notice(text: string): void;
  /** A single tap, once it can no longer become a double tap. */
  onTap(): void;
}

/**
 * Touch on the video: a tap shows or hides the controls, a double tap on
 * either half seeks, and a swipe up or down sets the brightness on the left
 * and the volume on the right.
 */
export function usePlayerGestures(gestures: Gestures) {
  const latest = useLatest(gestures);
  const press = React.useRef<Press | null>(null);
  const lastTap = React.useRef<{
    at: number;
    side: number;
    seeking: boolean;
  } | null>(null);
  const pending = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const brightened = React.useRef(false);
  React.useEffect(
    () => () => {
      clearTimeout(pending.current);
      if (brightened.current) currentHost().levels?.release();
    },
    []
  );

  const apply = (swipe: Swipe) => {
    if (swipe.from === null) return;
    const moved = (swipe.startY - swipe.y) / (swipe.height * SWIPE_RANGE);
    const value = Math.min(1, Math.max(0, swipe.from + moved));
    const percent = Math.round(value * 100);
    if (percent === swipe.shown) return;
    swipe.shown = percent;
    const levels = currentHost().levels;
    if (levels) levels.set(swipe.level, value);
    else latest.current.player.setVolume(value);
    if (swipe.level === 'brightness') brightened.current = true;
    latest.current.notice(
      `${swipe.level === 'volume' ? 'Volume' : 'Brightness'} ${percent}%`
    );
  };

  const startSwipe = (side: -1 | 1, y: number, height: number) => {
    const levels = currentHost().levels;
    // Only the app can set the brightness.
    if (side < 0 && !levels) return null;
    const swipe: Swipe = {
      level: side < 0 ? 'brightness' : 'volume',
      height,
      startY: y,
      y,
      from: null,
      shown: null,
    };
    if (levels)
      void levels.read().then((now) => {
        swipe.from = now[swipe.level];
        apply(swipe);
      });
    else swipe.from = Math.min(1, latest.current.player.state.volume);
    return swipe;
  };

  const tap = (side: -1 | 1) => {
    const now = performance.now();
    const prev = lastTap.current;
    const again =
      !!prev &&
      prev.side === side &&
      now - prev.at < (prev.seeking ? SEEK_RUN_MS : DOUBLE_TAP_MS);
    lastTap.current = { at: now, side, seeking: again };
    clearTimeout(pending.current);
    if (again) latest.current.seekBy(side * latest.current.seekStepMs);
    else
      pending.current = setTimeout(() => latest.current.onTap(), DOUBLE_TAP_MS);
  };

  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch' || !e.isPrimary) return;
      const r = e.currentTarget.getBoundingClientRect();
      press.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        side: e.clientX < r.left + r.width / 2 ? -1 : 1,
        moved: false,
        swipe: null,
      };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.id !== e.pointerId) return;
      // A swipe leaves the controls as they are.
      e.stopPropagation();
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!p.moved && Math.hypot(dx, dy) > SWIPE_PX) {
        p.moved = true;
        if (Math.abs(dy) > Math.abs(dx))
          p.swipe = startSwipe(p.side, e.clientY, e.currentTarget.clientHeight);
      }
      if (p.swipe) {
        p.swipe.y = e.clientY;
        apply(p.swipe);
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.id !== e.pointerId) return;
      press.current = null;
      if (!p.moved) tap(p.side);
    },
    onPointerCancel: () => {
      press.current = null;
    },
  };
}
