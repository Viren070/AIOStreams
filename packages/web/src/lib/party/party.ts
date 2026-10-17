import { t } from '@lingui/core/macro';
import React from 'react';
import type {
  GroupCommand,
  GroupStateType,
  PartyChat,
  PartyClientMessage,
  PartyCloseReason,
  PartyErrorCode,
  PartyLock,
  PartyMemberInfo,
  PartyRequest,
  PartyResumeState,
  PartyServerMessage,
  PartyProtocol,
  QueueSnapshot,
  RequestType,
} from '@aiostreams/core';
import { clock } from '../format';
import { partyKeys, seal, unseal, type PartyKeys } from './crypto';
import { newCode, type Invite } from './invite';
import { partyItemTitle, type PartyItem } from './items';
import { askRelay, RelayConnection } from './relay';

/*
 * The party this device is in, at most one. Members' names, chat and what's
 * playing are sealed with the party's key before they leave the device.
 */

export interface PartyMember {
  id: string;
  name: string;
  host: boolean;
  away: boolean;
  buffering: boolean;
  you: boolean;
  offsetMs?: number;
}

export interface PartyMessage {
  key: string;
  from: string;
  name: string;
  text: string;
  at: number;
  you: boolean;
  /** This member's own message before the relay passed it on, or after it refused it. */
  status?: 'sending' | 'failed';
}

export interface PartyEntry {
  playlistItemId: string;
  /** Null when it could not be read. */
  item: PartyItem | null;
  ref: string;
  runtimeMs: number;
}

/** Where the group is: from `positionMs` at `when` (relay clock), moving while playing. */
export interface Timeline {
  playlistItemId: string;
  positionMs: number;
  when: number;
  playing: boolean;
}

export interface PartyState {
  invite: Invite;
  status: 'joining' | 'live' | 'reconnecting';
  you: string | null;
  host: string | null;
  lock: PartyLock;
  members: PartyMember[];
  chat: PartyMessage[];
  group: GroupStateType;
  queue: PartyEntry[];
  playingIndex: number;
  timeline: Timeline | null;
  /** Messages from others since the chat was last seen. */
  unread: number;
}

export type PartyEvent =
  | { type: 'command'; command: GroupCommand }
  | { type: 'chat'; message: PartyMessage }
  | { type: 'react'; from: string; name: string; emoji: string }
  | { type: 'members'; joined?: PartyMember; left?: PartyMember }
  /** Another member paused, jumped or started something. */
  | { type: 'action'; from: string; name: string; action: PartyAction }
  /** The relay turned down a request. */
  | { type: 'notice'; text: string }
  | { type: 'ended'; reason: string };

export interface PartyPreview {
  host: string;
  /** Everyone else in it. */
  others: string[];
  full: boolean;
  playing: { title: string; positionMs: number; paused: boolean } | null;
}

export interface PartyIdentity {
  name: string;
  /** The media server the member is signed in to, and as whom. */
  server: string;
  userId: string;
  /** Proves the member to a relay on that same server. */
  token?: string;
}

const PROTOCOL: PartyProtocol = 1;
const MAX_CHAT = 100;
/** Messages held while the relay is away; the relay takes 5 at once. */
export const PARTY_OUTBOX = 5;
/** Starting or joining waits this long for the relay before giving up. */
const HELLO_MS = 15_000;
/** Offsets the relay shows are rounded to this, and smaller ones not shown. */
const OFFSET_STEP_MS = 500;
const OFFSET_MIN_MS = 1_000;

export const refusal = (code: PartyErrorCode): string =>
  ({
    version: t`That relay runs a different version of watch parties.`,
    invalid: t`The relay could not read that.`,
    'not-found': t`That party has ended.`,
    exists: t`Try starting the party again.`,
    full: t`That party is full.`,
    locked: t`That party is not letting anyone new in.`,
    denied: t`That relay doesn't let you in.`,
    busy: t`That relay is too busy for another party.`,
    rate: t`Too many tries. Wait a moment and try again.`,
    control: t`Only the host controls playback.`,
  })[code];

