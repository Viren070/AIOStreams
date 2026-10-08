import React from 'react';
import type { AnyRouter } from '@tanstack/react-router';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { currentHost } from '../lib/hosts';
import {
  GROUP_LABELS,
  action,
  activate,
  groupActions,
  isTextField,
  keysOf,
  move,
  onAction,
  openMenu,
  returnFocus,
  startGamepads,
  startInput,
  type ActionGroup,
} from '../lib/input';
import { navigate, to } from '../lib/paths';
import { settings, useSetting } from '../lib/settings';
import { KeyCaps } from './key-caps';

interface History {
  canGoBack(): boolean;
  back(): void;
}

/** Back where no page takes it: out of a field, out of full screen, then a page back. */
function back(history: History): boolean {
  const el = document.activeElement;
  if (isTextField(el)) {
    el.blur();
    return true;
  }
  const host = currentHost();
  if (host.back?.()) return true;
  if (history.canGoBack()) history.back();
  else if (host.exit) host.exit();
  else return false;
  return true;
}

/** Keys, the wheel and gamepads, and what they do on every screen. */
export function InputSetup({ router }: { router: AnyRouter }) {
  const [help, setHelp] = React.useState(false);
  React.useEffect(() => {
    const fallback = { fallback: true };
    const { history } = router;
    const stops = [
      startInput(),
      startGamepads(),
      returnFocus(router),
      onAction('nav.up', () => move('up'), fallback),
      onAction('nav.down', () => move('down'), fallback),
      onAction('nav.left', () => move('left'), fallback),
      onAction('nav.right', () => move('right'), fallback),
      onAction('nav.select', () => activate(), fallback),
      onAction('nav.menu', openMenu, fallback),
      onAction('back', () => back(history), fallback),
      onAction('help', () => setHelp(true), fallback),
    ];
    return () => stops.forEach((stop) => stop());
  }, [router]);
  return <ShortcutsHelp open={help} onOpenChange={setHelp} />;
}

const GROUPS: ActionGroup[] = ['general', 'navigation', 'player', 'sync'];

function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [overrides] = useSetting(settings.shortcuts);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="A remote's or gamepad's buttons work too."
      contentClass="max-w-2xl"
    >
      <div
        data-ui="shortcuts-help"
        className="-mx-1 max-h-[65vh] space-y-6 overflow-y-auto px-1"
      >
        {GROUPS.map((group) => {
          const ids = groupActions(group, currentHost());
          if (!ids.length) return null;
          return (
            <section key={group} data-name={group}>
              <h3 className="mb-1 text-sm font-semibold text-[--muted]">
                {GROUP_LABELS[group]}
              </h3>
              {ids.map((id) => {
                const { label, help, summary } = action(id);
                const bound = keysOf(id, overrides);
                if (!bound.length) return null;
                const keys = summary ? [summary] : bound;
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-4 border-b border-white/5 py-1.5 last:border-0"
                  >
                    <span className="text-sm">
                      {label}
                      {help && (
                        <span className="block text-xs text-[--muted]">
                          {help}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap justify-end gap-1.5">
                      {keys.map((key) => (
                        <KeyCaps key={key} input={key} />
                      ))}
                    </span>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button
          intent="gray-outline"
          size="sm"
          rounded
          onClick={() => {
            onOpenChange(false);
            navigate(to.settings('shortcuts'));
          }}
        >
          Change shortcuts
        </Button>
      </div>
    </Modal>
  );
}
