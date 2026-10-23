import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { createHmac, randomBytes } from 'crypto';
import proxyaddr from 'proxy-addr';
import { ipKeyGenerator } from 'express-rate-limit';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  andThen,
  config as appConfig,
  createLogger,
  PARTY_LIMITS,
  PARTY_PROTOCOL,
  sharedBackend,
  SharedTx,
  SyncGroup,
  type GroupMessage,
  type MaybePromise,
  type PartyChat,
  type PartyClientMessage,
  type PartyCloseReason,
  type PartyErrorCode,
  type PartyListing,
  type PartyLock,
  type PartyMemberInfo,
  type PartyPreview,
  type PartyServerMessage,
  type PlaylistItem,
  type SavedGroup,
  type SharedMessage,
} from '@aiostreams/core';
import { isTrustedIp } from '../middlewares/ip.js';
import { userForToken, type TokenUser } from '../routes/jellyfin/context.js';
import { accountName } from '../routes/jellyfin/users.js';
import { AddressBook, Bucket, withinQueue } from './limits.js';
import { parseMessage } from './messages.js';
import { ticketExpiry, ticketFor } from './ticket.js';
import { relayMode } from './mode.js';

/*
 * Parties live in the shared store, so any replica serves any member: a change
 * commits there, and each replica writes what it says to its own members.
 */

const logger = createLogger('party');

const PATH = /^\/party\/v1\/?(?:\?|$)/;
const MAX_PAYLOAD = 64 * 1024;
const MAX_CONNECTIONS = 20_000;
/** A reader this far behind is dropped rather than buffered for. */
const MAX_BUFFERED = 512 * 1024;
const HELLO_MS = 10_000;
const SEAT_GRACE_MS = 60_000;
const IDLE_MS = 6 * 60 * 60_000;
const LIFETIME_MS = 24 * 60 * 60_000;
const HEARTBEAT_MS = 15_000;
/** Longer than the apps go without a ping of their own. */
const QUIET_MS = 35_000;
const GONE_MS = 60_000;
const SWEEP_MS = 60_000;
const PINGS_MS = 5_000;
/** Offsets shown are rounded to this, and smaller ones not shown. */
const OFFSET_STEP_MS = 500;
const OFFSET_MIN_MS = 1_000;
/** Chat keeps a party from idling, noted at most this often. */
const CHAT_ACTIVITY_MS = 60_000;
const MAX_STRIKES = 5;
/** Marks what may take a seat from a connection, so replicas look again. */
const RESEAT = 1;

/** Requests any member makes while only the host controls playback. */
const UNCONTROLLED = new Set(['Buffer', 'Ready', 'IgnoreWait']);

interface Home {
  uuid: string;
  userId: string;
  hidden: boolean;
  code: string;
  host: string;
  avatar?: string;
}

interface Seat {
  id: string;
  key: string;
  name: string;
  avatar?: string;
  /** Its address, keyed, for bans. */
  address: string;
  /** The replica holding its connection; null while it is away. */
  at: string | null;
  /** Its connection's id; one taking the seat over closes the older. */
  conn: string;
  /** When a seat that is away is given up. */
  awayUntil?: number;
  /** How far behind the group it plays, as its app last said. */
  offsetMs?: number;
}

interface Party {
  id: string;
  group: SyncGroup;
  expiresAt: number;
  host: string;
  lock: PartyLock;
  home: Home | null;
  seats: Map<string, Seat>;
  banned: string[];
  lastActivity: number;
}

interface SavedParty extends Omit<Party, 'id' | 'group' | 'seats'> {
  seats: Seat[];
  group: SavedGroup;
}

interface Conn {
  ws: WebSocket;
  id: string;
  address: string;
  party?: string;
  seat?: string;
  /** Seated before its join commits, so what that join says reaches it. */
  pending?: boolean;
  /** The round trip the client last measured, stored a few seconds on. */
  rtt?: number;
  /** When anything last came from the client, ping or not. */
  heard: number;
  strikes: number;
  messages: Bucket;
  /** Made on first use, as most members never chat or react. */
  chats?: Bucket;
  reactions?: Bucket;
  offsets?: Bucket;
  hello?: ReturnType<typeof setTimeout>;
  /** Messages after a hello wait their turn. */
  queue?: Promise<void>;
}

type MemberStatus = Omit<PartyMemberInfo, 'name' | 'avatar'>;

const key = () => randomBytes(16).toString('base64url');
const randomId = () => randomBytes(9).toString('base64url');