const ending = (reason: PartyCloseReason): string =>
  ({
    ended: t`The party ended.`,
    removed: t`The host removed you from the party.`,
    idle: t`The party ended after a long time with nothing playing.`,
    left: t`You left the party.`,
  })[reason];

/** The member's token, for a relay on the server it is signed in to only. */
function tokenFor(identity: PartyIdentity, relay: string): string | undefined {
  const { server } = identity;
  const onRelay = relay === server || server.startsWith(`${relay}/`);
  return onRelay ? identity.token : undefined;
}

const titleOf = (item: PartyItem | null) =>
  item ? partyItemTitle(item) : t`something this device cannot read`;

/** What another member did, which the layer over the video says with their name. */
export type PartyAction =
  | { kind: 'paused' }
  | { kind: 'resumed' }
  | { kind: 'jumped'; to: string }
  | { kind: 'started'; title: string };

/** What others see a member's request do. Next is left out: players ask for it when an episode ends. */
function actionOf(
  reason: RequestType | QueueSnapshot['reason'],
  state: PartyState
): PartyAction | null {
  switch (reason) {
    case 'Pause':
      return { kind: 'paused' };
    case 'Unpause':
      return { kind: 'resumed' };
    case 'Seek':
      return state.timeline
        ? { kind: 'jumped', to: clock(state.timeline.positionMs) }
        : null;
    case 'NewPlaylist':
    case 'SetCurrentItem':
    case 'PreviousItem': {
      const playing = playingEntry(state);
      return playing ? { kind: 'started', title: titleOf(playing.item) } : null;
    }
    default:
      return null;
  }
}

export function relayHost(relay: string): string {
  try {
    return new URL(relay).host;
  } catch {
    return relay;
  }
}

/** One party: its connection, keys and what members said. */
class Session {
  state: PartyState;
  readonly connection: RelayConnection;
  private seat?: string;
  private ticket?: string;
  private hostTicket?: string;
  /** What the party played last, which brings it back after the relay restarts. */
  private resumeState?: PartyResumeState;
  private resuming = false;
  private welcomed = false;
  private ended = false;
  private sent = 0;
  /** The offset the relay last heard from here, null when it has none. */
  private offsetSent: number | undefined | null = null;
  private settle?: { resolve(): void; reject(error: Error): void };

  constructor(
    readonly invite: Invite,
    readonly keys: PartyKeys,
    readonly identity: PartyIdentity,
    private readonly mode: 'create' | 'join',
    private readonly onChange: (session: Session) => void,
    private readonly onEvent: (event: PartyEvent) => void,
    private readonly onEnd: (session: Session, reason: string) => void
  ) {
    this.state = {
      invite,
      status: 'joining',
      you: null,
      host: null,
      lock: { control: false, joins: false },
      members: [],
      chat: [],
      group: 'Idle',
      queue: [],
      playingIndex: -1,
      timeline: null,
      unread: 0,
    };
    this.connection = new RelayConnection(invite.relay, {
      hello: () => this.hello(),
      message: (m) => this.receive(m),
      connected: (open) => {
        if (open) return;
        if (this.welcomed) this.patch({ status: 'reconnecting' });
        // Someone waiting on start or join hears now, not after retries.
        else {
          const relay = relayHost(invite.relay);
          this.end(t`Couldn't reach ${relay}.`);
        }
      },
    });
  }

