import type { JellyfinClient } from '../client';
import { TICKS_PER_MS } from '../format';

const PROGRESS_EVERY_MS = 10_000;

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
        () => {}
      );
  }
}