const store = sharedBackend();
const parties = store.records<Party>({
  name: 'relay',
  save: saveParty,
  bulk: (party) => party.group.queue.items,
  load: loadParty,
  due: dueOf,
  tags: (party) => {
    const tags = replicasOf(party).map((replica) => `at:${replica}`);
    if (party.home) tags.push('homed');
    return tags;
  },
  replicas: replicasOf,
  before: rosterOf,
  settle: (party, tx, before) => {
    // Offsets measured while playing say nothing once it stops.
    if (party.group.stateType !== 'Playing')
      for (const seat of party.seats.values()) seat.offsetMs = undefined;
    showMembers(party, tx, before as Roster);
  },
  receive,
  lapse,
  orphaned,
  lost,
});

/** This replica's members, by party and seat. */
const here = new Map<string, Map<string, Conn>>();
/** Parties with members here whose round trip moved enough to store. */
const pings = new Set<string>();
const addresses = new AddressBook(32, [20 / 3600, 10], [0.5, 10]);
let stopping = false;

/** The party being changed, which the group's messages go out through. */
let current:
  { party: Party; tx: SharedTx; by?: string; chat?: PartyChat[] } | undefined;

let addressKey: Buffer | undefined;
/** An address as a party keeps it, so the store holds no addresses. */
const keyedAddress = (address: string) =>
  createHmac(
    'sha256',
    (addressKey ??= Buffer.from(
      `party-address:${appConfig.bootstrap.secretKey}`
    ))
  )
    .update(address)
    .digest('base64url')
    .slice(0, 22);

const ticketOf = (party: Party) => ticketFor(party.id, party.expiresAt);
const hostTicketOf = (party: Party) =>
  ticketFor(party.id, party.expiresAt, 'host');

function saveParty(party: Party): SavedParty {
  return {
    expiresAt: party.expiresAt,
    host: party.host,
    lock: party.lock,
    home: party.home,
    seats: [...party.seats.values()],
    banned: party.banned,
    lastActivity: party.lastActivity,
    group: party.group.save(),
  };
}

function loadParty(
  saved: SavedParty,
  items: PlaylistItem[] | null,
  id: string
): Party {
  return {
    ...saved,
    id,
    group: SyncGroup.restore(saved.group, items ?? [], deliver),
    seats: new Map(saved.seats.map((seat) => [seat.id, seat])),
  };
}

function replicasOf(party: Party): string[] {
  const out: string[] = [];
  for (const { at } of party.seats.values())
    if (at && !out.includes(at)) out.push(at);
  return out;
}

function dueOf(party: Party): number {
  let due = Math.min(party.lastActivity + IDLE_MS, party.expiresAt);
  if (party.group.waitDeadline !== null)
    due = Math.min(due, party.group.waitDeadline);
  for (const { awayUntil } of party.seats.values())
    if (awayUntil !== undefined) due = Math.min(due, awayUntil);
  return due;
}

/**
 * A whole text frame. A server's frames are unmasked, so one encoding is the
 * very bytes every member gets.
 */
function encode(message: PartyServerMessage): Buffer {
  const json = JSON.stringify(message);
  const length = Buffer.byteLength(json);
  const head = length < 126 ? 2 : length < 65_536 ? 4 : 10;
  const frame = Buffer.allocUnsafe(head + length);
  frame[0] = 0x81;
  if (head === 2) frame[1] = length;
  else if (head === 4) {
    frame[1] = 126;
    frame.writeUInt16BE(length, 2);
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
  }
  frame.write(json, head);
  return frame;
}

/**
 * Sockets hold what they are sent until this turn of the event loop ends, so
 * all a change sends one member is one write.
 */
const corked = new Set<Duplex>();
let flushing: ReturnType<typeof setImmediate> | null = null;

function flush(): void {
  for (const socket of corked) socket.uncork();
  corked.clear();
  flushing = null;
}

/** `now` for what is timed, which goes out at once with whatever it waited behind. */
function sendData(
  conn: Conn | null | undefined,
  frame: Buffer,
  now = false
): void {
  if (!conn || conn.ws.readyState !== conn.ws.OPEN) return;
  if (conn.ws.bufferedAmount > MAX_BUFFERED) {
    conn.ws.terminate();
    return;
  }
  // Whole frames written beside ws's own never split them.
  const socket = (conn.ws as unknown as { _socket: Duplex })._socket;
  if (now) {
    socket.write(frame);
    if (corked.delete(socket)) socket.uncork();
    return;
  }
  if (!corked.has(socket)) {
    socket.cork();
    corked.add(socket);
    flushing ??= setImmediate(flush);
  }
  socket.write(frame);
}

const send = (conn: Conn | null | undefined, message: PartyServerMessage) =>
  sendData(conn, encode(message));

const everyone = (party: Party) => [...party.seats.keys()];

