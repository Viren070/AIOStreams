import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { AnyRouter } from '@tanstack/react-router';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { currentHost } from '@/lib/hosts';
import {
  actionText,
  activate,
  groupActions,
  groupLabel,
  isTextField,
  keysOf,
  move,
  moveTo,
  navigationBack,
  onAction,
  openMenu,
  returnFocus,
  scrollStep,
  startGamepads,
  startInput,
  startSubmitButtons,
  type ActionGroup,
  type Direction,
} from '@/lib/input';
import { navigate, to } from '@/lib/paths';
import { settings, useSetting } from '@/lib/settings';
import { KeyCaps } from '@/components/key-caps';

interface History {
  canGoBack(): boolean;
  back(): void;
}

/** Back where no page takes it: into a TV's navigation, out of a field, out of full screen, then a page back. */
function back(history: History): boolean {
  if (toNavigation()) return true;
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

function toNavigation(): boolean {
  const back = navigationBack();
  if (back) moveTo(back.entry, back.dir);
  return !!back;
}

/**
 * A TV's web view moves focus by its own rules on an arrow the page leaves, so
 * a TV keeps them all, scrolling a step where nothing lies that way.
 */
function step(dir: Direction): boolean {
  if (move(dir)) return true;
  if (!currentHost().tv) return false;
  if (dir === 'up' || dir === 'down') scrollStep(dir);
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
      startSubmitButtons(),
      returnFocus(router),
      onAction('nav.up', () => step('up'), fallback),
      onAction('nav.down', () => step('down'), fallback),
      onAction('nav.left', () => step('left'), fallback),
      onAction('nav.right', () => step('right'), fallback),
      onAction('nav.select', () => activate(), fallback),
      onAction('nav.menu', openMenu, fallback),
      onAction('back', () => back(history), fallback),
      onAction('help', () => setHelp(true), fallback),
    ];
    return () => stops.forEach((stop) => stop());
  }, [router]);
  return <ShortcutsHelp open={help} onOpenChange={setHelp} />;
}

const GROUPS: ActionGroup[] = [
  'general',
  'navigation',
  'player',
  'live',
  'sync',
];

function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [overrides] = useSetting(settings.controls.shortcuts);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t`Keyboard shortcuts`}
      description={t`A remote's or gamepad's buttons work too.`}
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
                {groupLabel(group)}
              </h3>
              {ids.map((id) => {
                const { label, help, summary } = actionText(id);
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
          <Trans>Change shortcuts</Trans>
        </Button>
      </div>
    </Modal>
  );
}
