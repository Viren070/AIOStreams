import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import {
  LuCopy,
  LuLink,
  LuLogOut,
  LuQrCode,
  LuShare2,
  LuUserMinus,
} from 'react-icons/lu';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Switch } from '@aiostreams/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@aiostreams/ui/tabs';
import { cn } from '@aiostreams/ui/core/styling';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { formatLocale } from '@/lib/i18n';
import { currentHost } from '@/lib/hosts';
import { settings, useSetting } from '@/lib/settings';
import { rejoinPartyPlayback, usePartyAway } from '@/lib/party/follow';
import { formatCode, inviteLink } from '@/lib/party/invite';
import { partyItemTitle } from '@/lib/party/items';
import {
  party,
  playingEntry,
  relayHost,
  type PartyMember,
  type PartyState,
} from '@/lib/party/party';
import { UserAvatar } from '@/components/user-avatar';
import { QrCode } from './qr-code';
import { closePartySheet, usePartySheetOpen } from './sheet-state';
import { GUTTER, Section } from './common';
import { Chat } from './chat';

type PartyTab = 'chat' | 'party';

export function InParty({ state }: { state: PartyState }) {
  const open = usePartySheetOpen();
  // Alone, the invite is what's wanted first.
  const first: PartyTab = state.members.length > 1 ? 'chat' : 'party';
  const [tab, setTab] = React.useState(first);
  React.useLayoutEffect(() => {
    if (open) setTab(first);
    // Each time the panel opens, not as people come and go.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {state.status !== 'live' && <Connection state={state} />}
      <WatchAlong state={state} />
      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next as PartyTab)}
        variant="pill"
        animated={false}
        className="flex min-h-0 flex-1 flex-col"
        listClass={cn(GUTTER, 'h-auto flex-none gap-1 pb-2')}
        triggerClass="h-9 flex-1 gap-2 rounded-full border-0 data-[state=active]:bg-white/15 data-[state=active]:text-white hover:bg-white/5"
      >
        <TabsList data-ui="party-tabs">
          <TabsTrigger value="chat" data-name="chat">
            <Trans>Chat</Trans>
            {state.unread > 0 && tab !== 'chat' && (
              <span
                data-ui="party-unread"
                className="rounded-full bg-brand-500 px-1.5 text-xs font-semibold leading-5 text-white"
              >
                {state.unread}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="party" data-name="party">
            <Trans>People and invite</Trans>
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="chat"
          data-nav-group
          // Radix keeps the inactive panel with `hidden`, which `flex` would override.
          className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <Chat state={state} />
        </TabsContent>
        <TabsContent
          value="party"
          data-nav-group
          className={cn(
            GUTTER,
            'min-h-0 flex-1 overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]'
          )}
        >
          <PartyDetails state={state} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Connection({ state }: { state: PartyState }) {
  const relay = relayHost(state.invite.relay);
  return (
    <p
      data-ui="party-connection"
      role="status"
      className={cn(GUTTER, 'mb-2 py-2 text-sm text-[--muted]')}
    >
      <span className="block rounded-xl bg-white/5 p-3">
        {state.status === 'joining'
          ? t`Joining the party…`
          : t`Lost the connection to ${relay}. Reconnecting… Your player carries on, and gets back in step once it's back.`}
      </span>
    </p>
  );
}

function PartyDetails({ state }: { state: PartyState }) {
  const host = !!state.members.find((m) => m.you)?.host;
  const [messages, setMessages] = useSetting(settings.party.messages);
  const [reactions, setReactions] = useSetting(settings.party.reactions);
  const [speedSync, setSpeedSync] = useSetting(settings.party.speedSync);
  const watching = state.members.length;
  return (
    <>
      <Invite state={state} />
      <NowPlaying state={state} />
      <Section name="members" title={t`Watching (${watching})`}>
        <ul className="space-y-1">
          {state.members.map((member) => (
            <Member key={member.id} member={member} host={host} />
          ))}
        </ul>
      </Section>
      {host && (
        <Section name="host" title={t`As the host`}>
          <Switch
            side="right"
            label={t`Only I control playback`}
            value={state.lock.control}
            onValueChange={(control) => party.lock({ control })}
          />
          <Switch
            side="right"
            label={t`Let new people join`}
            value={!state.lock.joins}
            onValueChange={(open) => party.lock({ joins: !open })}
          />
        </Section>
      )}
      <Section name="overlay" title={t`Over the video`}>
        <p className="text-xs text-[--muted]">
          <Trans>
            What others send shows over the video for a few seconds. It always
            stays in the chat.
          </Trans>
        </p>
        <Switch
          side="right"
          label={t`Messages`}
          value={messages}
          onValueChange={setMessages}
        />
        <Switch
          side="right"
          label={t`Reactions`}
          value={reactions}
          onValueChange={setReactions}
        />
      </Section>
      <Section name="sync" title={t`Keeping in step`}>
        <Switch
          side="right"
          label={t`Change speed to catch up`}
          help={t`Off, the video jumps instead.`}
          value={speedSync}
          onValueChange={setSpeedSync}
        />
      </Section>
      <Section name="leave">
        <Button
          intent="gray-outline"
          className="w-full rounded-full"
          leftIcon={<LuLogOut className="rtl:-scale-x-100" />}
          onClick={() => {
            party.leave();
            closePartySheet();
          }}
        >
          <Trans>Leave the party</Trans>
        </Button>
      </Section>
    </>
  );
}

function Invite({ state }: { state: PartyState }) {
  const [showQr, setShowQr] = React.useState(!!currentHost().tv);
  const link = inviteLink(state.invite);
  const copy = (text: string, done: string, failed: string) =>
    copyToClipboard(text, {
      onSuccess: () => toast.success(done),
      onError: () => toast.error(failed),
    });
  const relay = relayHost(state.invite.relay);
  return (
    <Section name="invite" title={t`Invite`}>
      <div className="rounded-xl bg-white/5 p-4 text-center">
        <p
          data-ui="party-code"
          className="font-mono text-3xl font-semibold tracking-wider"
        >
          {formatCode(state.invite.code)}
        </p>
        <p className="mt-1 truncate text-xs text-[--muted]">
          <Trans>on {relay}</Trans>
        </p>
        {showQr && (
          <div className="mx-auto mt-4 w-44 overflow-hidden rounded-lg">
            <QrCode text={link} className="h-auto w-full" />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          intent="gray-outline"
          size="sm"
          className="rounded-full"
          leftIcon={<LuLink />}
          onClick={() =>
            copy(link, t`Invite link copied`, t`Could not copy the invite link`)
          }
        >
          <Trans>Copy link</Trans>
        </Button>
        <Button
          intent="gray-outline"
          size="sm"
          className="rounded-full"
          leftIcon={<LuCopy />}
          onClick={() =>
            copy(
              formatCode(state.invite.code),
              t`Code copied`,
              t`Could not copy the code`
            )
          }
        >
          <Trans>Copy code</Trans>
        </Button>
        <Button
          intent="gray-outline"
          size="sm"
          className="rounded-full"
          leftIcon={<LuQrCode />}
          onClick={() => setShowQr((v) => !v)}
        >
          {showQr ? t`Hide QR code` : t`QR code`}
        </Button>
        {typeof navigator.share === 'function' && (
          <IconButton
            intent="gray-outline"
            size="sm"
            className="rounded-full"
            icon={<LuShare2 />}
            aria-label={t`Share the invite`}
            onClick={() =>
              void navigator
                .share({ title: t`Watch together`, url: link })
                .catch(() => {})
            }
          />
        )}
      </div>
    </Section>
  );
}

const playingTitle = (state: PartyState) => {
  const playing = playingEntry(state);
  if (!playing) return null;
  return playing.item
    ? partyItemTitle(playing.item)
    : t`Something this device cannot read`;
};

/** Above both tabs, since leaving the player is when someone opens the panel. */
function WatchAlong({ state }: { state: PartyState }) {
  const away = usePartyAway();
  const title = playingTitle(state);
  if (!away || !title) return null;
  return (
    <div data-ui="party-watch-along" className={cn(GUTTER, 'mb-2 flex-none')}>
      <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
        <p className="min-w-0 flex-1 text-sm">
          <Trans>
            The party is watching <span className="font-semibold">{title}</span>
          </Trans>
        </p>
        <Button
          intent="white"
          size="sm"
          className="flex-none rounded-full"
          onClick={() => {
            rejoinPartyPlayback();
            closePartySheet();
          }}
        >
          <Trans>Watch along</Trans>
        </Button>
      </div>
    </div>
  );
}

function NowPlaying({ state }: { state: PartyState }) {
  const title = playingTitle(state);
  return (
    <Section name="now-playing" title={t`Playing`}>
      {title ? (
        <p className="text-sm font-semibold">{title}</p>
      ) : (
        <p className="text-sm text-[--muted]">
          <Trans>
            Nothing yet. Anything anyone plays now plays for everyone.
          </Trans>
        </p>
      )}
    </Section>
  );
}

function offsetLabel(offsetMs: number | undefined): string | null {
  if (offsetMs === undefined) return null;
  const seconds = (Math.abs(offsetMs) / 1000).toLocaleString(formatLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return offsetMs > 0 ? t`${seconds}s behind` : t`${seconds}s ahead`;
}

function Member({ member, host }: { member: PartyMember; host: boolean }) {
  const status = member.away
    ? t`Connection lost`
    : member.buffering
      ? t`Loading`
      : offsetLabel(member.offsetMs);
  const name = member.name;
  return (
    <li
      data-ui="party-member"
      data-you={member.you || undefined}
      data-host={member.host || undefined}
      data-away={member.away || undefined}
      data-buffering={member.buffering || undefined}
      className="flex items-center gap-3 rounded-xl p-2"
    >
      <UserAvatar name={member.name} src={member.avatar} className="size-9" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {member.name}
          {member.you && (
            <span className="font-normal text-[--muted]">
              {' '}
              <Trans>(you)</Trans>
            </span>
          )}
        </p>
        <p className="truncate text-xs text-[--muted]">
          {[member.host && t`Host`, status].filter(Boolean).join(' · ') ||
            t`Watching`}
        </p>
      </div>
      {host && !member.you && (
        <IconButton
          intent="alert-subtle"
          size="sm"
          className="rounded-full"
          icon={<LuUserMinus />}
          aria-label={t`Remove ${name}`}
          onClick={() => party.kick(member.id)}
        />
      )}
    </li>
  );
}
