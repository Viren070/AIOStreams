import React from 'react';
import { usingKeys } from './input';

const HOLD_MS = 500;

/**
 * Handlers for a press that, held for `HOLD_MS`, runs `onHold` in place of the
 * click; a remote's held Select comes as a right click. `menu: true` leaves
 * touch and keys alone where they open a menu.
 */
export function useHold(
  onHold: (() => void) | undefined,
  { menu = false }: { menu?: boolean } = {}
) {
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = React.useRef(false);
  const latest = React.useRef(onHold);
  latest.current = onHold;
  React.useEffect(() => () => clearTimeout(timer.current), []);
  if (!onHold) return {};
  const cancel = () => clearTimeout(timer.current);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      held.current = false;
      if (e.button !== 0 || (menu && e.pointerType === 'touch')) return;
      cancel();
      timer.current = setTimeout(() => {
        held.current = true;
        latest.current?.();
      }, HOLD_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e: React.MouseEvent) => {
      if (!held.current) return;
      held.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu: (e: React.MouseEvent) => {
      if (menu || !usingKeys()) return;
      e.preventDefault();
      latest.current?.();
    },
  };
}
