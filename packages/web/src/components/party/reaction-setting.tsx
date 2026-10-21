import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { TextInput } from '@aiostreams/ui/text-input';
import { cn } from '@aiostreams/ui/core/styling';
import { currentHost } from '../../lib/hosts';
import { useRestoreFocus } from '../../lib/input';
import { PARTY_REACTIONS, settings, useSetting } from '../../lib/settings';
import { SettingsRow } from '../settings-card';

/** Old enough for a TV's fonts to draw. */
const GRID = [
  '👍',
  '👎',
  '👏',
  '🙌',
  '🙏',
  '🤝',
  '😂',
  '🤣',
  '😅',
  '😊',
  '😍',
  '🥰',
  '😮',
  '😱',
  '🤯',
  '😬',
  '🤔',
  '🙄',
  '😢',
  '😭',
  '😡',
  '😴',
  '💀',
  '🤡',
  '👀',
  '🍿',
  '🎉',
  '❤️',
  '🔥',
  '💯',
];

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

function firstEmoji(text: string): string | null {
  const segments = new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  }).segment(text);
  for (const { segment } of segments) if (EMOJI.test(segment)) return segment;
  return null;
}

const ROUND =
  'flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]';

export function ReactionSetting() {
  const [set, setSet] = useSetting(settings.party.reactionSet);
  const [open, setOpen] = React.useState(false);
  const [slot, setSlot] = React.useState(0);
  const [typed, setTyped] = React.useState('');
  const restoreFocus = useRestoreFocus(open);
  const put = (emoji: string) => {
    const next = [...set];
    const other = next.indexOf(emoji);
    if (other >= 0) next[other] = next[slot];
    next[slot] = emoji;
    setSet(next);
    setSlot((slot + 1) % next.length);
  };
  return (
    <>
      <SettingsRow
        label={t`Reactions`}
        help={t`What you can send from a party's chat.`}
      >
        <Button
          intent="gray-outline"
          size="sm"
          className="w-full rounded-full text-base sm:w-auto"
          aria-label={t`Change reactions`}
          onClick={() => {
            setSlot(0);
            setOpen(true);
          }}
        >
          {set.join(' ')}
        </Button>
      </SettingsRow>
      <Modal
        data-ui="dialog"
        data-name="reactions"
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={restoreFocus}
        title={t`Reactions`}
        description={t`Pick a slot, then what goes in it.`}
        contentClass="max-w-md"
      >
        <div data-nav-group className="flex justify-center gap-2">
          {set.map((emoji, i) => {
            const n = i + 1;
            return (
              <button
                key={i}
                type="button"
                data-ui="reaction-slot"
                aria-label={t`Slot ${n}: ${emoji}`}
                aria-pressed={i === slot}
                onClick={() => setSlot(i)}
                className={cn(
                  ROUND,
                  'size-12 rounded-full text-2xl',
                  i === slot
                    ? 'bg-white/15 ring-2 ring-white'
                    : 'bg-white/5 hover:bg-white/10'
                )}
              >
                {emoji}
              </button>
            );
          })}
        </div>
        <div data-ui="reaction-grid" className="grid grid-cols-6 gap-1.5">
          {GRID.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => put(emoji)}
              className={cn(
                ROUND,
                'aspect-square rounded-xl text-2xl hover:bg-white/10'
              )}
            >
              {emoji}
            </button>
          ))}
        </div>
        {!currentHost().tv && (
          <TextInput
            label={t`Or type one`}
            value={typed}
            onValueChange={(value) => {
              const emoji = firstEmoji(value);
              if (!emoji) return setTyped(value);
              put(emoji);
              setTyped('');
            }}
          />
        )}
        <div className="flex justify-between gap-2">
          <Button
            intent="gray-subtle"
            className="rounded-full"
            onClick={() => setSet(PARTY_REACTIONS)}
          >
            <Trans>Reset</Trans>
          </Button>
          <Button
            intent="white"
            className="rounded-full"
            onClick={() => setOpen(false)}
          >
            <Trans>Done</Trans>
          </Button>
        </div>
      </Modal>
    </>
  );
}