function statusOf(party: Party, seat: Seat): MemberStatus {
  const buffering = !!party.group.member(seat.id)?.buffering;
  return {
    id: seat.id,
    host: seat.id === party.host,
    away: seat.at === null,
    buffering,
    offsetMs: buffering ? undefined : seat.offsetMs,
  };
}

function members(party: Party): PartyMemberInfo[] {
  return [...party.seats.values()].map((seat) => ({
    ...statusOf(party, seat),
    name: seat.name,
    avatar: seat.avatar,
  }));
}

/** A member's status as one number, which is all a roster needs to compare. */
function statusCode(party: Party, seat: Seat): number {
  const buffering = !!party.group.member(seat.id)?.buffering;
  const offset = buffering ? 0 : (seat.offsetMs ?? 0) / OFFSET_STEP_MS;
  return (
    offset * 8 +
    (seat.id === party.host ? 4 : 0) +
    (seat.at === null ? 2 : 0) +
    (buffering ? 1 : 0)
  );
}

/** Each member's id, name and status code, in turn. */
type Roster = (string | number)[];

function rosterOf(party: Party): Roster {
  const roster: Roster = [];
  for (const seat of party.seats.values())
    roster.push(seat.id, seat.name, statusCode(party, seat));
  return roster;
}

function inRoster(roster: Roster, id: string): boolean {
  for (let i = 0; i < roster.length; i += 3) if (roster[i] === id) return true;
  return false;
}

/** The whole list when who is in the party changed, else the statuses that did. */
function showMembers(party: Party, tx: SharedTx, before: Roster): void {
  if (!party.seats.size) return;
  let left: string[] | undefined;
  let renamed = false;
  let changed: MemberStatus[] | undefined;
  for (let i = 0; i < before.length; i += 3) {
    const seat = party.seats.get(before[i] as string);
    if (!seat) (left ??= []).push(before[i] as string);
    else if (seat.name !== before[i + 1]) renamed = true;
    else if (statusCode(party, seat) !== before[i + 2])
      (changed ??= []).push(statusOf(party, seat));
  }
  let joined: string[] | undefined;
  if (party.seats.size !== before.length / 3 - (left?.length ?? 0))
    for (const id of party.seats.keys())
      if (!inRoster(before, id)) (joined ??= []).push(id);
  if (joined || left || renamed) {
    const to = everyone(party);
    const list = members(party);
    if (!joined && !left)
      return tx.send(to, encode({ t: 'members', members: list }));
    for (const id of joined ?? [])
      tx.send(to, encode({ t: 'members', members: list, joined: id }));
    for (const id of left ?? [])
      tx.send(to, encode({ t: 'members', members: list, left: id }));
    return;
  }
  if (changed)
    tx.send(everyone(party), encode({ t: 'status', members: changed }));
}

/** Runs `fn` on a party with what its group says going out through `tx`. */
function changing<R>(
  party: Party,
  tx: SharedTx,
  fn: () => R,
  opts: { by?: string; chat?: PartyChat[] } = {}
): R {
  current = { party, tx, ...opts };
  try {
    return fn();
  } finally {
    current = undefined;
  }
}

function welcome(
  party: Party,
  seat: Seat,
  chat: PartyChat[]
): PartyServerMessage {
  return {
    t: 'welcome',
    party: party.id,
    you: seat.id,
    seat: seat.key,
    ticket: ticketOf(party),
    host: seat.id === party.host ? hostTicketOf(party) : undefined,
    state: party.group.stateType,
    lock: party.lock,
    members: members(party),
    chat,
    now: Date.now(),
  };
}

function deliver(to: readonly string[], message: GroupMessage): void {
  if (!current) return;
  const { party, tx, by } = current;
  switch (message.kind) {
    case 'joined': {
      const seat = party.seats.get(to[0]);
      if (seat)
        tx.send(to, encode(welcome(party, seat, current.chat ?? [])), RESEAT);
      return;
    }
    case 'user-joined':
    case 'left':
    case 'user-left':
      return;
    case 'command':
      // Positions measured before a pause or seek no longer say anything.
      for (const id of to) {
        const seat = party.seats.get(id);
        if (seat) seat.offsetMs = undefined;
      }
      return tx.send(to, encode({ t: 'command', command: message.command }));
    case 'queue':
      return tx.send(to, encode({ t: 'queue', queue: message.queue, by }));
    case 'state':
      return tx.send(
        to,
        encode({
          t: 'state',
          state: message.state,
          reason: message.reason,
          by,
        })
      );
  }
}

