import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { randomBytes } from 'crypto';
import proxyaddr from 'proxy-addr';
import { ipKeyGenerator } from 'express-rate-limit';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  config as appConfig,
  createLogger,
  GroupHub,
  PARTY_LIMITS,
  PARTY_PROTOCOL,
  type GroupMessage,
  type PartyChat,
  type PartyClientMessage,
  type PartyCloseReason,
  type PartyErrorCode,
  type PartyListing,
  type PartyLock,
  type PartyMemberInfo,
  type PartyPreview,
  type PartyServerMessage,
  type SyncGroup,
} from '@aiostreams/core';
import { isTrustedIp } from '../middlewares/ip.js';
import { userForToken, type TokenUser } from '../routes/jellyfin/context.js';
import { accountName } from '../routes/jellyfin/users.js';
import { AddressBook, Bucket } from './limits.js';
import { parseMessage } from './messages.js';
import { ticketExpiry, ticketFor } from './ticket.js';
import { relayMode } from './mode.js';

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
const HEARTBEAT_MS = 30_000;
const SWEEP_MS = 60_000;
const REPORT_MS = 5_000;
/** Reports go stale after missing a few; members report every 5 s. */
const REPORT_STALE_MS = 15_000;
/** Offsets shown are rounded to this, and smaller ones not shown. */
const OFFSET_STEP_MS = 500;
const OFFSET_MIN_MS = 1_000;
const MAX_STRIKES = 5;

/** Requests any member makes while only the host controls playback. */
const UNCONTROLLED = new Set(['Buffer', 'Ready', 'IgnoreWait']);

interface Home {
  uuid: string;
  userId: string;
  hidden: boolean;
  code: string;
  host: string;
}

interface Seat {
  id: string;
  key: string;
  name: string;
  conn: Conn | null;
  away?: ReturnType<typeof setTimeout>;
  address: string;
  report?: { positionMs: number; at: number };
  /** Its status as last sent. */
  shown?: MemberStatus;
}

interface Party {
  id: string;
  group: SyncGroup;
  ticket: string;
  hostTicket: string;
  expiresAt: number;
  host: string;
  lock: PartyLock;
  home: Home | null;
  seats: Map<string, Seat>;
  chat: PartyChat[];
  banned: Set<string>;
  lastActivity: number;
  reported: boolean;
  /** A member's name changed since the list was last sent. */
  renamed: boolean;
}

interface Conn {
  ws: WebSocket;
  address: string;
  party?: Party;
  seat?: Seat;
  /** When anything last came from the client, ping or not. */
  heard: number;
  strikes: number;
  messages: Bucket;
  /** Made on first use, as most members never chat or react. */
  chats?: Bucket;
  reactions?: Bucket;
  hello?: ReturnType<typeof setTimeout>;
  /** Messages after one waiting on a token check wait their turn. */
  queue?: Promise<void>;
}

const key = () => randomBytes(16).toString('base64url');
const memberId = () => randomBytes(9).toString('base64url');

const parties = new Map<string, Party>();
const byGroup = new WeakMap<SyncGroup, Party>();
const addresses = new AddressBook(32, [20 / 3600, 10], [0.5, 10]);
const hub = new GroupHub(deliver);
/** Whose request the group is handling, sent on as `by`. */
let acting: string | undefined;

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
 * all a request sends one member, and its party's member list, is one write.
 */
const corked = new Set<Duplex>();
const touched = new Set<Party>();
let flushing: ReturnType<typeof setImmediate> | null = null;

function flush(): void {
  for (const party of touched)
    if (parties.get(party.id) === party) showMembers(party);
  touched.clear();
  for (const socket of corked) socket.uncork();
  corked.clear();
  flushing = null;
}