  /** Resolves once the relay lets this member in. */
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.settle = { resolve, reject };
      this.connection.start();
      setTimeout(() => {
        const relay = relayHost(this.invite.relay);
        if (!this.welcomed) this.end(t`${relay} didn't answer.`);
      }, HELLO_MS);
    });
  }

  private get token(): string | undefined {
    return tokenFor(this.identity, this.invite.relay);
  }

  private hello(): PartyClientMessage {
    const name = seal(this.keys.key, this.identity.name);
    const base = { v: PROTOCOL, party: this.keys.id, name };
    if (this.mode === 'create' && !this.welcomed) {
      const token = this.token;
      return {
        t: 'create',
        ...base,
        token,
        code: token ? this.invite.code : undefined,
      };
    }
    if (this.resuming && this.ticket && this.resumeState)
      return {
        t: 'resume',
        ...base,
        ticket: this.ticket,
        state: this.resumeState,
        token: this.token,
        host: this.hostTicket
          ? { ticket: this.hostTicket, lock: this.state.lock }
          : undefined,
      };
    return { t: 'join', ...base, seat: this.seat, token: this.token };
  }

  private patch(next: Partial<PartyState>): void {
    this.state = { ...this.state, ...next };
    this.onChange(this);
  }

  private nameOf(sealed: string): string {
    return unseal<string>(this.keys.key, sealed) ?? t`Someone`;
  }

  private members(list: PartyMemberInfo[]): PartyMember[] {
    return list.map((m) => ({
      id: m.id,
      name: this.nameOf(m.name),
      host: m.host,
      away: m.away,
      buffering: m.buffering,
      you: m.id === this.state.you,
      offsetMs: m.offsetMs,
    }));
  }

  private message(chat: PartyChat): PartyMessage {
    const from = this.state.members.find((m) => m.id === chat.from);
    return {
      key: `${chat.from}:${chat.at}`,
      from: chat.from,
      name: from?.name ?? t`Someone`,
      text: unseal<string>(this.keys.key, chat.text) ?? '',
      at: chat.at,
      you: chat.from === this.state.you,
    };
  }

  private queue(queue: QueueSnapshot): void {
    const entries = queue.playlist.map((p) => ({
      playlistItemId: p.playlistItemId,
      item: unseal<PartyItem>(this.keys.key, p.ref),
      ref: p.ref,
      runtimeMs: p.runtimeMs,
    }));
    const playing = entries[queue.playingIndex];
    // A new item waits for everyone to load it; the relay says no more.
    const opened = queue.reason !== 'Queue' && queue.reason !== 'QueueNext';
    this.patch({
      group:
        // eslint-disable-next-line lingui/no-unlocalized-strings -- SyncPlay's state
        playing && opened && !queue.isPlaying ? 'Waiting' : this.state.group,
      queue: entries,
      playingIndex: queue.playingIndex,
      timeline: playing
        ? {
            playlistItemId: playing.playlistItemId,
            positionMs: queue.startPositionMs,
            when: this.connection.clock.now(),
            playing: queue.isPlaying,
          }
        : null,
    });
  }

  private command(command: GroupCommand): void {
    // The relay forgets offsets at a command, so this one's goes again.
    this.offsetSent = null;
    const timeline: Timeline | null =
      command.command === 'Stop'
        ? null
        : {
            playlistItemId: command.playlistItemId,
            positionMs: command.positionMs,
            when: command.when,
            playing: command.command === 'Unpause',
          };
    this.patch({
      timeline,
      ...(command.command === 'Stop' && { group: 'Idle' as const }),
    });
    this.onEvent({ type: 'command', command });
  }

  private receive(m: PartyServerMessage): void {
    switch (m.t) {
      case 'welcome': {
        this.welcomed = true;
        this.offsetSent = null;
        this.resuming = false;
        this.seat = m.seat;
        this.ticket = m.ticket;
        this.hostTicket = m.host;
        this.state = { ...this.state, you: m.you };
        const members = this.members(m.members);
        this.state = { ...this.state, members };
        const history = m.chat.map((c) => this.message(c));
        const unsent = this.unsent(history);
        this.patch({
          status: 'live',
          host: members.find((x) => x.host)?.id ?? null,
          lock: m.lock,
          group: m.state,
          chat: [...history, ...unsent].slice(-MAX_CHAT),
        });
        for (const message of unsent)
          if (message.status === 'sending') this.sendChat(message);
        this.settle?.resolve();
        this.settle = undefined;
        return;
      }
      case 'members': {
        const members = this.members(m.members);
        const before = this.state.members;
        this.patch({ members, host: members.find((x) => x.host)?.id ?? null });
        const joined = members.find((x) => x.id === m.joined && !x.you);
        const left = before.find((x) => x.id === m.left);
        if (joined || left) this.onEvent({ type: 'members', joined, left });
        return;
      }
      case 'status': {
        const changed = new Map(m.members.map((s) => [s.id, s]));
        const members = this.state.members.map((x) => {
          const s = changed.get(x.id);
          return s
            ? {
                ...x,
                host: s.host,
                away: s.away,
                buffering: s.buffering,
                offsetMs: s.offsetMs,
              }
            : x;
        });
        return this.patch({
          members,
          host: members.find((x) => x.host)?.id ?? null,
        });
      }
      case 'queue':
        this.queue(m.queue);
        this.resumeAt();
        return this.action(m.by, m.queue.reason);
      case 'state':
        this.patch({ group: m.state });
        return this.action(m.by, m.reason);
      case 'command':
        return this.command(m.command);
      case 'chat': {
        const message = this.message(m.message);
        const { chat, unread } = this.state;
        // The relay passing on this member's own message is what sends it.
        const own = message.you
          ? chat.findIndex(
              (c) => c.status === 'sending' && c.text === message.text
            )
          : -1;
        this.patch({
          chat: (own < 0
            ? [...chat, message]
            : chat.map((c, i) => (i === own ? message : c))
          ).slice(-MAX_CHAT),
          unread: message.you ? unread : unread + 1,
        });
        return this.onEvent({ type: 'chat', message });
      }
      case 'react': {
        const emoji = unseal<string>(this.keys.key, m.emoji);
        const from = this.state.members.find((x) => x.id === m.from);
        if (emoji)
          this.onEvent({
            type: 'react',
            from: m.from,
            name: from?.name ?? t`Someone`,
            emoji,
          });
        return;
      }
      case 'lock':
        return this.patch({ lock: m.lock });
      case 'host':
        this.hostTicket = m.ticket;
        return;
      case 'error':
        return this.refused(m.code);
      case 'closed':
        return this.end(ending(m.reason));
    }
  }

  private action(
    by: string | undefined,
    reason: RequestType | QueueSnapshot['reason']
  ): void {
    if (!by || by === this.state.you) return;
    const action = actionOf(reason, this.state);
    const name = this.state.members.find((m) => m.id === by)?.name;
    if (action)
      this.onEvent({
        type: 'action',
        from: by,
        name: name ?? t`Someone`,
        action,
      });
  }

  private refused(code: PartyErrorCode): void {
    // A rejoin after the relay restarted brings the party back from its ticket.
    if (
      code === 'not-found' &&
      !this.resuming &&
      this.ticket &&
      this.resumeState
    ) {
      this.resuming = true;
      this.connection.send(this.hello());
      return;
    }
    if (code === 'not-found' && !this.welcomed) {
      const relay = relayHost(this.invite.relay);
      return this.end(t`No party has that code on ${relay}.`);
    }
    // Inside a party only chat is rate limited, and the relay answers in order.
    const sending = this.state.chat.find((c) => c.status === 'sending');
    if (this.welcomed && code === 'rate' && sending)
      return this.setStatus(sending.key, 'failed');
    // These turn down one request; the rest turn down the member.
    if (
      this.welcomed &&
      (code === 'control' || code === 'rate' || code === 'invalid')
    )
      return this.onEvent({ type: 'notice', text: refusal(code) });
    this.end(refusal(code));
  }

  end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.connection.stop();
    if (this.settle) {
      this.settle.reject(new Error(reason));
      this.settle = undefined;
    }
    this.onEnd(this, reason);
  }

  send(message: PartyClientMessage): void {
    this.connection.send(message);
  }

  offset(behindMs: number): void {
    if (!this.connection.clock.synced) return;
    const offsetMs =
      Math.abs(behindMs) < OFFSET_MIN_MS
        ? undefined
        : Math.round(behindMs / OFFSET_STEP_MS) * OFFSET_STEP_MS;
    if (offsetMs === this.offsetSent) return;
    this.offsetSent = offsetMs;
    this.send({ t: 'offset', offsetMs });
  }

  sealed(value: unknown): string {
    return seal(this.keys.key, value);
  }

  /** Shows at once; goes out now, or once the relay is back. */
  chat(text: string): void {
    const you = this.state.members.find((m) => m.you);
    const message: PartyMessage = {
      key: `local:${++this.sent}`,
      from: this.state.you ?? '',
      name: you?.name ?? this.identity.name,
      text,
      at: Date.now(),
      you: true,
      status: 'sending',
    };
    this.patch({ chat: [...this.state.chat, message].slice(-MAX_CHAT) });
    this.sendChat(message);
  }

  retry(key: string): void {
    const message = this.state.chat.find((m) => m.key === key);
    if (message?.status !== 'failed') return;
    this.setStatus(key, 'sending');
    this.sendChat(message);
  }

  markRead(): void {
    if (this.state.unread) this.patch({ unread: 0 });
  }

  setTimeline(timeline: Timeline): void {
    this.patch({ timeline });
  }

  private sendChat(message: PartyMessage): void {
    if (this.state.status === 'live')
      this.connection.send(
        { t: 'chat', text: this.sealed(message.text) },
        true
      );
  }

  private setStatus(key: string, status: PartyMessage['status']): void {
    this.patch({
      chat: this.state.chat.map((m) => (m.key === key ? { ...m, status } : m)),
    });
  }

  /** This member's messages that the relay's history shows it never got. */
  private unsent(history: PartyMessage[]): PartyMessage[] {
    const matched = new Set<PartyMessage>();
    return this.state.chat.filter((m) => {
      if (!m.status) return false;
      const echo = history.find(
        (h) => h.you && h.text === m.text && !matched.has(h)
      );
      if (!echo) return true;
      matched.add(echo);
      return false;
    });
  }

  resumeAt(positionMs?: number): void {
    const { queue, playingIndex, timeline } = this.state;
    if (!queue.length || !timeline) return;
    this.resumeState = {
      items: queue.map((e) => ({ ref: e.ref, runtimeMs: e.runtimeMs })),
      index: Math.max(playingIndex, 0),
      positionMs: positionMs ?? timeline.positionMs,
      playing: timeline.playing,
    };
  }
}

