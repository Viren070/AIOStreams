import React from 'react';
import { createPortal } from 'react-dom';
import { LuLock } from 'react-icons/lu';
import { cn } from '@aiostreams/ui/core/styling';
import { useAction } from '../../lib/input';

/** How long the unlock button stays after a touch. */
const SHOWN_MS = 3000;

export function ScreenLock({ onUnlock }: { onUnlock(): void }) {
  const [shown, setShown] = React.useState(true);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = React.useCallback(() => {
    setShown(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), SHOWN_MS);
  }, []);
  React.useEffect(() => {
    show();
    return () => clearTimeout(timer.current);
  }, [show]);
  useAction('back', show);

  return createPortal(
    <div
      data-ui="player-lock"
      className="fixed inset-0 z-40 flex touch-none select-none items-center justify-center"
      onPointerDown={show}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        data-ui="player-unlock"
        onClick={onUnlock}
        className={cn(
          'flex flex-col items-center gap-2 rounded-2xl bg-black/70 px-6 py-4 transition-opacity duration-300',
          !shown && 'pointer-events-none opacity-0'
        )}
      >
        <LuLock className="text-3xl" />
        <span className="text-sm font-medium">Tap to unlock</span>
      </button>
    </div>,
    document.body
  );
}
