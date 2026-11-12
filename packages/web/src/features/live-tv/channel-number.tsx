import { t } from '@lingui/core/macro';
import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { useLatest } from '@/hooks/use-latest';

/** Digits typed for a channel number wait this long for the next. */
const NUMBER_WAIT_MS = 1500;
const MAX_DIGITS = 4;

/**
 * Digits typed into a channel number, which `go` takes once they stop; it
 * answers false where no channel has that number.
 */
export function useNumberEntry(
  go: ((number: string) => boolean | Promise<boolean>) | undefined,
  notice: (text: string) => void
) {
  const [typed, setTyped] = React.useState('');
  // A new `go` each render must not restart the wait.
  const latest = useLatest({ go, notice });
  React.useEffect(() => {
    if (!typed) return;
    const timer = setTimeout(() => {
      setTyped('');
      const { go, notice } = latest.current;
      void Promise.resolve(go?.(typed) ?? false).then((found) => {
        if (!found) notice(t`No channel ${typed}`);
      });
    }, NUMBER_WAIT_MS);
    return () => clearTimeout(timer);
  }, [typed, latest]);
  const type = (digit: string) =>
    setTyped((last) => (last + digit).slice(-MAX_DIGITS));
  return { typed, type };
}

export function NumberEntry({
  typed,
  className,
}: {
  typed: string;
  className?: string;
}) {
  return (
    <div
      data-ui="channel-number"
      className={cn(
        'pointer-events-none absolute end-[max(1.5rem,env(safe-area-inset-right))] top-[calc(5rem+env(safe-area-inset-top))] z-20 rounded-xl bg-black/70 px-4 py-2 text-4xl font-bold tabular-nums',
        className
      )}
    >
      {typed}
    </div>
  );
}