/** Sends the member list as this turn ends, once however often it changed. */
function touch(party: Party): void {
  touched.add(party);
  flushing ??= setImmediate(flush);
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

function sendTo(party: Party, ids: Iterable<string>, data: Buffer): void {
  for (const id of ids) sendData(party.seats.get(id)?.conn, data);
}

function broadcast(party: Party, message: PartyServerMessage): void {
  sendTo(party, party.seats.keys(), encode(message));
}

/** How far behind the group a member plays, from its last report. */
function offsetOf(party: Party, seat: Seat, now: number): number | undefined {
  const { report } = seat;
  if (!report || party.group.stateType !== 'Playing') return undefined;
  if (now - report.at > REPORT_STALE_MS) return undefined;
  const gap =
    party.group.currentPositionMs() - (report.positionMs + now - report.at);
  return Math.abs(gap) < OFFSET_MIN_MS
    ? undefined
    : Math.round(gap / OFFSET_STEP_MS) * OFFSET_STEP_MS;
}

type MemberStatus = Omit<PartyMemberInfo, 'name'>;

function statusOf(party: Party, seat: Seat, now: number): MemberStatus {
  const buffering = !!party.group.member(seat.id)?.buffering;
  return {
    id: seat.id,
    host: seat.id === party.host,
    away: !seat.conn,
    buffering,
    offsetMs: buffering ? undefined : offsetOf(party, seat, now),
  };
}

const sameStatus = (a: MemberStatus | undefined, b: MemberStatus) =>
  a?.host === b.host &&
  a.away === b.away &&
  a.buffering === b.buffering &&
  a.offsetMs === b.offsetMs;

function members(party: Party): PartyMemberInfo[] {
  const now = Date.now();
  return [...party.seats.values()].map((seat) => ({
    ...statusOf(party, seat, now),
    name: seat.name,
  }));
}

/** The whole list when who is in the party changed, else the statuses that did. */
function showMembers(
  party: Party,
  change: { joined?: string; left?: string } = {}
) {
  party.reported = false;
  if (change.joined || change.left || party.renamed) {
    party.renamed = false;
    const list = members(party);
    for (const m of list) party.seats.get(m.id)!.shown = m;
    return broadcast(party, { t: 'members', members: list, ...change });
  }
  const now = Date.now();
  let changed: MemberStatus[] | undefined;
  for (const seat of party.seats.values()) {
    const status = statusOf(party, seat, now);
    if (sameStatus(seat.shown, status)) continue;
    seat.shown = status;
    (changed ??= []).push(status);
  }
  if (changed) broadcast(party, { t: 'status', members: changed });
}

function welcome(party: Party, seat: Seat): PartyServerMessage {
  return {
    t: 'welcome',
    party: party.id,
    you: seat.id,
    seat: seat.key,
    ticket: party.ticket,
    host: seat.id === party.host ? party.hostTicket : undefined,
    state: party.group.stateType,
    lock: party.lock,
    members: members(party),
    chat: party.chat,
    now: Date.now(),
  };
}

function deliver(
  group: SyncGroup,
  to: readonly string[],
  message: GroupMessage
): void {
  const party = byGroup.get(group);
  if (!party) return;
  switch (message.kind) {
    case 'joined': {
      const seat = party.seats.get(to[0]);
      if (seat) send(seat.conn, welcome(party, seat));
      return;
    }
    case 'user-joined':
    case 'left':
    case 'user-left':
      return;
    case 'command':
      // Positions reported before a pause or seek no longer say anything.
      for (const id of to) {
        const seat = party.seats.get(id);
        if (seat) seat.report = undefined;
      }
      return sendTo(
        party,
        to,
        encode({ t: 'command', command: message.command })
      );
    case 'queue':
      return sendTo(
        party,
        to,
        encode({ t: 'queue', queue: message.queue, by: acting })
      );
    case 'state':
      return sendTo(
        party,
        to,
        encode({
          t: 'state',
          state: message.state,
          reason: message.reason,
          by: acting,
        })
      );
  }
}

function preview(party: Party): PartyPreview {
  const playing =
    party.group.stateType === 'Idle' ? null : party.group.queue.playing();
  return {
    members: [...party.seats.values()].map((seat) => ({
      name: seat.name,
      host: seat.id === party.host,
      away: !seat.conn,
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

function newSeat(conn: Conn, name: string): Seat {
  return { id: memberId(), key: key(), name, conn, address: conn.address };
}

function seatConn(conn: Conn, party: Party, seat: Seat): void {
  clearTimeout(conn.hello);
  conn.party = party;
  conn.seat = seat;
  seat.conn = conn;
}

/** Detaches a connection from its seat, so its close no longer holds the seat. */
function unseat(conn: Conn | null, closeCode?: number): void {
  if (!conn) return;
  conn.party = undefined;
  conn.seat = undefined;
  if (closeCode) conn.ws.close(closeCode);
}

function openParty(
  id: string,
  conn: Conn,
  name: string,
  opts: { ticket?: string; expiresAt?: number; home?: Home | null }
): Party {
  const seat = newSeat(conn, name);
  const expiresAt = opts.expiresAt ?? Date.now() + LIFETIME_MS;
  let party!: Party;
  // The welcome goes out from inside create, so the party must be known first.
  hub.create('party', groupMember(seat.id), {
    opened: (group) => {
      party = {
        id,
        group,
        ticket: opts.ticket ?? ticketFor(id, expiresAt),
        hostTicket: ticketFor(id, expiresAt, 'host'),
        expiresAt,
        host: seat.id,
        lock: { control: false, joins: false },
        home: opts.home ?? null,
        seats: new Map([[seat.id, seat]]),
        chat: [],
        banned: new Set(),
        lastActivity: Date.now(),
        reported: false,
        renamed: false,
      };
      parties.set(id, party);
      byGroup.set(group, party);
    },
  });
  seatConn(conn, party, seat);
  seat.shown = statusOf(party, seat, Date.now());
  return party;
}

function close(party: Party, reason: PartyCloseReason): void {
  broadcast(party, { t: 'closed', reason });
  for (const seat of party.seats.values()) {
    clearTimeout(seat.away);
    unseat(seat.conn, 1000);
  }
  party.seats.clear();
  hub.drop(party.group);
  parties.delete(party.id);
}

function removeSeat(party: Party, seat: Seat): void {
  clearTimeout(seat.away);
  if (!party.seats.delete(seat.id)) return;
  unseat(seat.conn);
  hub.leave(seat.id);
  if (!party.seats.size) {
    parties.delete(party.id);
    return;
  }
  if (party.host === seat.id) {
    const seats = [...party.seats.values()];
    const next = seats.find((s) => s.conn) ?? seats[0];
    party.host = next.id;
    send(next.conn, { t: 'host', ticket: party.hostTicket });
  }
  showMembers(party, { left: seat.id });
}

function homeOf(user: TokenUser | null, code: string | undefined): Home | null {
  if (!user || !code) return null;
  return {
    uuid: user.uuid,
    userId: user.userId,
    hidden: !!user.persona?.hidden,
    code,
    host: user.persona?.name ?? accountName(user.userData),
  };
}

function refuse(conn: Conn, code: PartyErrorCode, end = true): void {
  send(conn, { t: 'error', code });
  if (end) conn.ws.close(4000);
}

/** The user a message's token signs in on this server, if any. */
const userOf = (token: string | undefined) =>
  token ? userForToken(token).catch(() => null) : Promise.resolve(null);

async function create(
  conn: Conn,
  m: Extract<PartyClientMessage, { t: 'create' }>
): Promise<void> {
  const user = await userOf(m.token);
  if (relayMode() !== 'public' && !user) return refuse(conn, 'denied');
  if (!addresses.create(conn.address)) return refuse(conn, 'rate');
  if (GroupHub.total() >= appConfig.party.maxParties)
    return refuse(conn, 'busy');
  if (parties.has(m.party)) return refuse(conn, 'exists');
  openParty(m.party, conn, m.name, { home: homeOf(user, m.code) });
  logger.debug({ party: m.party, home: !!user }, 'party started');
}

async function join(
  conn: Conn,
  m: Extract<PartyClientMessage, { t: 'join' | 'resume' }>
): Promise<void> {
  if (!addresses.join(conn.address)) return refuse(conn, 'rate');
  const party = parties.get(m.party);
  if (!party) {
    if (m.t === 'resume') return resume(conn, m);
    return refuse(conn, 'not-found');
  }
  const held =
    m.t === 'join' && m.seat
      ? [...party.seats.values()].find((s) => s.key === m.seat)
      : undefined;
  if (held) {
    clearTimeout(held.away);
    held.away = undefined;
    if (held.conn !== conn) unseat(held.conn, 4000);
    if (held.name !== m.name) {
      held.name = m.name;
      party.renamed = true;
    }
    seatConn(conn, party, held);
    party.group.rejoin(held.id);
    return touch(party);
  }
  // A resume's ticket shows it was in the party already.
  const barred = await barredFrom(party, conn, m.token, m.t === 'resume');
  if (barred) return refuse(conn, barred);
  if (party.seats.size >= PARTY_LIMITS.members) return refuse(conn, 'full');
  const seat = newSeat(conn, m.name);
  party.seats.set(seat.id, seat);
  seatConn(conn, party, seat);
  if (m.t === 'resume' && m.host) claimHost(party, seat, m.host);
  hub.join(party.group.id, groupMember(seat.id));
  showMembers(party, { joined: seat.id });
}

/** Why someone new may not join the party, or see into it. */
async function barredFrom(
  party: Party,
  conn: Conn,
  token: string | undefined,
  member = false
): Promise<PartyErrorCode | null> {
  if (relayMode() === 'off' && !(await userOf(token))) return 'denied';
  // It may have closed while the token was checked.
  if (parties.get(party.id) !== party) return 'not-found';
  if (party.banned.has(conn.address)) return 'denied';
  if (party.lock.joins && !member) return 'locked';
  return null;
}

async function peek(
  conn: Conn,
  m: Extract<PartyClientMessage, { t: 'peek' }>
): Promise<void> {
  if (!addresses.join(conn.address)) return refuse(conn, 'rate');
  const party = parties.get(m.party);
  if (!party) return refuse(conn, 'not-found');
  const barred = await barredFrom(party, conn, m.token);
  if (barred) return refuse(conn, barred);
  send(conn, { t: 'preview', preview: preview(party) });
  conn.ws.close(1000);
}

/** After a restart, the host's ticket makes it host again, whoever came back first. */
function claimHost(
  party: Party,
  seat: Seat,
  claim: { ticket: string; lock: PartyLock }
): void {
  if (!ticketExpiry(party.id, claim.ticket, 'host')) return;
  party.host = seat.id;
  party.lock = claim.lock;
  broadcast(party, { t: 'lock', lock: party.lock });
}

async function resume(
  conn: Conn,
  m: Extract<PartyClientMessage, { t: 'resume' }>
): Promise<void> {
  const expiresAt = ticketExpiry(m.party, m.ticket);
  if (!expiresAt) return refuse(conn, 'not-found');
  if (relayMode() === 'off' && !(await userOf(m.token)))
    return refuse(conn, 'denied');
  if (parties.has(m.party)) return join(conn, m);
  if (GroupHub.total() >= appConfig.party.maxParties)
    return refuse(conn, 'busy');
  const party = openParty(m.party, conn, m.name, {
    ticket: m.ticket,
    expiresAt,
  });
  if (m.host) claimHost(party, conn.seat!, m.host);
  const { items, index, positionMs, playing } = m.state;
  const from = conn.seat!.id;
  party.group.handle(from, { type: 'Play', items, index, startMs: positionMs });
  if (!playing) party.group.handle(from, { type: 'Pause' });
  logger.debug({ party: m.party }, 'party resumed');
}

function inParty(conn: Conn, m: PartyClientMessage): void {
  const { party, seat } = conn;
  if (!party || !seat) return;
  switch (m.t) {
    case 'request': {
      const host = seat.id === party.host;
      if (party.lock.control && !host && !UNCONTROLLED.has(m.request.type))
        return refuse(conn, 'control', false);
      party.lastActivity = Date.now();
      // Buffering and readiness are the player's doing, not the member's.
      acting = UNCONTROLLED.has(m.request.type) ? undefined : seat.id;
      try {
        party.group.handle(seat.id, m.request);
      } finally {
        acting = undefined;
      }
      return touch(party);
    }
    case 'report':
      seat.report = { positionMs: m.positionMs, at: m.at };
      party.reported = true;
      return;
    case 'chat': {
      conn.chats ??= new Bucket(1, 5);
      if (!conn.chats.take()) return refuse(conn, 'rate', false);
      const message = { from: seat.id, text: m.text, at: Date.now() };
      party.chat.push(message);
      if (party.chat.length > PARTY_LIMITS.history) party.chat.shift();
      party.lastActivity = message.at;
      return broadcast(party, { t: 'chat', message });
    }
    case 'react': {
      conn.reactions ??= new Bucket(2, 8);
      if (!conn.reactions.take()) return;
      const data = encode({ t: 'react', from: seat.id, emoji: m.emoji });
      return sendTo(
        party,
        [...party.seats.keys()].filter((id) => id !== seat.id),
        data
      );
    }
    case 'name':
      seat.name = m.name;
      party.renamed = true;
      return touch(party);
    case 'kick': {
      const target = party.seats.get(m.member);
      if (seat.id !== party.host || !target || target === seat) return;
      send(target.conn, { t: 'closed', reason: 'removed' });
      target.conn?.ws.close(1000);
      party.banned.add(target.address);
      return removeSeat(party, target);
    }
    case 'lock':
      if (seat.id !== party.host) return;
      party.lock = {
        control: m.control ?? party.lock.control,
        joins: m.joins ?? party.lock.joins,
      };
      return broadcast(party, { t: 'lock', lock: party.lock });
    case 'leave':
      send(conn, { t: 'closed', reason: 'left' });
      removeSeat(party, seat);
      return conn.ws.close(1000);
  }
}

/** A promise when it waits on a token check; otherwise done on return. */
function handle(conn: Conn, m: PartyClientMessage): Promise<void> | void {
  if (m.t === 'ping') {
    const t1 = Date.now();
    if (m.rtt !== undefined && conn.seat)
      conn.party?.group.handle(conn.seat.id, { type: 'Ping', ping: m.rtt });
    const pong = encode({ t: 'pong', t0: m.t0, t1, t2: Date.now() });
    return sendData(conn, pong, true);
  }
  if (
    m.t === 'create' ||
    m.t === 'join' ||
    m.t === 'resume' ||
    m.t === 'peek'
  ) {
    if (conn.party) return refuse(conn, 'invalid', false);
    if (m.v !== PARTY_PROTOCOL) return refuse(conn, 'version');
    if (m.t === 'create') return create(conn, m);
    if (m.t === 'peek') return peek(conn, m);
    return join(conn, m);
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

/** In order: at once, unless an earlier message still waits on a token check. */
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
  const { party, seat } = conn;
  if (!party || !seat || seat.conn !== conn) return;
  seat.conn = null;
  // The group doesn't wait for a member who is gone.
  party.group.handle(seat.id, { type: 'IgnoreWait', ignoreWait: true });
  seat.away = setTimeout(() => removeSeat(party, seat), SEAT_GRACE_MS);
  seat.away.unref?.();
  touch(party);
}

function sweep(): void {
  const now = Date.now();
  for (const party of parties.values()) {
    if (now - party.lastActivity > IDLE_MS || now > party.expiresAt)
      close(party, 'idle');
  }
  addresses.prune();
}

function report(): void {
  for (const party of parties.values()) if (party.reported) showMembers(party);
}

/** Parties a user of this server sees without an invite. */
export function listedParties(user: TokenUser): PartyListing[] {
  const instance = appConfig.party.scope === 'instance';
  const out: PartyListing[] = [];
  for (const party of parties.values()) {
    const home = party.home;
    if (!home) continue;
    const visible =
      home.hidden || user.persona?.hidden
        ? home.userId === user.userId
        : instance || home.uuid === user.uuid;
    if (!visible || party.lock.joins) continue;
    out.push({
      party: party.id,
      code: home.code,
      host: home.host,
      members: party.seats.size,
      since: party.expiresAt - LIFETIME_MS,
    });
  }
  return out;
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

  // Only connections that went quiet are pinged; a playing member reports every 5 s.
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) {
      const conn = conns.get(ws);
      if (!conn) continue;
      const quiet = now - conn.heard;
      if (quiet > HEARTBEAT_MS * 1.5) ws.terminate();
      else if (quiet >= HEARTBEAT_MS / 2) ws.ping();
    }
  }, HEARTBEAT_MS);
  const sweeper = setInterval(sweep, SWEEP_MS);
  const reporter = setInterval(report, REPORT_MS);
  for (const timer of [heartbeat, sweeper, reporter]) timer.unref();
  wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    clearInterval(reporter);
  });

  wss.on(
    'connection',
    (ws: WebSocket, _req: IncomingMessage, address: string) => {
      if (!addresses.connect(address)) return void ws.close(4029);
      const conn: Conn = {
        ws,
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
