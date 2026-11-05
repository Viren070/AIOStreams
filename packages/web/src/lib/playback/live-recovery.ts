import React from 'react';
import { useLatest } from '../use-latest';
import type { PlayerState } from './controller';

const DELAYS_MS = [0, 1_000, 3_000, 5_000];
/** Tries for a source that never played, which is more likely gone than dropped. */
const UNPLAYED_TRIES = 2;
const OUTAGE_LIMIT_MS = 20_000;
/** Playback this long without a hitch ends the outage. */
const HEALTHY_MS = 15_000;
const START_LIMIT_MS = 20_000;
/** Some players wait on a dead stream without ever failing. */
const REOPEN_LIMIT_MS = 10_000;
const STALL_LIMIT_MS = 10_000;
/** A reopen ends the file it replaces, which engines report too. */
const STALE_EVENT_MS = 300;
/** Reconnects quicker than this pass without a word. */
const NOTICE_MS = 2_000;
/** A reopened source plays again once the playhead moves on this many checks in a row. */
const PROGRESS_CHECKS = 2;

interface Actions {
  reopen(): void;
  failed(retry: () => void): Promise<void>;
  showNotice(shown: boolean): void;
  positionMs(): number;
}

export interface LiveRecovery {
  dropped(): void;
  readonly played: boolean;
}

/**
 * Keeps a live source playing: reopens it when it ends, fails, never starts
 * or stalls, then calls `failed` once it gives up. Null for other sources.
 */
export function useLiveRecovery(
  live: boolean,
  file: string,
  state: Pick<PlayerState, 'started' | 'waiting' | 'paused' | 'error'>,
  actions: Actions
): LiveRecovery | null {
  const latest = useLatest(actions);
  const [outage] = React.useState(() => new Outage(latest));
  React.useEffect(() => () => outage.reset(), [outage, file]);

  // While reopening, only the playhead says it plays again.
  const { started, waiting, paused, error } = state;
  React.useEffect(() => {
    if (!live || error || paused || outage.reopening) return;
    if (started && !waiting) {
      outage.playing();
      return;
    }
    const stuck = setTimeout(
      () => outage.dropped(),
      started ? STALL_LIMIT_MS : START_LIMIT_MS
    );
    return () => clearTimeout(stuck);
  }, [outage, live, started, waiting, paused, error]);

  return live ? outage : null;
}

type Timer = ReturnType<typeof setTimeout> | undefined;

class Outage implements LiveRecovery {
  played = false;
  reopening = false;
  private tries = 0;
  private since = 0;
  private reopenedAt = 0;
  private timer: Timer;
  private notice: Timer;
  private healthy: Timer;
  private progress: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly actions: { readonly current: Actions }) {}

  dropped(): void {
    const now = Date.now();
    if (now - this.reopenedAt < STALE_EVENT_MS) return;
    this.stopTimers();
    if (!this.tries) this.since = now;
    const tries = this.played ? DELAYS_MS.length : UNPLAYED_TRIES;
    if (this.tries >= tries || now - this.since > OUTAGE_LIMIT_MS) {
      this.end();
      void this.actions.current.failed(() => this.reopen());
      return;
    }
    this.notice ??= setTimeout(
      () => this.actions.current.showNotice(true),
      NOTICE_MS
    );
    this.timer = setTimeout(() => this.reopen(), DELAYS_MS[this.tries++]);
  }

  playing(): void {
    this.played = true;
    this.reopening = false;
    clearTimeout(this.timer);
    clearInterval(this.progress);
    this.hideNotice();
    this.healthy ??= setTimeout(() => {
      this.healthy = undefined;
      this.tries = 0;
    }, HEALTHY_MS);
  }

  reset(): void {
    this.end();
    this.played = false;
  }

  private reopen(): void {
    this.reopening = true;
    this.reopenedAt = Date.now();
    this.timer = setTimeout(() => this.dropped(), REOPEN_LIMIT_MS);
    this.actions.current.reopen();
    let last = this.actions.current.positionMs();
    let ahead = 0;
    clearInterval(this.progress);
    this.progress = setInterval(() => {
      const at = this.actions.current.positionMs();
      ahead = at > last ? ahead + 1 : 0;
      last = at;
      if (ahead >= PROGRESS_CHECKS) this.playing();
    }, 1_000);
  }

  private end(): void {
    this.stopTimers();
    this.hideNotice();
    this.tries = 0;
    this.reopening = false;
  }

  private stopTimers(): void {
    clearTimeout(this.timer);
    clearInterval(this.progress);
    clearTimeout(this.healthy);
    this.healthy = undefined;
  }

  private hideNotice(): void {
    if (this.notice === undefined) return;
    clearTimeout(this.notice);
    this.notice = undefined;
    this.actions.current.showNotice(false);
  }
}
