import React from 'react';
import { motion } from 'motion/react';
import { PiPauseDuotone, PiPlayDuotone } from 'react-icons/pi';
import { LuFastForward, LuRotateCcw, LuRotateCw } from 'react-icons/lu';
import { clock } from '../../lib/format';

export function useNotice(): [React.ReactNode, (text: string) => void] {
  const [text, setText] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const show = React.useCallback((next: string) => {
    clearTimeout(timer.current);
    setText(next);
    timer.current = setTimeout(() => setText(null), 1200);
  }, []);
  const node = text && (
    <div
      data-ui="player-notice"
      className="pointer-events-none absolute inset-x-0 top-20 flex justify-center"
    >
      <span className="rounded-full bg-black/70 px-4 py-1.5 text-sm font-medium tabular-nums">
        {text}
      </span>
    </div>
  );
  return [node, show];
}

export function useToggleFlash(): [React.ReactNode, (paused: boolean) => void] {
  const [flash, setFlash] = React.useState<{
    key: number;
    playing: boolean;
  } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const show = React.useCallback((wasPaused: boolean) => {
    clearTimeout(timer.current);
    setFlash({ key: Date.now(), playing: wasPaused });
    timer.current = setTimeout(() => setFlash(null), 200);
  }, []);
  const Icon = flash?.playing ? PiPlayDuotone : PiPauseDuotone;
  const node = flash && (
    <motion.div
      key={flash.key}
      initial={{ opacity: 0.2, scale: 1 }}
      animate={{ opacity: 0.5, scale: 1.6 }}
      transition={{ duration: 0.06, ease: 'easeOut' }}
      data-ui="play-flash"
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <Icon className="size-10 text-white lg:size-24" />
    </motion.div>
  );
  return [node, show];
}

export function useSeekFlash(): [React.ReactNode, (deltaMs: number) => void] {
  const [flash, setFlash] = React.useState<{ key: number; ms: number } | null>(
    null
  );
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const show = React.useCallback((deltaMs: number) => {
    clearTimeout(timer.current);
    setFlash((f) => ({
      key: Date.now(),
      ms: f && f.ms < 0 === deltaMs < 0 ? f.ms + deltaMs : deltaMs,
    }));
    timer.current = setTimeout(() => setFlash(null), 700);
  }, []);
  const back = !!flash && flash.ms < 0;
  const Icon = back ? LuRotateCcw : LuRotateCw;
  const node = flash && (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className={
          back
            ? '-translate-x-[min(14rem,25vw)]'
            : 'translate-x-[min(14rem,25vw)]'
        }
      >
        <motion.div
          key={flash.key}
          initial={{ opacity: 0.4, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          data-ui="seek-flash"
          className="flex flex-col items-center gap-1 drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]"
        >
          <Icon className="size-8 lg:size-10" />
          <span className="text-sm font-semibold tabular-nums lg:text-base">
            {Math.abs(flash.ms) / 1000}s
          </span>
        </motion.div>
      </div>
    </div>
  );
  return [node, show];
}

export function ScrubReadout({
  fromMs,
  toMs,
  durationMs,
}: {
  fromMs: number;
  toMs: number;
  durationMs: number;
}) {
  const delta = toMs - fromMs;
  return (
    <div
      data-ui="player-scrub"
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <div className="flex flex-col items-center gap-1 rounded-2xl bg-black/60 px-6 py-3 tabular-nums">
        <span className="text-3xl font-semibold">
          {delta < 0 ? '−' : '+'}
          {clock(Math.abs(delta))}
        </span>
        <span className="text-sm text-gray-300">
          {clock(toMs)}
          {durationMs > 0 && ` / ${clock(durationMs)}`}
        </span>
      </div>
    </div>
  );
}

export function SpeedPill({ rate }: { rate: number }) {
  return (
    <div
      data-ui="player-held-speed"
      className="pointer-events-none absolute inset-x-0 top-[calc(1.25rem+env(safe-area-inset-top))] flex justify-center"
    >
      <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-4 py-1.5 text-sm font-semibold tabular-nums">
        {rate}×
        <LuFastForward />
      </span>
    </div>
  );
}
