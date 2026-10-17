import React from 'react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import {
  LuCopy,
  LuLink,
  LuLogOut,
  LuQrCode,
  LuSend,
  LuShare2,
  LuUserMinus,
} from 'react-icons/lu';
import { Drawer } from '@aiostreams/ui/drawer';
import { Button, IconButton } from '@aiostreams/ui/button';
import { TextInput } from '@aiostreams/ui/text-input';
import { Switch } from '@aiostreams/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@aiostreams/ui/tabs';
import { cn } from '@aiostreams/ui/core/styling';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import type { PartyListing } from '@aiostreams/core';
import { clock } from '../../lib/format';
import { formatLocale } from '../../lib/i18n';
import { currentHost } from '../../lib/hosts';
import { focusOn, useRestoreFocus } from '../../lib/input';
import { useSession } from '../../lib/session';
import { settings, useSetting } from '../../lib/settings';
import {
  usePartyActions,
  usePartyRelays,
  type RelayChoice,
} from '../../lib/party/actions';
import {
  canFollow,
  rejoinPartyPlayback,
  usePartyAway,
} from '../../lib/party/follow';
import {
  formatCode,
  inviteLink,
  parseInvite,
  relayBase,
  type Invite as PartyInvite,
} from '../../lib/party/invite';
import { partyItemTitle } from '../../lib/party/items';
import {
  PARTY_OUTBOX,
  party,
  playingEntry,
  relayHost,
  useParty,
  type PartyMember,
  type PartyMessage,
  type PartyPreview,
  type PartyState,
} from '../../lib/party/party';
import { UserAvatar } from '../user-avatar';
import { QrCode } from './qr-code';
import { PARTY_REACTIONS } from './reactions';

interface Opening {
  /** What starting a party plays for it, once it has started. */
  play?: { title: string; run(): unknown };
  /** A party to look at before joining. */
  invite?: PartyInvite;
}

let sheet: { open: boolean; opening: Opening } = { open: false, opening: {} };
const sheetListeners = new Set<() => void>();

function setSheet(next: Partial<typeof sheet>): void {
  sheet = { ...sheet, ...next };
  for (const listener of sheetListeners) listener();
}

export const openPartySheet = (opening: Opening = {}) =>
  setSheet({ open: true, opening });

export const closePartySheet = () => setSheet({ open: false });

const showInvite = (invite?: PartyInvite) =>
  setSheet({ opening: { ...sheet.opening, invite } });

function useSheet() {
  return React.useSyncExternalStore(
    (listener) => {
      sheetListeners.add(listener);
      return () => void sheetListeners.delete(listener);
    },
    () => sheet
  );
}

export const usePartySheetOpen = () => useSheet().open;

/** Content clear of a landscape phone's notch on the right. */
const GUTTER = 'ps-4 pe-[max(1rem,env(safe-area-inset-right))]';

/** The watch party panel: starting or joining one, then the party itself. */
export function PartySheet() {
  const { open, opening } = useSheet();
  const state = useParty();
  const restoreFocus = useRestoreFocus(open);
  const invite =
    opening.invite && !isCurrent(opening.invite, state)
      ? opening.invite
      : undefined;
  return (
    <Drawer
      data-ui="dialog"
      data-name="party"
      open={open}
      onOpenChange={(next) => !next && closePartySheet()}
      onCloseAutoFocus={restoreFocus}
      title={
        invite ? t`Join a party` : state ? t`Watch party` : t`Watch together`
      }
      side="right"
      // Narrow, so a phone on its side keeps most of the video in view.
      size="sm"
      contentClass="flex flex-col gap-0 overflow-hidden p-0"
      headerClass={cn(GUTTER, 'pb-3 pt-[calc(1rem+env(safe-area-inset-top))]')}
      closeClass="end-[max(0.5rem,env(safe-area-inset-right))] top-[calc(0.75rem+env(safe-area-inset-top))]"
    >
      {state && !invite ? (
        <InParty state={state} />
      ) : (
        <div
          data-nav-group
          className={cn(
            GUTTER,
            'min-h-0 flex-1 overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]'
          )}
        >
          {invite ? (
            <JoinPreview invite={invite} inParty={!!state} />
          ) : (
            <NotInParty opening={opening} />
          )}
        </div>
      )}
    </Drawer>
  );
}

const isCurrent = (invite: PartyInvite, state: PartyState | null) =>
  state?.invite.relay === invite.relay && state.invite.code === invite.code;

