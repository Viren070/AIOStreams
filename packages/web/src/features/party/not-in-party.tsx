import React from 'react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@aiostreams/ui/button';
import { TextInput } from '@aiostreams/ui/text-input';
import { cn } from '@aiostreams/ui/core/styling';
import type { PartyListing } from '@aiostreams/core';
import { clock } from '@/lib/format';
import { formatLocale } from '@/lib/i18n';
import { currentHost } from '@/lib/hosts';
import { focusOn } from '@/lib/input';
import { useSession } from '@/lib/jellyfin/session';
import {
  usePartyActions,
  usePartyRelays,
  type RelayChoice,
} from '@/lib/party/actions';
import { canFollow } from '@/lib/party/follow';
import {
  parseInvite,
  relayBase,
  type Invite as PartyInvite,
} from '@/lib/party/invite';
import { relayHost, type PartyPreview } from '@/lib/party/party';
import { UserAvatar } from '@/components/user-avatar';
import { type Opening, closePartySheet, showInvite } from './sheet-state';
import { Section } from './common';

function relayLabel(relay: RelayChoice): string {
  return relay.own ? t`This server` : relayHost(relay.base);
}

export function NotInParty({ opening }: { opening: Opening }) {
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
            <UserAvatar name={p.host} src={p.avatar} className="size-9" />
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

export function JoinPreview({
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
  const { host, hostAvatar, others, playing } = preview;
  const count = others.length + 1;
  const on = relayHost(relay);
  const names = nameList(others);
  return (
    <>
      <div className="flex items-center gap-3">
        <UserAvatar name={host} src={hostAvatar} className="size-10" />
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