/** Writes a change's messages to this replica's members, and lets go of those it moved. */
function receive(
  id: string,
  messages: readonly SharedMessage[],
  record?: () => Party | null
): void {
  const local = here.get(id);
  if (!local) return;
  let reseat = false;
  for (const { to, data, mark } of messages) {
    reseat ||= mark === RESEAT;
    for (const seat of to) sendData(local.get(seat), data);
  }
  if (!record || !reseat) return;
  const party = record();
  for (const [seatId, conn] of local) {
    if (conn.pending) continue;
    const seat = party?.seats.get(seatId);
    if (seat?.conn === conn.id) continue;
    // Gone from the party, or taken over by a newer connection.
    unseat(conn, seat ? 4000 : 1000);
  }
}

function preview(party: Party): PartyPreview {
  const playing =
    party.group.stateType === 'Idle' ? null : party.group.queue.playing();
  return {
    members: [...party.seats.values()].map((seat) => ({
      name: seat.name,
      avatar: seat.avatar,
      host: seat.id === party.host,
      away: seat.at === null,
    })),
    state: party.group.stateType,
    playing: playing
      ? { ref: playing.ref, positionMs: party.group.currentPositionMs() }
      : null,
    full: party.seats.size >= PARTY_LIMITS.members,
  };
}

const groupMember = (id: string) => ({
  id,
  name: '',
  ping: 0,
  buffering: false,
  ignoreWait: false,
});

function newSeat(
  conn: Conn,
  id: string,
  { name, avatar }: { name: string; avatar?: string }
): Seat {
  return {
    id,
    key: key(),
    name,
    avatar,
    address: keyedAddress(conn.address),
    at: store.replica,
    conn: conn.id,
  };
}

function newParty(
  id: string,
  seat: Seat,
  expiresAt: number,
  home: Home | null
): Party {
  return {
    id,
    group: new SyncGroup('party', deliver),
    expiresAt,
    host: seat.id,
    lock: { control: false, joins: false },
    home,
    seats: new Map([[seat.id, seat]]),
    banned: [],
    lastActivity: Date.now(),
  };
}

function localOf(id: string): Map<string, Conn> {
  let local = here.get(id);
  if (!local) {
    here.set(id, (local = new Map()));
    parties.hold(id);
  }
  return local;
}

function tidy(id: string): void {
  const local = here.get(id);
  if (!local || local.size) return;
  here.delete(id);
  parties.release(id);
}

/** Seats a connection here ahead of its join, giving back what it displaced. */
function seatHere(conn: Conn, party: string, seat: string): Conn | undefined {
  clearTimeout(conn.hello);
  conn.party = party;
  conn.seat = seat;
  conn.pending = true;
  const local = localOf(party);
  const was = local.get(seat);
  local.set(seat, conn);
  return was === conn ? undefined : was;
}

/** Detaches a connection from its seat, so its close no longer holds the seat. */
function unseat(conn: Conn | null | undefined, closeCode?: number): void {
  if (!conn) return;
  const { party, seat } = conn;
  conn.party = conn.seat = undefined;
  conn.pending = false;
  if (party && seat) {
    const local = here.get(party);
    if (local?.get(seat) === conn) local.delete(seat);
    tidy(party);
  }
  if (closeCode) conn.ws.close(closeCode);
}

function close(party: Party, tx: SharedTx, reason: PartyCloseReason): void {
  tx.send(everyone(party), encode({ t: 'closed', reason }), RESEAT);
  tx.drop();
}

function removeSeat(party: Party, tx: SharedTx, seat: Seat): void {
  if (!party.seats.delete(seat.id)) return;
  party.group.leave(seat.id);
  if (!party.seats.size) return tx.drop();
  if (party.host === seat.id) {
    const seats = [...party.seats.values()];
    const next = seats.find((s) => s.at !== null) ?? seats[0];
    party.host = next.id;
    tx.send([next.id], encode({ t: 'host', ticket: hostTicketOf(party) }));
  }
}

/** The group doesn't wait for a member who is gone. */
function away(party: Party, seat: Seat): void {
  seat.at = null;
  seat.awayUntil = Date.now() + SEAT_GRACE_MS;
  party.group.handle(seat.id, { type: 'IgnoreWait', ignoreWait: true });
}

function homeOf(user: TokenUser | null, code: string | undefined): Home | null {
  if (!user || !code) return null;
  return {
    uuid: user.uuid,
    userId: user.userId,
    hidden: !!user.persona?.hidden,
    code,
    host: user.persona?.name ?? accountName(user.userData),
    avatar: user.persona
      ? user.persona.avatar
      : user.userData.jellyfin?.primary?.avatar,
  };
}

function refuse(conn: Conn, code: PartyErrorCode, end = true): void {
  send(conn, { t: 'error', code });
  if (end) conn.ws.close(4000);
}

/** The user a message's token signs in on this server, if any. */
const userOf = (token: string | undefined) =>
  token ? userForToken(token).catch(() => null) : Promise.resolve(null);