function Section({
  title,
  children,
  name,
}: {
  title?: string;
  children: React.ReactNode;
  name: string;
}) {
  return (
    <section
      data-ui="party-section"
      data-name={name}
      className="space-y-3 py-4"
    >
      {title && (
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[--muted]">
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

function relayLabel(relay: RelayChoice): string {
  return relay.own ? t`This server` : relayHost(relay.base);
}

function NotInParty({ opening }: { opening: Opening }) {
  const relays = usePartyRelays();
  const actions = usePartyActions();
  const [picked, setPicked] = React.useState(0);
  const [other, setOther] = React.useState('');
  const [starting, setStarting] = React.useState(false);
  const [code, setCode] = React.useState('');
  const custom = picked === relays.length;
  const relay = custom ? relayBase(other) : relays[picked]?.base;

  const start = async () => {
    if (!relay) return void toast.error(t`Enter the address of a relay`);
    setStarting(true);
    try {
      await actions.start(relay);
      if (opening.play) {
        // The player's own party button shows the invite from there.
        closePartySheet();
        await opening.play.run();
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t`Could not start a party`
      );
    } finally {
      setStarting(false);
    }
  };
  const join = () => {
    const invite = parseInvite(code, relay);
    if (!invite)
      return void toast.error(t`Enter an invite link, or a code and its relay`);
    showInvite(invite);
  };

  return (
    <>
      {!canFollow() && (
        <p className="rounded-xl bg-white/5 p-3 text-sm text-[--muted]">
          <Trans>
            Your player plays in another app, which can't follow a party. Choose
            the app's own player in settings to watch along.
          </Trans>
        </p>
      )}
      <Section name="start" title={t`Start a party`}>
        {opening.play && (
          <p className="text-sm">
            <PlaysForEveryone title={opening.play.title} />
          </p>
        )}
        <div role="radiogroup" aria-label={t`Relay`} className="space-y-2">
          {[...relays, null].map((choice, i) => (
            <RelayOption
              key={choice?.base ?? 'other'}
              checked={picked === i}
              onPick={() => setPicked(i)}
              title={choice ? relayLabel(choice) : t`Another relay`}
              help={
                choice
                  ? choice.open
                    ? t`Anyone with the invite can join, from any server.`
                    : t`Only people signed in to this server can join.`
                  : t`A relay someone else runs, for people on other servers.`
              }
            />
          ))}
        </div>
        {custom && (
          <TextInput
            label={t`Relay address`}
            placeholder="https://relay.example.com"
            value={other}
            onValueChange={setOther}
            spellCheck={false}
            autoComplete="url"
          />
        )}
        <Button
          intent="white"
          className="w-full rounded-full"
          loading={starting}
          onClick={() => void start()}
        >
          <Trans>Start a party</Trans>
        </Button>
      </Section>
      <Section name="join" title={t`Join a party`}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <TextInput
            aria-label={t`Invite code or link`}
            placeholder={t`Code or invite link`}
            value={code}
            onValueChange={setCode}
            spellCheck={false}
            autoCapitalize="characters"
            className="flex-1"
          />
          <Button type="submit" intent="gray-outline" className="rounded-full">
            <Trans>Join</Trans>
          </Button>
        </form>
        <p className="text-xs text-[--muted]">
          <Trans>A code is looked up on the relay picked above.</Trans>
        </p>
        <Household onJoin={showInvite} />
      </Section>
    </>
  );
}

function RelayOption({
  checked,
  onPick,
  title,
  help,
}: {
  checked: boolean;
  onPick(): void;
  title: string;
  help: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      data-ui="party-relay"
      onClick={onPick}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]',
        checked
          ? 'border-white/40 bg-white/10'
          : 'border-white/10 hover:bg-white/5'
      )}
    >
      <span
        className={cn(
          'mt-0.5 size-4 flex-none rounded-full border-2',
          checked
            ? 'border-white bg-white shadow-[inset_0_0_0_3px_#000]'
            : 'border-white/40'
        )}
      />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-[--muted]">{help}</span>
      </span>
    </button>
  );
}

/** Parties this server's other users have going, which need no invite. */
function Household({ onJoin }: { onJoin(invite: PartyInvite): void }) {
  const { client } = useSession();
  const relays = usePartyRelays();
  const own = relays.find((r) => r.own)?.base;
  const list = useQuery({
    queryKey: ['party-list', own, client.token],
    queryFn: async () => {
      const res = await fetch(`${own}/party/v1/parties`, {
        headers: { Authorization: `MediaBrowser Token="${client.token}"` },
      });
      if (!res.ok) return [];
      return ((await res.json()) as { parties: PartyListing[] }).parties;
    },
    enabled: !!own && !!client.token,
    refetchInterval: 10_000,
  });
  const parties = list.data ?? [];
  if (!parties.length) return null;
  return (
    <div className="space-y-2 pt-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-[--muted]">
        <Trans>On this server</Trans>
      </p>
      {parties.map((p) => {
        const { host, members } = p;
        return (
          <div
            key={p.party}
            data-ui="party-listing"
            className="flex items-center gap-3 rounded-xl bg-white/5 p-3"
          >
            <UserAvatar name={p.host} className="size-9" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                <Trans>{host}'s party</Trans>
              </p>
              <p className="text-xs text-[--muted]">
                {plural(members, { one: '# watching', other: '# watching' })}
              </p>
            </div>
            <Button
              intent="gray-outline"
              size="sm"
              className="rounded-full"
              onClick={() => onJoin({ relay: own!, code: p.code })}
            >
              <Trans>Join</Trans>
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function JoinPreview({
  invite,
  inParty,
}: {
  invite: PartyInvite;
  inParty: boolean;
}) {
  const actions = usePartyActions();
  const [joining, setJoining] = React.useState(false);
  const preview = useQuery({
    queryKey: ['party-preview', invite.relay, invite.code],
    queryFn: () => actions.peek(invite),
    retry: false,
    gcTime: 0,
  });
  const join = async () => {
    setJoining(true);
    try {
      await actions.join(invite);
      showInvite();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t`Could not join`);
    } finally {
      setJoining(false);
    }
  };
  const found = preview.data;
  const joinButton = React.useRef<HTMLButtonElement>(null);
  // A remote is on Join as soon as there is something to join.
  React.useEffect(() => {
    const join = joinButton.current;
    if (join && found && !found.full && currentHost().tv) focusOn(join);
  }, [found]);
  return (
    <Section name="preview">
      <div
        data-ui="party-preview"
        className="space-y-3 rounded-xl bg-white/5 p-4"
      >
        {found ? (
          <PreviewDetails preview={found} relay={invite.relay} />
        ) : (
          <p
            role={preview.error ? 'alert' : 'status'}
            className="text-sm text-[--muted]"
          >
            {preview.error?.message ?? t`Looking for the party…`}
          </p>
        )}
      </div>
      {inParty && found && (
        <p className="text-xs text-[--muted]">
          <Trans>Joining leaves the party you're in.</Trans>
        </p>
      )}
      <div className="flex gap-2">
        {preview.error ? (
          <Button
            intent="white"
            className="flex-1 rounded-full"
            loading={preview.isFetching}
            onClick={() => void preview.refetch()}
            autoFocus
          >
            <Trans>Try again</Trans>
          </Button>
        ) : (
          <Button
            ref={joinButton}
            intent="white"
            className="flex-1 rounded-full"
            disabled={!found || found.full}
            loading={joining}
            onClick={() => void join()}
          >
            {found?.full ? t`The party is full` : t`Join`}
          </Button>
        )}
        <Button
          intent="gray-outline"
          className="rounded-full"
          onClick={() => showInvite()}
        >
          <Trans>Back</Trans>
        </Button>
      </div>
    </Section>
  );
}

function nameList(names: string[]): string {
  const rest = names.length - 2;
  const shown =
    names.length > 3
      ? [...names.slice(0, 2), plural(rest, { one: '# more', other: '# more' })]
      : names;
  return new Intl.ListFormat(formatLocale(), { type: 'conjunction' }).format(
    shown
  );
}

/** What starting a party plays, for everyone who joins. */
function PlaysForEveryone({ title }: { title: string }) {
  return (
    <Trans>
      Plays <span className="font-semibold">{title}</span> for everyone who
      joins.
    </Trans>
  );
}

function PlayingLine({
  playing,
}: {
  playing: NonNullable<PartyPreview['playing']>;
}) {
  const { title } = playing;
  const at = clock(playing.positionMs);
  const started = playing.positionMs >= 1_000;
  const name = <span className="font-semibold">{title}</span>;
  if (playing.paused)
    return started ? (
      <Trans>
        Paused on {name}, {at} in
      </Trans>
    ) : (
      <Trans>Paused on {name}</Trans>
    );
  return started ? (
    <Trans>
      Watching {name}, {at} in
    </Trans>
  ) : (
    <Trans>Watching {name}</Trans>
  );
}

function PreviewDetails({
  preview,
  relay,
}: {
  preview: PartyPreview;
  relay: string;
}) {
  const { host, others, playing } = preview;
  const count = others.length + 1;
  const on = relayHost(relay);
  const names = nameList(others);
  return (
    <>
      <div className="flex items-center gap-3">
        <UserAvatar name={host} className="size-10" />
        <div className="min-w-0">
          <p className="truncate font-semibold">
            <Trans>{host}'s party</Trans>
          </p>
          <p className="truncate text-xs text-[--muted]">
            {plural(count, {
              one: `# watching · on ${on}`,
              other: `# watching · on ${on}`,
            })}
          </p>
        </div>
      </div>
      <p className="text-sm">
        {playing ? (
          <PlayingLine playing={playing} />
        ) : (
          <Trans>Nothing playing yet.</Trans>
        )}
      </p>
      {others.length > 0 && (
        <p className="text-sm text-[--muted]">
          <Trans>With {names}</Trans>
        </p>
      )}
    </>
  );
}

type PartyTab = 'chat' | 'party';

function InParty({ state }: { state: PartyState }) {
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
      className="flex items-center gap-3 rounded-xl p-2"
    >
      <UserAvatar name={member.name} className="size-9" />
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

function Reactions({ live, compact }: { live: boolean; compact: boolean }) {
  return (
    <div
      className={cn('flex flex-wrap justify-center gap-2', compact && 'mb-2')}
    >
      {PARTY_REACTIONS.map((emoji) => (
        <button
          key={emoji}
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

function Chat({ state }: { state: PartyState }) {
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