let session: Session | null = null;
/** An invite that came in before anyone was signed in to take it. */
let held: Invite | null = null;
const listeners = new Set<() => void>();
const eventListeners = new Set<(event: PartyEvent) => void>();

const notify = () => {
  for (const listener of listeners) listener();
};
const emit = (event: PartyEvent) => {
  for (const listener of eventListeners) listener(event);
};

/** The party this device is in stays until the new one lets it in, so a failed join leaves it there. */
async function enter(
  invite: Invite,
  identity: PartyIdentity,
  mode: 'create' | 'join'
): Promise<void> {
  const keys = await partyKeys(invite.code);
  const previous = session;
  const next: Session = new Session(
    invite,
    keys,
    identity,
    mode,
    (s) => s === session && notify(),
    (event) => next === session && emit(event),
    (s, reason) => {
      if (s !== session) return;
      session = null;
      notify();
      emit({ type: 'ended', reason });
    }
  );
  if (!previous) {
    session = next;
    notify();
  }
  await next.open();
  if (!previous) return;
  session = next;
  previous.send({ t: 'leave' });
  previous.end(ending('left'));
  notify();
}

export const party = {
  state: (): PartyState | null => session?.state ?? null,
  clock: () => session?.connection.clock ?? null,

  start: (relay: string, identity: PartyIdentity) =>
    enter({ relay, code: newCode() }, identity, 'create'),

  join: (invite: Invite, identity: PartyIdentity) =>
    enter(invite, identity, 'join'),

  async peek(invite: Invite, identity: PartyIdentity): Promise<PartyPreview> {
    const { id, key } = await partyKeys(invite.code);
    const relay = relayHost(invite.relay);
    const answer = await askRelay(invite.relay, {
      t: 'peek',
      v: PROTOCOL,
      party: id,
      token: tokenFor(identity, invite.relay),
    }).catch(() => {
      throw new Error(t`Couldn't reach ${relay}.`);
    });
    if (answer.t === 'error')
      throw new Error(
        answer.code === 'not-found'
          ? t`No party has that code on ${relay}.`
          : refusal(answer.code)
      );
    if (answer.t !== 'preview') throw new Error(t`${relay} didn't answer.`);
    const { members, playing, state, full } = answer.preview;
    const name = (sealed: string) => unseal<string>(key, sealed) ?? t`Someone`;
    const host = members.find((m) => m.host);
    return {
      host: host ? name(host.name) : t`Someone`,
      others: members.filter((m) => m !== host).map((m) => name(m.name)),
      full,
      playing: playing && {
        title: titleOf(unseal<PartyItem>(key, playing.ref)),
        positionMs: playing.positionMs,
        paused: state === 'Paused',
      },
    };
  },

  hold(invite: Invite): void {
    held = invite;
    notify();
  },

  takeHeld(): Invite | null {
    const invite = held;
    held = null;
    return invite;
  },

  leave(): void {
    if (!session) return;
    session.send({ t: 'leave' });
    session.end(ending('left'));
  },

  request(request: PartyRequest): void {
    session?.send({ t: 'request', request });
  },

  /** A queue entry for what the starter plays. */
  entry(item: PartyItem): { ref: string; runtimeMs: number } | null {
    return session
      ? { ref: session.sealed(item), runtimeMs: item.runtimeMs ?? 0 }
      : null;
  },

  /** How far behind the party this member plays, which the relay hears as it changes. */
  offset(behindMs: number): void {
    session?.offset(behindMs);
  },

  /** Where the party plays, for bringing it back after the relay restarts. */
  resumeAt(positionMs: number): void {
    session?.resumeAt(positionMs);
  },

  chat(text: string): void {
    const trimmed = text.trim().slice(0, 500);
    if (session && trimmed) session.chat(trimmed);
  },

  retryChat(key: string): void {
    session?.retry(key);
  },

  markRead(): void {
    session?.markRead();
  },

  /**
   * A member the group waited for plays on from where it is, and the group
   * resumes as it gets there; only the others are told.
   */
  playOn(playlistItemId: string, positionMs: number, when: number): void {
    session?.setTimeline({ playlistItemId, positionMs, when, playing: true });
  },

  react(emoji: string): void {
    if (session?.state.status !== 'live') return;
    session.send({ t: 'react', emoji: session.sealed(emoji) });
    const you = session.state.members.find((m) => m.you);
    emit({ type: 'react', from: you?.id ?? '', name: you?.name ?? '', emoji });
  },

  kick(member: string): void {
    session?.send({ t: 'kick', member });
  },

  lock(lock: Partial<PartyLock>): void {
    session?.send({ t: 'lock', ...lock });
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },

  on(listener: (event: PartyEvent) => void): () => void {
    eventListeners.add(listener);
    return () => void eventListeners.delete(listener);
  },
};

export function useParty(): PartyState | null {
  return React.useSyncExternalStore(party.subscribe, party.state);
}

export function usePartyEvent(listener: (event: PartyEvent) => void): void {
  const latest = React.useRef(listener);
  latest.current = listener;
  React.useEffect(() => party.on((event) => latest.current(event)), []);
}

/** What the party plays now; nothing once it stopped. */
export function playingEntry(state: PartyState | null): PartyEntry | null {
  if (!state?.timeline) return null;
  return state.queue[state.playingIndex] ?? null;
}

/** Where the timeline puts the group at relay time `now`. */
export function positionAt(timeline: Timeline, now: number): number {
  return timeline.playing && now > timeline.when
    ? timeline.positionMs + (now - timeline.when)
    : timeline.positionMs;
}
