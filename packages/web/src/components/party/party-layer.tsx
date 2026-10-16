import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';
import { formatLocale } from '../../lib/i18n';
import {
  useParty,
  usePartyEvent,
  type PartyAction,
} from '../../lib/party/party';
import { settings, useSetting } from '../../lib/settings';

const BUBBLE_MS = 8_000;
const REACTION_MS = 3_000;
const ACTION_MS = 4_000;
const MAX_BUBBLES = 3;

interface Shown<T> {
  key: number;
  name: string;
  text: T;
}

let next = 0;

/** Kept for `ms`, then dropped; the newest `max` at most. */
function useFleeting<T = string>(ms: number, max: number) {
  const [items, setItems] = React.useState<Shown<T>[]>([]);
  const add = React.useCallback(
    (name: string, text: T) => {
      const key = next++;
      setItems((list) => [...list, { key, name, text }].slice(-max));
      setTimeout(
        () => setItems((list) => list.filter((i) => i.key !== key)),
        ms
      );
    },
    [ms, max]
  );
  return [items, add] as const;
}

function ActionLine({ name, action }: { name: string; action: PartyAction }) {
  const who = <span className="font-semibold">{name}</span>;
  switch (action.kind) {
    case 'paused':
      return <Trans>{who} paused</Trans>;
    case 'resumed':
      return <Trans>{who} resumed</Trans>;
    case 'jumped': {
      const { to } = action;
      return (
        <Trans>
          {who} jumped to {to}
        </Trans>
      );
    }
    case 'started': {
      const { title } = action;
      return (
        <Trans>
          {who} started {title}
        </Trans>
      );
    }
  }
}

/** Over the video: who the party waits for, who did what, what members say, and their reactions. */
export function PartyLayer() {
  const state = useParty();
  const [bubbles, addBubble] = useFleeting(BUBBLE_MS, MAX_BUBBLES);
  const [reactions, addReaction] = useFleeting(REACTION_MS, 12);
  const [actions, addAction] = useFleeting<PartyAction>(ACTION_MS, 1);
  const [showMessages] = useSetting(settings.party.messages);
  const [showReactions] = useSetting(settings.party.reactions);
  usePartyEvent((event) => {
    if (event.type === 'chat' && !event.message.you && showMessages)
      addBubble(event.message.name, event.message.text);
    else if (event.type === 'react' && showReactions)
      addReaction(event.name, event.emoji);
    else if (event.type === 'action') addAction(event.name, event.action);
  });
  if (!state) return null;
  const waitingFor = state.members.filter((m) => m.buffering && !m.you);
  const names = new Intl.ListFormat(formatLocale(), {
    type: 'conjunction',
  }).format(waitingFor.map((m) => m.name));
  const status =
    state.status === 'reconnecting'
      ? t`Reconnecting to the party…`
      : state.group === 'Waiting' && waitingFor.length
        ? t`Waiting for ${names}`
        : null;

  return (
    <div
      data-ui="party-layer"
      className="pointer-events-none fixed inset-0 z-[15]"
    >
      <div className="absolute inset-x-4 top-[calc(5rem+env(safe-area-inset-top))] flex flex-col items-center gap-2">
        {status && (
          <p
            data-ui="party-status"
            className="max-w-full truncate rounded-full bg-black/70 px-4 py-1.5 text-sm font-medium"
          >
            {status}
          </p>
        )}
        {actions.map((a) => (
          <p
            key={a.key}
            data-ui="party-action"
            className="max-w-full truncate rounded-full bg-black/70 px-4 py-1.5 text-sm duration-300 animate-in fade-in-0"
          >
            <ActionLine name={a.name} action={a.text} />
          </p>
        ))}
      </div>
      <div
        data-ui="party-bubbles"
        className="absolute bottom-[calc(7rem+env(safe-area-inset-bottom))] start-[max(1rem,env(safe-area-inset-left))] flex max-w-[min(24rem,70vw)] flex-col items-start gap-2"
      >
        {bubbles.map((b) => (
          <p
            key={b.key}
            className="rounded-2xl bg-black/70 px-3 py-2 text-sm duration-300 animate-in fade-in-0 slide-in-from-bottom-2 [overflow-wrap:anywhere]"
          >
            <span className="font-semibold">{b.name}</span> {b.text}
          </p>
        ))}
      </div>
      <div
        data-ui="party-reactions"
        className="absolute bottom-[calc(7rem+env(safe-area-inset-bottom))] end-[max(1.5rem,env(safe-area-inset-right))] h-64 w-24"
      >
        {reactions.map((r, i) => (
          <span
            key={r.key}
            className={cn(
              'absolute bottom-0 flex flex-col items-center [animation:party-rise_3s_ease-out_forwards]',
              i % 2 ? 'end-2' : 'end-10'
            )}
          >
            <span className="text-4xl">{r.text}</span>
            <span className="rounded-full bg-black/60 px-2 text-xs">
              {r.name}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