const chatOf = (entries: string[]): PartyChat[] =>
  entries.map((entry) => JSON.parse(entry) as PartyChat);

async function create(
  conn: Conn,
  m: Extract<PartyClientMessage, { t: 'create' }>
): Promise<void> {
  const user = await userOf(m.token);
  if (relayMode() !== 'public' && !user) return refuse(conn, 'denied');
  if (!addresses.create(conn.address)) return refuse(conn, 'rate');
  const seat = newSeat(conn, randomId(), m);
  seatHere(conn, m.party, seat.id);
  const created = await settled(conn, () =>
    parties.create(
      m.party,
      (tx) => {
        const party = newParty(
          m.party,
          seat,
          Date.now() + LIFETIME_MS,
          homeOf(user, m.code)
        );
        changing(party, tx, () => party.group.create(groupMember(seat.id)));
        return party;
      },
      appConfig.party.maxParties
    )
  );
  if (created !== 'ok') {
    unseat(conn);
    return refuse(conn, created);
  }
  logger.debug({ party: m.party, home: !!user }, 'party started');
}

async function join(
  conn: Conn,
  m: Extract<PartyClientMessage, { t: 'join' | 'resume' }>
): Promise<void> {
  if (!addresses.join(conn.address)) return refuse(conn, 'rate');
  localOf(m.party);
  try {
    const [found, entries] = await Promise.all([
      parties.get(m.party),
      parties.log(m.party),
    ]);
    if (!found) {
      if (m.t === 'resume') return await resume(conn, m);
      return refuse(conn, 'not-found');
    }
    const seatKey = m.t === 'join' ? m.seat : undefined;
    const held = seatKey
      ? [...found.seats.values()].find((s) => s.key === seatKey)
      : undefined;
    if (!held) {
      // A resume's ticket shows it was in the party already.
      const barred = await barredFrom(found, conn, m.token, m.t === 'resume');
      if (barred) return refuse(conn, barred);
    }
    const chat = chatOf(entries);
    const seatId = held?.id ?? randomId();
    const replaced = seatHere(conn, m.party, seatId);
    const result = await settled(conn, () =>
      parties.update(m.party, (party, tx) => {
        const seat = party.seats.get(seatId);
        if (seat && held && seat.key === seatKey) {
          return changing(
            party,
            tx,
            () => {
              seat.at = store.replica;
              seat.conn = conn.id;
              seat.awayUntil = undefined;
              seat.offsetMs = undefined;
              seat.name = m.name;
              seat.avatar = m.avatar;
              party.group.rejoin(seat.id);
              return 'ok' as const;
            },
            { chat }
          );
        }
        const barred = barredIn(party, conn, m.t === 'resume');
        if (barred) return barred;
        if (party.seats.size >= PARTY_LIMITS.members) return 'full';
        return changing(
          party,
          tx,
          () => {
            const seat = newSeat(conn, seatId, m);
            party.seats.set(seat.id, seat);
            if (m.t === 'resume' && m.host) claimHost(party, tx, seat, m.host);
            party.group.join(groupMember(seat.id));
            return 'ok' as const;
          },
          { chat }
        );
      })
    );
    if (result !== 'ok') {
      unseat(conn);
      return refuse(conn, result ?? 'not-found');
    }
    unseat(replaced, 4000);
  } finally {
    tidy(m.party);
  }
}

/** A hello's change, which the connection waits on to be seated or not. */
async function settled<T>(
  conn: Conn,
  change: () => MaybePromise<T>
): Promise<T> {
  try {
    return await change();
  } finally {
    conn.pending = false;
  }
}

/** Why someone new may not join the party as it is. */
function barredIn(
  party: Party,
  conn: Conn,
  member: boolean
): PartyErrorCode | null {
  if (party.banned.includes(keyedAddress(conn.address))) return 'denied';
  if (party.lock.joins && !member) return 'locked';
  return null;
}

/** Why someone new may not join the party, or see into it. */
async function barredFrom(
  party: Party,
  conn: Conn,
  token: string | undefined,
  member = false
): Promise<PartyErrorCode | null> {
  if (relayMode() === 'off' && !(await userOf(token))) return 'denied';
  return barredIn(party, conn, member);
}

async function peek(
  conn: Conn,
  m: Extract<PartyClientMessage, { t: 'peek' }>
): Promise<void> {
  if (!addresses.join(conn.address)) return refuse(conn, 'rate');
  const party = await parties.get(m.party);
  if (!party) return refuse(conn, 'not-found');
  const barred = await barredFrom(party, conn, m.token);
  if (barred) return refuse(conn, barred);
  send(conn, { t: 'preview', preview: preview(party) });
  conn.ws.close(1000);
}

