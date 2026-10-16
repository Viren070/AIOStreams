import type {
  GroupCommand,
  GroupRequest,
  GroupStateType,
  QueueSnapshot,
  RequestType,
} from './group.js';
import type { QueueItem } from './queue.js';

/*
 * The party relay's wire format: JSON text frames over `/party/v1`. Fields the
 * relay must not read (names, chat, what's playing) are sealed by the members
 * with the party's key and travel as base64url text.
 */

/** A type too, so an app can match it without importing the server's code. */
export type PartyProtocol = 1;
export const PARTY_PROTOCOL: PartyProtocol = 1;

export const PARTY_LIMITS = {
  members: 16,
  queue: 20,
  /** Lengths of sealed fields. */
  ref: 2048,
  name: 256,
  chat: 1400,
  reaction: 128,
  /** Chat messages a joining member is sent. */
  history: 20,
} as const;

/** Who may use a relay besides its own server's users. */
export type PartyRelayMode = 'off' | 'users' | 'public';

/** A relay's answer at `/party/v1`. */
export interface PartyRelayInfo {
  v: number;
  relay: PartyRelayMode;
}

/** A party its server's users see without an invite, from `/party/v1/parties`. */
export interface PartyListing {
  party: string;
  code: string;
  /** Who started it, by the name the server knows them by. */
  host: string;
  members: number;
  since: number;
}

export type PartyRequest = Exclude<GroupRequest, { type: 'Ping' }>;

export interface PartyResumeState {
  items: QueueItem[];
  index: number;
  positionMs: number;
  playing: boolean;
}

export type PartyClientMessage =
  | {
      t: 'create';
      v: number;
      party: string;
      name: string;
      /** Proves a user of the relay's own server. */
      token?: string;
      /** Lists the party for the starter's household, which may read it. */
      code?: string;
    }
  | {
      t: 'join';
      v: number;
      party: string;
      name: string;
      /** A seat held from before, which the member takes back. */
      seat?: string;
      token?: string;
    }
  | {
      t: 'resume';
      v: number;
      party: string;
      name: string;
      ticket: string;
      state: PartyResumeState;
      token?: string;
      /** The host's ticket, which makes it host again, with its locks. */
      host?: { ticket: string; lock: PartyLock };
    }
  /** Before joining: answered with a preview, then closed. */
  | { t: 'peek'; v: number; party: string; token?: string }
  /** `rtt` is the round trip the last pong measured. */
  | { t: 'ping'; t0: number; rtt?: number }
  | { t: 'request'; request: PartyRequest }
  /** How far behind the party the member plays, sent as it changes; absent once in step. */
  | { t: 'offset'; offsetMs?: number }
  | { t: 'chat'; text: string }
  | { t: 'react'; emoji: string }
  | { t: 'name'; name: string }
  | { t: 'kick'; member: string }
  | { t: 'lock'; control?: boolean; joins?: boolean }
  | { t: 'leave' };

export interface PartyMemberInfo {
  id: string;
  name: string;
  host: boolean;
  /** Connection lost; the seat is kept for a while. */
  away: boolean;
  buffering: boolean;
  /** Behind the party when positive; only while playing and a second or more off. */
  offsetMs?: number;
}

export interface PartyLock {
  /** Only the host controls playback. */
  control: boolean;
  /** Nobody new joins. */
  joins: boolean;
}

export interface PartyChat {
  from: string;
  text: string;
  at: number;
}

/** What joining would show, less the chat. */
export interface PartyPreview {
  members: Pick<PartyMemberInfo, 'name' | 'host' | 'away'>[];
  state: GroupStateType;
  /** Sealed as in the queue. */
  playing: { ref: string; positionMs: number } | null;
  full: boolean;
}

export type PartyErrorCode =
  | 'version'
  | 'invalid'
  | 'not-found'
  | 'exists'
  | 'full'
  | 'locked'
  | 'denied'
  | 'busy'
  | 'rate'
  | 'control';

export type PartyCloseReason = 'ended' | 'removed' | 'idle' | 'left';

export type PartyServerMessage =
  | {
      t: 'welcome';
      party: string;
      /** This member's id. */
      you: string;
      /** Takes the seat back after a dropped connection. */
      seat: string;
      ticket: string;
      /** The host ticket, sent to the host only. */
      host?: string;
      state: GroupStateType;
      lock: PartyLock;
      members: PartyMemberInfo[];
      chat: PartyChat[];
      now: number;
    }
  | { t: 'preview'; preview: PartyPreview }
  | { t: 'pong'; t0: number; t1: number; t2: number }
  | { t: 'command'; command: GroupCommand }
  /** `by` is the member whose request this follows from, when one asked. */
  | { t: 'queue'; queue: QueueSnapshot; by?: string }
  | { t: 'state'; state: GroupStateType; reason: RequestType; by?: string }
  | {
      t: 'members';
      members: PartyMemberInfo[];
      joined?: string;
      left?: string;
    }
  /** Only the members whose status changed since the last list or status. */
  | { t: 'status'; members: Omit<PartyMemberInfo, 'name'>[] }
  | { t: 'chat'; message: PartyChat }
  | { t: 'react'; from: string; emoji: string }
  | { t: 'lock'; lock: PartyLock }
  /** To a member that just became host. */
  | { t: 'host'; ticket: string }
  | { t: 'error'; code: PartyErrorCode }
  | { t: 'closed'; reason: PartyCloseReason };
