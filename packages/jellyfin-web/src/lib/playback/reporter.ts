import React from 'react';
import { ConnectionError, type JellyfinClient } from '../client';
import { useReachable } from '../connection';
import { TICKS_PER_MS } from '../format';
import { useRefreshWatchState } from '../queries';
import { useSession } from '../session';
import { storage } from '../storage';

const PROGRESS_EVERY_MS = 10_000;
const PENDING_KEY = 'aiostreams-web-pending-progress';

/** A stop the server never heard, as from a download played offline. */
interface PendingStop {
  base: string;
  userId?: string;
  itemId: string;
  positionTicks: number;
  at: number;
}

const pendingStops = () => storage.get<PendingStop[]>(PENDING_KEY) ?? [];

/**
 * Reports a playback the way a Jellyfin client does, so it shows as playing,
 * resumes later and reaches the trackers.
 */
export class PlaybackReporter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private readonly client: JellyfinClient,
    private readonly info: {
      itemId: string;
      mediaSourceId: string;
      playSessionId?: string | null;
      userId?: string;
    },
    private readonly position: () => { ms: number; paused: boolean }
  ) {}

  private body(extra: Record<string, unknown> = {}) {
    const { ms, paused } = this.position();
    return {
      ItemId: this.info.itemId,
      MediaSourceId: this.info.mediaSourceId,
      PlaySessionId: this.info.playSessionId ?? undefined,
      PositionTicks: Math.round(ms) * TICKS_PER_MS,
      IsPaused: paused,
      CanSeek: true,
      PlayMethod: 'DirectPlay',
      ...extra,
    };
  }

  start(): void {
    void this.client.post('/Sessions/Playing', this.body()).catch(() => {});
    this.timer = setInterval(
      () => this.progress('TimeUpdate'),
      PROGRESS_EVERY_MS
    );
  }

  progress(event: 'TimeUpdate' | 'Pause' | 'Unpause'): void {
    if (this.stopped) return;
    void this.client
      .post('/Sessions/Playing/Progress', this.body({ EventName: event }))
      .catch(() => {});
  }

  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    // keepalive lets the report leave while the page is closing.
    return this.client
      .request('POST', '/Sessions/Playing/Stopped', {
        body: this.body(),
        keepalive: true,
      })
      .then(
        () => {},
        (error: unknown) => {
          if (!(error instanceof ConnectionError)) return;
          const { PositionTicks } = this.body();
          storage.set(PENDING_KEY, [
            ...pendingStops(),
            {
              base: this.client.base,
              userId: this.info.userId,
              itemId: this.info.itemId,
              positionTicks: PositionTicks,
              at: Date.now(),
            },
          ]);
        }
      );
  }
}

/**
 * Sends this user's stops that never reached the server once it answers,
 * dated when they happened so a later play elsewhere still wins.
 */
export function usePendingStops(): void {
  const { client, user } = useSession();
  const reachable = useReachable();
  const refresh = useRefreshWatchState();
  const latest = React.useRef(refresh);
  latest.current = refresh;
  React.useEffect(() => {
    if (!reachable) return;
    const mine = (p: PendingStop) =>
      p.base === client.base && (!p.userId || p.userId === user.Id);
    const waiting = pendingStops().filter(mine);
    if (!waiting.length) return;
    void (async () => {
      const sent = new Set<PendingStop>();
      for (const stop of waiting) {
        try {
          await client.post(
            `/UserItems/${stop.itemId}/UserData`,
            {
              PlaybackPositionTicks: stop.positionTicks,
              LastPlayedDate: new Date(stop.at).toISOString(),
            },
            { userId: user.Id }
          );
          sent.add(stop);
        } catch (error) {
          if (error instanceof ConnectionError) break;
          // The server refused it for good, such as an item it no longer has.
          sent.add(stop);
        }
      }
      if (!sent.size) return;
      const done = (p: PendingStop) =>
        [...sent].some((s) => s.itemId === p.itemId && s.at === p.at);
      storage.set(
        PENDING_KEY,
        pendingStops().filter((p) => !done(p))
      );
      latest.current();
    })();
  }, [reachable, client, user.Id]);
}