/** After a restart, the host's ticket makes it host again, whoever came back first. */
function claimHost(
  party: Party,
  tx: SharedTx,
  seat: Seat,
  claim: { ticket: string; lock: PartyLock }
): void {
  if (!ticketExpiry(party.id, claim.ticket, 'host')) return;
  party.host = seat.id;
  party.lock = claim.lock;
  tx.send(everyone(party), encode({ t: 'lock', lock: party.lock }));
}

async function resume(
  conn: Conn,
  m: Extract<PartyClientMessage, { t: 'resume' }>
): Promise<void> {
  const expiresAt = ticketExpiry(m.party, m.ticket);
  if (!expiresAt) return refuse(conn, 'not-found');
  if (relayMode() === 'off' && !(await userOf(m.token)))
    return refuse(conn, 'denied');
  const seat = newSeat(conn, randomId(), m);
  seatHere(conn, m.party, seat.id);
  const created = await settled(conn, () =>
    parties.create(
      m.party,
      (tx) => {
        const party = newParty(m.party, seat, expiresAt, null);
        changing(party, tx, () => {
          party.group.create(groupMember(seat.id));
          if (m.host) claimHost(party, tx, seat, m.host);
          const { items, index, positionMs, playing } = m.state;
          party.group.handle(seat.id, {
            type: 'Play',
            items,
            index,
            startMs: positionMs,
          });
          if (!playing) party.group.handle(seat.id, { type: 'Pause' });
        });
        return party;
      },
      appConfig.party.maxParties
    )
  );
  if (created === 'ok') {
    logger.debug({ party: m.party }, 'party resumed');
    return;
  }
  unseat(conn);
  // Someone else brought it back first.
  if (created === 'exists') return join(conn, m);
  refuse(conn, created);
}

/** Changes the connection's party as its seat, unless another took that over. */
function asMember<R>(
  conn: Conn,
  change: (party: Party, tx: SharedTx, seat: Seat) => R
): Promise<R | undefined> | R | undefined {
  const { party: id, seat: seatId } = conn;
  if (!id || !seatId) return undefined;
  return parties.update(id, (party, tx) => {
    const seat = party.seats.get(seatId);
    return seat?.conn === conn.id ? change(party, tx, seat) : undefined;
  });
}

/** Logs a change that failed, for one that nobody waits on. */
function quietly(done: unknown): void {
  if (done instanceof Promise) done.catch(failed);
}

function inParty(conn: Conn, m: PartyClientMessage): void {
  const { party: id, seat: me } = conn;
  if (!id || !me) return;
  switch (m.t) {
    case 'request': {
      const by = UNCONTROLLED.has(m.request.type) ? undefined : me;
      const done = asMember(conn, (party, tx, seat) => {
        if (party.lock.control && seat.id !== party.host && by)
          return 'control';
        party.lastActivity = Date.now();
        const request = withinQueue(
          m.request,
          party.group.queue.size,
          PARTY_LIMITS.queue
        );
        changing(party, tx, () => party.group.handle(seat.id, request), {
          by,
        });
      });
      return quietly(
        andThen(done, (result) => {
          if (result === 'control') refuse(conn, 'control', false);
        })
      );
    }
    case 'offset': {
      conn.offsets ??= new Bucket(1, 5);
      if (!conn.offsets.take()) return;
      const offsetMs =
        m.offsetMs === undefined || Math.abs(m.offsetMs) < OFFSET_MIN_MS
          ? undefined
          : Math.round(m.offsetMs / OFFSET_STEP_MS) * OFFSET_STEP_MS;
      if (parties.peek(id)?.seats.get(me)?.offsetMs === offsetMs) return;
      return quietly(
        asMember(conn, (_party, _tx, seat) => {
          seat.offsetMs = offsetMs;
        })
      );
    }
    case 'chat': {
      conn.chats ??= new Bucket(1, 5);
      if (!conn.chats.take()) return refuse(conn, 'rate', false);
      const party = parties.peek(id);
      if (!party) return;
      const message: PartyChat = { from: me, text: m.text, at: Date.now() };
      const tx = new SharedTx();
      tx.send(everyone(party), encode({ t: 'chat', message }));
      parties.append(id, JSON.stringify(message), PARTY_LIMITS.history, tx);
      if (message.at - party.lastActivity > CHAT_ACTIVITY_MS)
        quietly(
          asMember(conn, (party) => {
            party.lastActivity = message.at;
          })
        );
      return;
    }
    case 'react': {
      conn.reactions ??= new Bucket(2, 8);
      if (!conn.reactions.take()) return;
      const party = parties.peek(id);
      if (!party) return;
      const tx = new SharedTx();
      tx.send(
        everyone(party).filter((seat) => seat !== me),
        encode({ t: 'react', from: me, emoji: m.emoji })
      );
      return parties.publish(id, tx);
    }
    case 'name':
      return quietly(
        asMember(conn, (party, tx, seat) =>
          changing(party, tx, () => (seat.name = m.name))
        )
      );
    case 'kick':
      return quietly(
        asMember(conn, (party, tx, seat) => {
          const target = party.seats.get(m.member);
          if (seat.id !== party.host || !target || target === seat) return;
          changing(party, tx, () => {
            tx.send(
              [target.id],
              encode({ t: 'closed', reason: 'removed' }),
              RESEAT
            );
            party.banned.push(target.address);
            removeSeat(party, tx, target);
          });
        })
      );
    case 'lock':
      return quietly(
        asMember(conn, (party, tx, seat) => {
          if (seat.id !== party.host) return;
          party.lock = {
            control: m.control ?? party.lock.control,
            joins: m.joins ?? party.lock.joins,
          };
          tx.send(everyone(party), encode({ t: 'lock', lock: party.lock }));
        })
      );
    case 'leave': {
      // Its connection closes once what the leave says reaches it.
      const done = asMember(conn, (party, tx, seat) =>
        changing(party, tx, () => {
          tx.send([seat.id], encode({ t: 'closed', reason: 'left' }), RESEAT);
          removeSeat(party, tx, seat);
          return true;
        })
      );
      return quietly(
        andThen(done, (left) => {
          if (!left) conn.ws.close(1000);
        })
      );
    }
  }
}

