import React from 'react';
import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
  VscChromeRestore,
} from 'react-icons/vsc';
import { cn } from '@aiostreams/ui/core/styling';

const STRIP_PX = 40;
const EDGE_PX = 4;
const CORNER_PX = 12;
const INTERACTIVE =
  'button, a, input, textarea, select, label, [role="slider"], [role="button"], [role="tab"], [role="menuitem"]';

/**
 * The desktop app's window has no title bar: empty space along the top moves
 * it, the top edge resizes it (the page covers the one the system offers), and
 * these buttons stand in for the system's.
 */
export function WindowControls() {
  const shell = window.aiostreamsDesktop!;
  const [maximized, setMaximized] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const latest = React.useRef({ maximized, fullscreen });
  latest.current = { maximized, fullscreen };

  React.useEffect(() => {
    const unsubscribe = shell.subscribe((m) => {
      if (m.type === 'window-state') setMaximized(m.maximized);
      else if (m.type === 'fullscreen') setFullscreen(m.value);
    });
    shell.send({ type: 'window-state' });
    const onDown = (e: MouseEvent) => {
      const { maximized, fullscreen } = latest.current;
      if (e.button !== 0 || fullscreen || e.clientY > STRIP_PX) return;
      if (e.clientY <= EDGE_PX && !maximized) {
        const edge =
          e.clientX <= CORNER_PX
            ? 'nw'
            : e.clientX >= window.innerWidth - CORNER_PX
              ? 'ne'
              : 'n';
        e.preventDefault();
        shell.send({ type: 'window-resize', edge });
        return;
      }
      if ((e.target as HTMLElement | null)?.closest(INTERACTIVE)) return;
      e.preventDefault();
      shell.send({ type: e.detail === 2 ? 'window-maximize' : 'window-drag' });
    };
    window.addEventListener('mousedown', onDown);
    return () => {
      unsubscribe();
      window.removeEventListener('mousedown', onDown);
    };
  }, [shell]);

  if (fullscreen) return null;
  const button =
    'flex h-8 w-11 items-center justify-center rounded-lg text-[0.95rem] text-white/85 outline-none transition-colors hover:text-white active:text-white';
  return (
    <>
      {!maximized && (
        <div
          aria-hidden
          data-modal-passthrough
          className="pointer-events-auto fixed inset-x-0 top-0 z-[9999] flex h-1 cursor-ns-resize justify-between"
        >
          <span className="w-3 cursor-nwse-resize" />
          <span className="w-3 cursor-nesw-resize" />
        </div>
      )}
      <div
        data-ui="window-controls"
        data-modal-passthrough
        className="pointer-events-auto fixed right-2 top-0 z-[9999] flex h-10 items-center gap-1 transition-opacity duration-300"
      >
        <button
          type="button"
          aria-label="Minimise"
          tabIndex={-1}
          className={cn(button, 'hover:bg-white/5 active:bg-white/10')}
          onClick={() => shell.send({ type: 'minimize' })}
        >
          <VscChromeMinimize />
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximise'}
          tabIndex={-1}
          className={cn(button, 'hover:bg-white/5 active:bg-white/10')}
          onClick={() => shell.send({ type: 'window-maximize' })}
        >
          {maximized ? <VscChromeRestore /> : <VscChromeMaximize />}
        </button>
        <button
          type="button"
          aria-label="Close"
          tabIndex={-1}
          className={cn(button, 'hover:bg-red-500 active:bg-red-600')}
          onClick={() => shell.send({ type: 'close' })}
        >
          <VscChromeClose />
        </button>
      </div>
    </>
  );
}
