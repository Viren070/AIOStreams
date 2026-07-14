import React from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';

/**
 * Relative change beyond which the value jumps straight to the new sample
 * instead of easing to it.
 */
const SNAP_RATIO = 0.5;

/**
 * A continuously-varying metric — a rate, a ratio, a byte total — rendered so
 * it eases between samples instead of snapping to each one.
 *
 * The tween drives a MotionValue, which writes to the text node directly, so
 * animating at display rate costs no React renders.
 */
export function AnimatedNumber({
  value,
  format,
  durationSec = 0.35,
  ease = 'easeOut',
}: {
  value: number;
  format: (n: number) => string;
  durationSec?: number;
  /**
   * `easeOut` suits a value that settles (a rate reacting to a seek). Use
   * `linear` for one that advances steadily, and to stay in step with a bar
   * alongside it.
   */
  ease?: 'easeOut' | 'linear';
}) {
  const reducedMotion = useReducedMotion();
  const current = useMotionValue(value);
  const text = useTransform(current, format);
  const mounted = React.useRef(false);

  React.useEffect(() => {
    const from = current.get();
    const scale = Math.max(Math.abs(from), Math.abs(value));
    const isEvent = scale > 0 && Math.abs(value - from) / scale > SNAP_RATIO;

    // The first sample is the truth, not something to count up to; easing from
    // zero on mount would only delay the first honest read.
    if (!mounted.current || reducedMotion || isEvent) {
      mounted.current = true;
      current.set(value);
      return;
    }
    const controls = animate(current, value, {
      duration: durationSec,
      ease,
    });
    return () => controls.stop();
  }, [value, durationSec, ease, reducedMotion, current]);

  return <motion.span>{text}</motion.span>;
}
