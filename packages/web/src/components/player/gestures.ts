import React from 'react';
import { currentHost } from '../../lib/hosts';
import type { PlayerController } from '../../lib/playback/controller';
import { useLatest } from '../../lib/use-latest';

const DOUBLE_TAP_MS = 300;
/** Once seeking, each tap this soon after the last seeks again. */
const SEEK_RUN_MS = 700;
const SWIPE_PX = 12;
/** A swipe over this share of the height goes from nothing to full. */
const SWIPE_RANGE = 0.8;
const HOLD_MS = 500;
/** A swipe across the whole width seeks this far. */
const SCRUB_SPAN_MS = 90_000;
/** Sideways swipes from this close to a side are the system's back gesture. */
const EDGE_PX = 24;
const PINCH_RATIO = 1.2;

type Level = 'volume' | 'brightness';

interface Swipe {
  level: Level;
  height: number;
  startY: number;
  y: number;
  /** Null until the app says the level. */
  from: number | null;
  shown: number | null;
}

interface Press {
  id: number;
  x: number;
  y: number;
  side: -1 | 1;
  edge: boolean;
  kind: 'pending' | 'levels' | 'scrub' | 'held' | 'none';
  swipe: Swipe | null;
  /** Where the scrub started, past the move that made it one. */
  scrubX: number;
  timer: ReturnType<typeof setTimeout>;
  release?: () => void;
}

interface Point {
  x: number;
  y: number;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export interface Gestures {
  player: PlayerController;
  seekBy(deltaMs: number): void;
  seekStepMs: number;
  notice(text: string): void;
  /** A single tap, once it can no longer become a double tap. */
  onTap(): void;
  onClick(): void;
  onDoubleClick(): void;
  hold(): (() => void) | false;
  onScrub(deltaMs: number): void;
  onScrubEnd(commit: boolean): void;
  /** Missing where the fit can't change. */
  onPinch?: (out: boolean) => void;
}

export function usePlayerGestures(gestures: Gestures) {
  const latest = useLatest(gestures);
  const press = React.useRef<Press | null>(null);
  const points = React.useRef(new Map<number, Point>());
  const pinch = React.useRef<{ from: number; done: boolean } | null>(null);
  const mouse = React.useRef<{
    timer: ReturnType<typeof setTimeout>;
    release?: () => void;
  } | null>(null);
  // A held mouse button's click doesn't also play or pause.
  const swallowClick = React.useRef(false);
  // Clicks follow touch too, which handles itself; a double click carries no pointer type.
  const pointer = React.useRef('mouse');
  const lastTap = React.useRef<{
    at: number;
    side: number;
    seeking: boolean;
  } | null>(null);
  const pending = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const brightened = React.useRef(false);

  const end = (p: Press, commit: boolean) => {
    clearTimeout(p.timer);
    p.release?.();
    if (p.kind === 'scrub') latest.current.onScrubEnd(commit);
  };
  const latestEnd = useLatest(end);
  React.useEffect(
    () => () => {
      clearTimeout(pending.current);
      if (press.current) latestEnd.current(press.current, false);
      clearTimeout(mouse.current?.timer);
      mouse.current?.release?.();
      if (brightened.current) currentHost().levels?.release();
    },
    [latestEnd]
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

  const onTouchDown = (e: React.PointerEvent<HTMLElement>) => {
    points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (points.current.size === 2) {
      // A second finger makes it a pinch.
      if (press.current) end(press.current, false);
      press.current = null;
      clearTimeout(pending.current);
      lastTap.current = null;
      const [a, b] = [...points.current.values()];
      pinch.current = { from: distance(a, b), done: false };
      return;
    }
    if (points.current.size > 1 || pinch.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p: Press = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      side: e.clientX < r.left + r.width / 2 ? -1 : 1,
      edge: e.clientX - r.left < EDGE_PX || r.right - e.clientX < EDGE_PX,
      kind: 'pending',
      swipe: null,
      scrubX: 0,
      timer: setTimeout(() => {
        if (press.current !== p || p.kind !== 'pending') return;
        const release = latest.current.hold();
        p.kind = release ? 'held' : 'none';
        if (release) p.release = release;
      }, HOLD_MS),
    };
    press.current = p;
  };

  const onTouchMove = (e: React.PointerEvent<HTMLElement>) => {
    if (points.current.has(e.pointerId))
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const spread = pinch.current;
    if (spread) {
      e.stopPropagation();
      if (spread.done || points.current.size < 2) return;
      const [a, b] = [...points.current.values()];
      const ratio = distance(a, b) / spread.from;
      if (ratio > PINCH_RATIO || ratio < 1 / PINCH_RATIO) {
        spread.done = true;
        latest.current.onPinch?.(ratio > 1);
      }
      return;
    }
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    // A swipe leaves the controls as they are.
    e.stopPropagation();
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (p.kind === 'pending' && Math.hypot(dx, dy) > SWIPE_PX) {
      clearTimeout(p.timer);
      if (Math.abs(dy) > Math.abs(dx)) {
        p.swipe = startSwipe(p.side, e.clientY, e.currentTarget.clientHeight);
        p.kind = p.swipe ? 'levels' : 'none';
      } else {
        p.kind = p.edge ? 'none' : 'scrub';
        p.scrubX = e.clientX;
      }
    }
    if (p.kind === 'levels' && p.swipe) {
      p.swipe.y = e.clientY;
      apply(p.swipe);
    } else if (p.kind === 'scrub') {
      const share = (e.clientX - p.scrubX) / e.currentTarget.clientWidth;
      latest.current.onScrub(share * SCRUB_SPAN_MS);
    }
  };

  const onTouchUp = (e: React.PointerEvent<HTMLElement>, cancel: boolean) => {
    points.current.delete(e.pointerId);
    if (pinch.current) {
      if (!points.current.size) pinch.current = null;
      return;
    }
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.kind === 'pending' && !cancel) {
      clearTimeout(p.timer);
      tap(p.side);
    } else end(p, !cancel);
  };

  const mouseUp = () => {
    const m = mouse.current;
    if (!m) return;
    clearTimeout(m.timer);
    mouse.current = null;
    if (!m.release) return;
    m.release();
    swallowClick.current = true;
  };

  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      pointer.current = e.pointerType;
      if (e.pointerType === 'touch') return onTouchDown(e);
      if (e.button !== 0) return;
      swallowClick.current = false;
      // Kept, so letting go over a control still ends the hold.
      e.currentTarget.setPointerCapture(e.pointerId);
      const m: NonNullable<typeof mouse.current> = {
        timer: setTimeout(() => {
          if (mouse.current !== m) return;
          m.release = latest.current.hold() || undefined;
        }, HOLD_MS),
      };
      mouse.current = m;
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'touch') onTouchMove(e);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'touch') onTouchUp(e, false);
      else mouseUp();
    },
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'touch') onTouchUp(e, true);
      else mouseUp();
    },
    onClick: () => {
      const swallow = swallowClick.current;
      swallowClick.current = false;
      if (!swallow && pointer.current !== 'touch') latest.current.onClick();
    },
    onDoubleClick: () => {
      if (pointer.current !== 'touch') latest.current.onDoubleClick();
    },
  };
}