/** A promise when it waits on a hello; otherwise done on return. */
function handle(conn: Conn, m: PartyClientMessage): Promise<void> | void {
  if (
    m.t === 'create' ||
    m.t === 'join' ||
    m.t === 'resume' ||
    m.t === 'peek'
  ) {
    if (conn.party) return refuse(conn, 'invalid', false);
    if (m.v !== PARTY_PROTOCOL) return refuse(conn, 'version');
    const hello =
      m.t === 'create'
        ? create(conn, m)
        : m.t === 'peek'
          ? peek(conn, m)
          : join(conn, m);
    // The store failed it; the member tries again later.
    return hello.catch((err) => {
      failed(err);
      unseat(conn);
      refuse(conn, 'busy');
    });
  }
  inParty(conn, m);
}

const failed = (err: unknown) =>
  logger.warn(
    { err: err instanceof Error ? err.message : err },
    'party message failed'
  );

function settle(conn: Conn, waiting: Promise<void>): Promise<void> {
  const done: Promise<void> = waiting.catch(failed).then(() => {
    if (conn.queue === done) conn.queue = undefined;
  });
  return done;
}

/** In order: at once, unless an earlier message still waits on a hello. */
function run(conn: Conn, m: PartyClientMessage): void {
  if (conn.queue) {
    conn.queue = settle(
      conn,
      conn.queue.then(() => handle(conn, m))
    );
    return;
  }
  try {
    const waiting = handle(conn, m);
    if (waiting) conn.queue = settle(conn, waiting);
  } catch (err) {
    failed(err);
  }
}

/** The connection dropped; its seat waits a while for it to come back. */
function dropped(conn: Conn): void {
  clearTimeout(conn.hello);
  addresses.disconnect(conn.address);
  if (!conn.party || stopping) return unseat(conn);
  quietly(
    asMember(conn, (party, tx, seat) =>
      changing(party, tx, () => away(party, seat))
    )
  );
  unseat(conn);
}

function noteRtt(conn: Conn, rtt: number): void {
  conn.rtt = rtt;
  const party = conn.party ? parties.peek(conn.party) : undefined;
  if (party && conn.seat && party.group.pingMoved(conn.seat, rtt))
    pings.add(party.id);
}

/** Stores round trips that moved, a party's together. */
function storePings(): void {
  for (const id of pings)
    quietly(
      parties.update(id, (party) => {
        for (const conn of here.get(id)?.values() ?? []) {
          const seat = conn.seat ? party.seats.get(conn.seat) : undefined;
          if (seat?.conn !== conn.id || conn.rtt === undefined) continue;
          if (party.group.pingMoved(seat.id, conn.rtt))
            party.group.handle(seat.id, { type: 'Ping', ping: conn.rtt });
        }
      })
    );
  pings.clear();
}

/** Idle and expired parties close, seats away too long go, and waits run out. */
function lapse(id: string): Promise<void> | void {
  const done = parties.update(id, (party, tx) => {
    const at = Date.now();
    if (at - party.lastActivity > IDLE_MS || at > party.expiresAt)
      return close(party, tx, 'idle');
    changing(party, tx, () => {
      for (const seat of [...party.seats.values()])
        if (seat.awayUntil !== undefined && seat.awayUntil <= at)
          removeSeat(party, tx, seat);
      if (party.seats.size) party.group.tick();
    });
  });
  return andThen(done, () => undefined);
}

