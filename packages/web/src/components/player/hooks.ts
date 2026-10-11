import React from 'react';
import { useLatest } from '../../lib/use-latest';
import type { PlayerController } from '../../lib/playback/controller';

/** Skips this close together add up to one seek. */
const SEEK_BURST_MS = 400;
/** How long a burst's target shows after its last seek, if the player never gets there. */
const TARGET_HOLD_MS = 2000;
/** Within this of the target, the player has got there. */
const ARRIVED_MS = 1500;

/** `hide` keeps the controls hidden until the next input, even while paused. */
export function useIdle(ms: number) {
  const [idle, setIdle] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const wake = React.useCallback(() => {
    setIdle(false);
    setHidden(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), ms);
  }, [ms]);
  const hide = React.useCallback(() => {
    clearTimeout(timer.current);
    setIdle(true);
    setHidden(true);
  }, []);
  React.useEffect(() => {
    wake();
    return () => clearTimeout(timer.current);
  }, [wake]);
  return { idle, hidden, wake, hide };
}

/** The position at this moment, between the player's few reports a second. */
export function usePositionClock(player: PlayerController): () => number {
  const last = React.useRef({ positionMs: 0, at: 0, paused: true, rate: 1 });
  const { playhead } = player;
  const { paused, rate } = player.state;
  React.useEffect(() => {
    const note = () =>
      (last.current = {
        positionMs: playhead.positionMs,
        at: performance.now(),
        paused,
        rate,
      });
    note();
    return playhead.subscribe(note);
  }, [playhead, paused, rate]);
  return React.useCallback(() => {
    const l = last.current;
    return l.paused
      ? l.positionMs
      : l.positionMs + (performance.now() - l.at) * l.rate;
  }, []);
}

/** Also where a burst is headed, until the player gets there. */
export function useBurstSeek(
  player: PlayerController
): [(deltaMs: number) => void, number | null] {
  const latest = useLatest(player);
  const burst = React.useRef<{
    target: number;
    sent: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [heading, setHeading] = React.useState<number | null>(null);
  const [landed, setLanded] = React.useState(false);
  React.useEffect(() => () => clearTimeout(burst.current?.timer), []);
  React.useEffect(() => {
    if (heading === null || !landed) return;
    const { playhead } = latest.current;
    const arrived = () =>
      Math.abs(playhead.positionMs - heading) < ARRIVED_MS && setHeading(null);
    arrived();
    const timer = setTimeout(() => setHeading(null), TARGET_HOLD_MS);
    const stop = playhead.subscribe(arrived);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [heading, landed, latest]);
  const seekBy = React.useCallback(
    (deltaMs: number) => {
      const { state, playhead, seek } = latest.current;
      const last = burst.current;
      clearTimeout(last?.timer);
      const to = Math.max(0, (last?.target ?? playhead.positionMs) + deltaMs);
      const target = state.durationMs ? Math.min(state.durationMs, to) : to;
      const settle = () => {
        const current = burst.current;
        if (!current || current.sent) {
          burst.current = null;
          setLanded(true);
          return;
        }
        latest.current.seek(current.target);
        current.sent = true;
        current.timer = setTimeout(settle, SEEK_BURST_MS);
      };
      if (!last) seek(target);
      burst.current = {
        target,
        sent: !last,
        timer: setTimeout(settle, SEEK_BURST_MS),
      };
      setHeading(target);
      setLanded(false);
    },
    [latest]
  );
  return [seekBy, heading];
}

export function useFileDrop(
  onDrop: ((file: File) => void) | undefined
): boolean {
  const [over, setOver] = React.useState(false);
  const latest = useLatest(onDrop);
  const enabled = !!onDrop;
  React.useEffect(() => {
    if (!enabled) return;
    // Entering a child leaves its parent, so only the count says when it left the page.
    let depth = 0;
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const handlers: Record<string, (e: DragEvent) => void> = {
      dragenter: (e) => {
        if (!files(e)) return;
        depth++;
        setOver(true);
      },
      dragleave: (e) => {
        if (!files(e)) return;
        depth = Math.max(0, depth - 1);
        if (!depth) setOver(false);
      },
      dragover: (e) => {
        if (files(e)) e.preventDefault();
      },
      drop: (e) => {
        if (!files(e)) return;
        e.preventDefault();
        depth = 0;
        setOver(false);
        const file = e.dataTransfer?.files[0];
        if (file) latest.current?.(file);
      },
    };
    for (const [event, handler] of Object.entries(handlers))
      window.addEventListener(event, handler as EventListener);
    return () => {
      for (const [event, handler] of Object.entries(handlers))
        window.removeEventListener(event, handler as EventListener);
    };
  }, [enabled, latest]);
  return over && enabled;
}
