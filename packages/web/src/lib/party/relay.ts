import type { PartyClientMessage, PartyServerMessage } from '@aiostreams/core';
import { monotonic, RelayClock } from './clock';

const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 20_000];
/** A few pings settle the clock quickly; after that it drifts slowly. */
const FIRST_PINGS_MS = [0, 1_000, 2_000];
const PING_MS = 60_000;
/** A connection this quiet is pinged, to learn whether it is still there. */
const QUIET_MS = 30_000;
/** No answer this long to a ping or a chat message means the connection is gone. */
const ANSWER_MS = 8_000;
const CHECK_MS = 2_000;

function socketUrl(base: string): string {
  const url = new URL(`${base}/party/v1`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/** One question on a socket of its own: the relay's first answer, then closed. */
export function askRelay(
  base: string,
  message: PartyClientMessage
): Promise<PartyServerMessage> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl(base));
    const done = (settle: () => void) => {
      clearTimeout(timer);
      ws.onclose = ws.onmessage = null;
      ws.close();
      settle();
    };
    const timer = setTimeout(
      () => done(() => reject(new Error('No answer'))),
      ANSWER_MS
    );
    ws.onopen = () => ws.send(JSON.stringify(message));
    ws.onmessage = (event) => {
      try {
        const answer = JSON.parse(String(event.data)) as PartyServerMessage;
        done(() => resolve(answer));
      } catch {
        done(() => reject(new Error('Unreadable answer')));
      }
    };
    ws.onclose = () => done(() => reject(new Error('Closed')));
  });
}

export interface RelayHandlers {
  /** What to say on each new connection: start, join or rejoin. */
  hello(): PartyClientMessage;
  message(message: PartyServerMessage): void;
  /** False while the connection is down and being retried. */
  connected(open: boolean): void;
}

/** One relay socket, reopened until stopped, and the relay's clock. */
export class RelayConnection {
  readonly clock = new RelayClock();
  private ws: WebSocket | null = null;
  private failures = 0;
  private stopped = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private checker: ReturnType<typeof setInterval> | undefined;
  private heard = 0;
  private pinged = 0;
  /** When an answer is due; a network that drops silently never closes the socket. */
  private answerBy: number | null = null;

  constructor(
    readonly base: string,
    private readonly handlers: RelayHandlers
  ) {}

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
  }

  /** `answered` messages get something back, which shows the connection works. */
  send(message: PartyClientMessage, answered = false): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
    if (answered) this.answerBy ??= monotonic() + ANSWER_MS;
  }

  private ping = () => {
    this.pinged = monotonic();
    this.send(
      {
        t: 'ping',
        t0: monotonic(),
        rtt: this.clock.synced ? this.clock.rtt : undefined,
      },
      true
    );
  };

  private check = () => {
    const now = monotonic();
    if (this.answerBy !== null && now > this.answerBy) return this.lost();
    if (now - this.pinged >= PING_MS || now - this.heard >= QUIET_MS)
      this.ping();
  };

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    clearInterval(this.checker);
    this.answerBy = null;
  }

  private connect(): void {
    const ws = new WebSocket(socketUrl(this.base));
    this.ws = ws;
    ws.onopen = () => {
      this.failures = 0;
      this.heard = monotonic();
      this.clock.reset();
      this.handlers.connected(true);
      this.send(this.handlers.hello());
      this.timers = FIRST_PINGS_MS.map((ms) => setTimeout(this.ping, ms));
      this.checker = setInterval(this.check, CHECK_MS);
    };
    ws.onmessage = (event) => {
      this.heard = monotonic();
      this.answerBy = null;
      let message: PartyServerMessage;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.t === 'pong') {
        this.clock.add(message.t0, message.t1, message.t2, monotonic());
        return;
      }
      this.handlers.message(message);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.closed();
    };
  }

  /** Gives up on a connection that stopped answering; closing it can take minutes. */
  private lost(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.close();
    this.closed();
  }

  private closed(): void {
    this.clearTimers();
    this.ws = null;
    if (this.stopped) return;
    this.handlers.connected(false);
    // The handler may have given up on the relay.
    if (this.stopped) return;
    const wait = RETRY_MS[Math.min(this.failures++, RETRY_MS.length - 1)];
    this.timers = [setTimeout(() => this.connect(), wait)];
  }
}