/** Members of a replica that went without saying are away, as if they dropped. */
async function orphaned(replica: string): Promise<void> {
  for (const id of await parties.tagged(`at:${replica}`)) {
    await parties.update(id, (party, tx) =>
      changing(party, tx, () => {
        for (const seat of party.seats.values())
          if (seat.at === replica) away(party, seat);
      })
    );
  }
}

/** Members here may have missed messages; they come back and are caught up. */
function lost(): void {
  for (const local of [...here.values()])
    for (const conn of [...local.values()]) unseat(conn, 1012);
}

/** Parties a user of this server sees without an invite. */
export async function listedParties(user: TokenUser): Promise<PartyListing[]> {
  const instance = appConfig.party.scope === 'instance';
  const out: PartyListing[] = [];
  const homed = await parties.tagged('homed');
  for (const party of await Promise.all(homed.map((id) => parties.get(id)))) {
    const home = party?.home;
    if (!party || !home) continue;
    const visible =
      home.hidden || user.persona?.hidden
        ? home.userId === user.userId
        : instance || home.uuid === user.uuid;
    if (!visible || party.lock.joins) continue;
    out.push({
      party: party.id,
      code: home.code,
      host: home.host,
      avatar: home.avatar,
      members: party.seats.size,
      since: party.expiresAt - LIFETIME_MS,
    });
  }
  return out;
}

/** Marks this replica's members away, for others to take them over. */
export async function closePartyRelay(): Promise<void> {
  stopping = true;
  await Promise.all(
    [...here.keys()].map((id) =>
      parties.update(id, (party, tx) =>
        changing(party, tx, () => {
          for (const seat of party.seats.values())
            if (seat.at === store.replica) away(party, seat);
        })
      )
    )
  ).catch(failed);
}

function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function attachPartyRelay(server: HttpServer): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD,
    perMessageDeflate: false,
    // Messages are parsed and checked field by field, so bad UTF-8 fails there.
    skipUTF8Validation: true,
  });
  const conns = new WeakMap<WebSocket, Conn>();

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) {
      const conn = conns.get(ws);
      if (!conn) continue;
      const quiet = now - conn.heard;
      if (quiet >= GONE_MS) ws.terminate();
      else if (quiet >= QUIET_MS) ws.ping();
    }
  }, HEARTBEAT_MS);
  const sweeper = setInterval(() => addresses.prune(), SWEEP_MS);
  const pinger = setInterval(storePings, PINGS_MS);
  for (const timer of [heartbeat, sweeper, pinger]) timer.unref();
  wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    clearInterval(pinger);
  });

  wss.on(
    'connection',
    (ws: WebSocket, _req: IncomingMessage, address: string) => {
      if (!addresses.connect(address)) return void ws.close(4029);
      const conn: Conn = {
        ws,
        id: randomId(),
        address,
        heard: Date.now(),
        strikes: 0,
        messages: new Bucket(10, 40),
      };
      conns.set(ws, conn);
      conn.hello = setTimeout(() => ws.close(4008), HELLO_MS);
      ws.on('pong', () => {
        conn.heard = Date.now();
      });
      ws.on('message', (data: RawData, binary: boolean) => {
        if (binary) return void ws.close(1003);
        conn.heard = Date.now();
        if (!conn.messages.take()) return void ws.close(4029);
        const m = parseMessage(data.toString());
        if (!m) {
          if (++conn.strikes >= MAX_STRIKES) ws.close(4000);
          else send(conn, { t: 'error', code: 'invalid' });
          return;
        }
        // Answered at once, whatever waits: its times are what it measures.
        if (m.t === 'ping') {
          const t1 = Date.now();
          sendData(
            conn,
            encode({ t: 'pong', t0: m.t0, t1, t2: Date.now() }),
            true
          );
          if (m.rtt !== undefined) noteRtt(conn, m.rtt);
          return;
        }
        run(conn, m);
      });
      ws.on('close', () => dropped(conn));
      ws.on('error', () => ws.terminate());
    }
  );

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!PATH.test(req.url ?? '')) return;
    const address = ipKeyGenerator(proxyaddr(req, isTrustedIp));
    if (wss.clients.size >= MAX_CONNECTIONS)
      return reject(socket, 503, 'Service Unavailable');
    if (!addresses.room(address))
      return reject(socket, 429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit('connection', ws, req, address)
    );
  });
  logger.debug('party relay attached');
}
