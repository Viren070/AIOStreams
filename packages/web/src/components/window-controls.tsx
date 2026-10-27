import { t } from '@lingui/core/macro';
import React from 'react';
import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
  VscChromeRestore,
  VscScreenNormal,
} from 'react-icons/vsc';
import { cn } from '@aiostreams/ui/core/styling';
import { appBridge } from '../lib/hosts/shell/bridge';
import { currentHost } from '../lib/hosts';

const STRIP_PX = 40;
const EDGE_PX = 4;
const CORNER_PX = 12;
const INTERACTIVE =
  'button, a, input, textarea, select, label, [role="slider"], [role="button"], [role="tab"], [role="menuitem"]';

/** macOS draws its own. */
export const pageDrawsWindowButtons = () =>
  currentHost().name === 'desktop' && appBridge()?.platform !== 'macos';

function useWindowState() {
  const shell = appBridge()!;
  const [state, setState] = React.useState({
    maximized: false,
    fullscreen: false,
  });
  React.useEffect(() => {
    const unsubscribe = shell.subscribe((m) => {
      if (m.type === 'window-state')
        setState((s) => ({ ...s, maximized: m.maximized }));
      else if (m.type === 'fullscreen')
        setState((s) => ({ ...s, fullscreen: m.value }));
    });
    shell.send({ type: 'window-state' });
    return unsubscribe;
  }, [shell]);
  return state;
}

function WindowButtons({
  maximized,
  fullscreen,
  inBar = false,
}: {
  maximized: boolean;
  fullscreen: boolean;
  inBar?: boolean;
}) {
  const shell = appBridge()!;
  const button = cn(
    'flex items-center justify-center transition-colors hover:text-white',
    inBar
      ? 'size-12 rounded-full text-lg text-gray-300'
      : 'h-8 w-11 rounded-lg text-[0.95rem] text-white/85 active:text-white'
  );
  const plain = inBar
    ? 'hover:bg-white/10'
    : 'hover:bg-white/5 active:bg-white/10';
  return (
    <>
      <button
        type="button"
        data-name="minimise"
        aria-label={t`Minimise`}
        tabIndex={-1}
        className={cn(button, plain)}
        onClick={() => shell.send({ type: 'minimize' })}
      >
        <VscChromeMinimize />
      </button>
      {fullscreen ? (
        <button
          type="button"
          data-name="fullscreen"
          aria-label={t`Exit full screen`}
          title="Exit full screen"
          tabIndex={-1}
          className={cn(button, plain)}
          onClick={() => shell.send({ type: 'fullscreen', value: false })}
        >
          <VscScreenNormal />
        </button>
      ) : (
        <button
          type="button"
          data-name="maximise"
          aria-label={maximized ? t`Restore` : t`Maximise`}
          tabIndex={-1}
          className={cn(button, plain)}
          onClick={() => shell.send({ type: 'window-maximize' })}
        >
          {maximized ? <VscChromeRestore /> : <VscChromeMaximize />}
        </button>
      )}
      <button
        type="button"
        data-name="close"
        aria-label={t`Close`}
        tabIndex={-1}
        className={cn(button, 'hover:bg-red-500 active:bg-red-600')}
        onClick={() => shell.send({ type: 'close' })}
      >
        <VscChromeClose />
      </button>
    </>
  );
}

/** The window buttons in the top bar, which the floating ones give way to. */
export function BarWindowButtons() {
  return <WindowButtons {...useWindowState()} inBar />;
}

/**
 * The desktop app's window has no title bar: empty space along the top moves
 * it, the top edge resizes it (the page covers the one the system offers), and
 * these buttons stand in for the system's, staying in full screen so a mouse
 * can leave it. macOS keeps its own buttons and edges, so only the moving is
 * left to the page there.
 */
export function WindowControls() {
  const shell = appBridge()!;
  const native = shell.platform === 'macos';
  const { maximized, fullscreen } = useWindowState();
  const latest = React.useRef({ maximized, fullscreen });
  latest.current = { maximized, fullscreen };

  React.useEffect(() => {
    document.documentElement.dataset.platform = shell.platform;
    const taken = (e: MouseEvent): 'resize' | 'move' | null => {
      const { maximized, fullscreen } = latest.current;
      if (e.button !== 0 || fullscreen || e.clientY > STRIP_PX) return null;
      if (e.clientY <= EDGE_PX && !maximized && !native) return 'resize';
      if ((e.target as HTMLElement | null)?.closest(INTERACTIVE)) return null;
      return 'move';
    };
    // The system keeps the release of a press that moves the window, so the
    // page never sees the press, or a hold it starts never ends.
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && taken(e)) e.stopPropagation();
    };
    const onDown = (e: MouseEvent) => {
      const press = taken(e);
      if (!press) return;
      e.preventDefault();
      if (press === 'resize') {
        const edge =
          e.clientX <= CORNER_PX
            ? 'nw'
            : e.clientX >= window.innerWidth - CORNER_PX
              ? 'ne'
              : 'n';
        shell.send({ type: 'window-resize', edge });
      } else
        shell.send({
          type: e.detail === 2 ? 'window-maximize' : 'window-drag',
        });
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [shell, native]);

  if (native) return null;
  return (
    <>
      {!maximized && !fullscreen && (
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
        data-fullscreen={fullscreen || undefined}
        data-modal-passthrough
        className="pointer-events-auto fixed right-2 top-0 z-[9999] flex h-10 items-center gap-1 transition-opacity duration-300"
      >
        <WindowButtons maximized={maximized} fullscreen={fullscreen} />
      </div>
    </>
  );
}
