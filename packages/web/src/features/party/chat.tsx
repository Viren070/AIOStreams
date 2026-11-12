import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { LuSend } from 'react-icons/lu';
import { IconButton } from '@aiostreams/ui/button';
import { TextInput } from '@aiostreams/ui/text-input';
import { cn } from '@aiostreams/ui/core/styling';
import { currentHost } from '@/lib/hosts';
import { settings, useSetting } from '@/lib/settings';
import {
  PARTY_OUTBOX,
  party,
  type PartyMessage,
  type PartyState,
} from '@/lib/party/party';
import { GUTTER } from './common';

function Reactions({ live, compact }: { live: boolean; compact: boolean }) {
  const [reactions] = useSetting(settings.party.reactionSet);
  return (
    <div
      className={cn('flex flex-wrap justify-center gap-2', compact && 'mb-2')}
    >
      {reactions.map((emoji, i) => (
        <button
          key={i}
          type="button"
          data-ui="party-reaction"
          aria-label={t`React with ${emoji}`}
          disabled={!live}
          onClick={() => party.react(emoji)}
          className={cn(
            'flex items-center justify-center rounded-full bg-white/5 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] disabled:opacity-40',
            compact ? 'size-9 text-xl' : 'size-12 text-2xl'
          )}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export function Chat({ state }: { state: PartyState }) {
  const tv = !!currentHost().tv;
  const [text, setText] = React.useState('');
  const list = React.useRef<HTMLDivElement>(null);
  /** Following the newest message, unless scrolled up to read. */
  const atEnd = React.useRef(true);
  const { chat } = state;
  const last = chat[chat.length - 1];
  const live = state.status === 'live';
  const held = chat.filter((m) => m.status === 'sending').length;
  const full = !live && held >= PARTY_OUTBOX;

  // Read once it's on screen.
  React.useEffect(() => party.markRead(), [last]);
  React.useLayoutEffect(() => {
    const box = list.current;
    if (box && (atEnd.current || last?.you)) box.scrollTop = box.scrollHeight;
  }, [last]);

  return (
    <>
      <div
        ref={list}
        data-ui="party-chat"
        onScroll={(e) => {
          const box = e.currentTarget;
          atEnd.current =
            box.scrollHeight - box.scrollTop - box.clientHeight < 40;
        }}
        className={cn(GUTTER, 'min-h-0 flex-1 overflow-y-auto pb-3')}
      >
        {chat.length ? (
          <ChatMessages chat={chat} live={live} />
        ) : (
          <p className="pt-6 text-center text-sm text-[--muted]">
            {tv
              ? t`What the others say shows here.`
              : t`No messages yet. Say hello.`}
          </p>
        )}
      </div>
      <div
        className={cn(
          GUTTER,
          'flex-none border-t border-white/10 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]'
        )}
      >
        <Reactions live={live} compact={!tv} />
        {!tv && (
          <form
            data-name="chat"
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim() || full) return;
              atEnd.current = true;
              party.chat(text);
              setText('');
            }}
          >
            <TextInput
              aria-label={t`Message`}
              placeholder={t`Message`}
              value={text}
              onValueChange={setText}
              maxLength={500}
              autoComplete="off"
              enterKeyHint="send"
              fieldClass="min-w-0 flex-1"
              className="rounded-full"
            />
            <IconButton
              type="submit"
              intent="white"
              className="flex-none rounded-full"
              icon={<LuSend className="rtl:-scale-x-100" />}
              aria-label={t`Send`}
              disabled={!text.trim() || full}
            />
          </form>
        )}
        {full && (
          <p className="mt-2 text-xs text-[--muted]">
            <Trans>More can be sent once the party is back.</Trans>
          </p>
        )}
      </div>
    </>
  );
}

function ChatMessages({ chat, live }: { chat: PartyMessage[]; live: boolean }) {
  return chat.map((m, i) => {
    const first = chat[i - 1]?.from !== m.from;
    return (
      <div
        key={m.key}
        data-ui="party-message"
        data-status={m.status}
        data-you={m.you || undefined}
        className={cn(
          'flex flex-col',
          m.you ? 'items-end' : 'items-start',
          first ? 'mt-3' : 'mt-1'
        )}
      >
        {first && !m.you && (
          <span className="mb-1 px-1 text-xs font-semibold text-[--muted]">
            {m.name}
          </span>
        )}
        <p
          className={cn(
            'max-w-[85%] select-text rounded-2xl px-3 py-2 text-sm [overflow-wrap:anywhere]',
            m.you ? 'bg-white/15' : 'bg-white/5',
            m.status && 'opacity-60'
          )}
        >
          {m.text}
        </p>
        {m.status === 'sending' && (
          <span className="mt-1 px-1 text-xs text-[--muted]">
            {live ? t`Sending…` : t`Sends once the party is back`}
          </span>
        )}
        {m.status === 'failed' && (
          <button
            type="button"
            onClick={() => party.retryChat(m.key)}
            className="mt-1 rounded px-1 text-xs text-red-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
          >
            <Trans>Not sent. Try again</Trans>
          </button>
        )}
      </div>
    );
  });
}
