import React from 'react';
import type { GroupCommand } from '@aiostreams/core';
import type { PlayerController, PlayerState } from '../playback/controller';
import { useLatest } from '../use-latest';
import { party, positionAt, useParty, type Timeline } from './party';

/*
 * Keeps one player on the party's timeline. Commands run at the moment they
 * name, on the relay's clock; between them, a small drift is taken up by
 * playing up to 5% faster or slower, and a larger one by a seek.
 */

/** After a seek, the position settles before drift is measured again. */
const SETTLE_MS = 1_500;
const SEEK_COOLDOWN_MS = 2_000;
/** A shorter stall costs only this member, who catches up after it. */
const BUFFER_AFTER_MS = 3_000;
const TICK_MS = 250;
const RESUME_MS = 5_000;
/** Positions this close count as there. */
const ACCURATE_MS = 250;
/** Close enough to play at normal speed. */
const IN_STEP_MS = 30;
const MAX_NUDGE = 0.05;
/** The drift a full nudge takes up in about a second. */
const NUDGE_SPAN_MS = 1_000;
/** At 5%, more than this would take several seconds to take up. */
const SEEK_DRIFT_MS = 400;
/** A player that plays at one speed seeks sooner. */
const SEEK_DRIFT_FIXED_MS = 1_000;
/** Behind by less than this at a pause, a member plays on to it. */
const CATCH_UP_MS = 3_000;
const DEFAULT_LEAD_MS = 250;
/** How long a pause or play this side made stays its own, not the user's. */
const OWN_CHANGE_MS = 1_500;

class Follower {
  private sample = { positionMs: 0, at: performance.now() };
  private rate = 1;
  private settleUntil = 0;
  private lastSeekAt = -Infinity;
  private seekStartedAt: number | null = null;
  private seekLead = DEFAULT_LEAD_MS;
  private scheduled: ReturnType<typeof setTimeout>[] = [];
  private bufferTimer: ReturnType<typeof setTimeout> | undefined;
  private reported: 'none' | 'buffer' | 'ready' = 'none';
  private awaitingReady = true;
  private own: { paused: boolean; at: number } | null = null;
  private pauseAt: number | null = null;
  private lastResume = 0;
  private stopped = false;

  constructor(
    private readonly player: () => PlayerController,
    private readonly speed: ((rate: number) => void) | undefined,
    readonly playlistItemId: string
  ) {
    this.own = { paused: true, at: performance.now() };
    this.sample = {
      positionMs: player().playhead.positionMs,
      at: performance.now(),
    };
  }

  private get timeline(): Timeline | null {
    const timeline = party.state()?.timeline ?? null;
    return timeline?.playlistItemId === this.playlistItemId ? timeline : null;
  }

  /** Where the player is now, carried on from its last report. */
  position(): number {
    const { state } = this.player();
    if (state.paused || state.waiting) return this.sample.positionMs;
    return (
      this.sample.positionMs + (performance.now() - this.sample.at) * this.rate
    );
  }

  private expected(timeline: Timeline): number {
    const clock = party.clock();
    return positionAt(timeline, clock ? clock.now() : Date.now());
  }

  onPosition(positionMs: number): void {
    this.sample = { positionMs, at: performance.now() };
  }

  private after(ms: number, run: () => void): void {
    this.scheduled.push(setTimeout(run, Math.max(ms, 0)));
  }

  private clearScheduled(): void {
    for (const timer of this.scheduled) clearTimeout(timer);
    this.scheduled = [];
    this.pauseAt = null;
  }

  private setPaused(paused: boolean): void {
    this.own = { paused, at: performance.now() };
    if (this.player().state.paused !== paused) this.player().setPaused(paused);
  }

  private setRate(rate: number): void {
    if (!this.speed || rate === this.rate) return;
    this.sample = { positionMs: this.position(), at: performance.now() };
    this.rate = rate;
    this.speed(rate);
  }

  private seekTo(positionMs: number): void {
    const now = performance.now();
    this.setRate(1);
    this.player().seek(Math.max(positionMs, 0));
    this.sample = { positionMs: Math.max(positionMs, 0), at: now };
    this.settleUntil = now + SETTLE_MS;
    this.lastSeekAt = now;
    this.seekStartedAt = now;
  }

  private seekIfOff(positionMs: number): void {
    if (Math.abs(this.position() - positionMs) > ACCURATE_MS)
      this.seekTo(positionMs);
  }

  private send(type: 'Buffer' | 'Ready'): void {
    const clock = party.clock();
    const { state } = this.player();
    const when = clock ? clock.now() : Date.now();
    const positionMs = this.position();
    party.request({
      type,
      when,
      positionMs,
      isPlaying: type === 'Buffer' || !state.paused,
      playlistItemId: this.playlistItemId,
    });
    if (
      type === 'Ready' &&
      this.reported === 'buffer' &&
      !state.paused &&
      this.timeline?.playing
    )
      party.playOn(this.playlistItemId, positionMs, when);
    this.reported = type === 'Buffer' ? 'buffer' : 'ready';
  }

  onCommand(command: GroupCommand): void {
    if (command.playlistItemId !== this.playlistItemId) return;
    this.clearScheduled();
    const clock = party.clock();
    const delay = clock ? command.when - clock.now() : 0;
    switch (command.command) {
      case 'Unpause':
        if (delay > 0) {
          this.seekIfOff(command.positionMs);
          this.after(delay, () => this.setPaused(false));
        } else {
          const late = command.positionMs - delay;
          if (Math.abs(this.position() - late) > ACCURATE_MS)
            this.seekTo(late + this.seekLead);
          this.setPaused(false);
        }
        return;
      case 'Pause':
        return this.after(delay, () => this.pauseOn(command.positionMs));
      case 'Seek':
        this.setPaused(true);
        this.seekTo(command.positionMs);
        this.awaitingReady = true;
        return;
      case 'Stop':
        return this.setPaused(true);
    }
  }

  /** A member just behind plays on to where the group paused, rather than jumping. */
  private pauseOn(positionMs: number): void {
    const behind = positionMs - this.position();
    const { state } = this.player();
    if (!state.paused && behind > ACCURATE_MS && behind < CATCH_UP_MS) {
      this.pauseAt = positionMs;
      this.after(behind + 1_000, () => this.pauseOn(positionMs));
      return;
    }
    this.pauseAt = null;
    this.setPaused(true);
    this.seekIfOff(positionMs);
  }

  onState(state: PlayerState, previous: PlayerState | null): void {
    if (!state.loaded) return;
    const now = performance.now();
    // The playhead is quiet while paused, so its last report would count the pause as play.
    if (
      previous &&
      (state.paused !== previous.paused || state.waiting !== previous.waiting)
    )
      this.sample = { positionMs: this.player().playhead.positionMs, at: now };
    if (this.seekStartedAt !== null && previous?.waiting && !state.waiting) {
      const took = now - this.seekStartedAt;
      if (took < 3_000)
        this.seekLead = Math.round(this.seekLead * 0.7 + took * 0.3);
      this.seekStartedAt = null;
    }
    const timeline = this.timeline;
    if (state.waiting && !previous?.waiting && timeline?.playing) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = setTimeout(() => {
        const live = this.player().state;
        if (live.waiting && !this.stopped && this.timeline?.playing)
          this.send('Buffer');
      }, BUFFER_AFTER_MS);
      return;
    }
    if (!state.waiting && previous?.waiting) {
      clearTimeout(this.bufferTimer);
      if (this.reported === 'buffer') this.send('Ready');
    }
    // A pause or play that didn't come from here came from the user or the system.
    const live = party.state()?.status === 'live';
    if (live && previous && state.paused !== previous.paused && timeline) {
      const own = this.own;
      const ours =
        own && own.paused === state.paused && now - own.at < OWN_CHANGE_MS;
      if (!ours && state.paused === timeline.playing)
        party.request({ type: state.paused ? 'Pause' : 'Unpause' });
    }
  }

  tick(): void {
    const { state } = this.player();
    if (!state.loaded) return;
    // Away from the relay the player is the user's; the party sets it right on return.
    if (party.state()?.status !== 'live') return this.setRate(1);
    const now = performance.now();
    // Some seeks finish inside what is buffered, without the player ever waiting.
    if (this.awaitingReady && !state.waiting && now - this.lastSeekAt > 300) {
      this.awaitingReady = false;
      party.request({ type: 'IgnoreWait', ignoreWait: false });
      this.send('Ready');
    }
    const timeline = this.timeline;
    if (!timeline) return;
    if (!state.paused && now - this.lastResume >= RESUME_MS) {
      this.lastResume = now;
      party.resumeAt(this.position());
    }
    if (this.pauseAt !== null) {
      if (this.position() >= this.pauseAt - IN_STEP_MS)
        this.pauseOn(this.pauseAt);
      return;
    }
    if (!timeline.playing || state.paused || state.waiting) {
      this.setRate(1);
      return;
    }
    if (now < this.settleUntil) return;
    const expected = this.expected(timeline);
    const drift = this.position() - expected;
    party.offset(-drift);
    const limit = this.speed ? SEEK_DRIFT_MS : SEEK_DRIFT_FIXED_MS;
    if (Math.abs(drift) > limit) {
      if (now - this.lastSeekAt > SEEK_COOLDOWN_MS)
        this.seekTo(expected + this.seekLead);
      return;
    }
    if (!this.speed) return;
    const nudge = Math.max(
      -MAX_NUDGE,
      Math.min(MAX_NUDGE, drift / NUDGE_SPAN_MS)
    );
    const rate = Math.abs(drift) < IN_STEP_MS ? 1 : 1 - nudge;
    if (rate === 1 || Math.abs(rate - this.rate) >= 0.01)
      this.setRate(Math.round(rate * 1000) / 1000);
  }

  stop(): void {
    this.stopped = true;
    this.clearScheduled();
    clearTimeout(this.bufferTimer);
    this.setRate(1);
  }
}

/**
 * Binds a player to the party while it plays the party's item: commands drive
 * it, and its own controls ask the group instead of acting.
 */
export function usePartyPlayer(
  player: PlayerController,
  playlistItemId: string | null
): PlayerController {
  const latest = useLatest(player);
  const state = useParty();
  const [follower, setFollower] = React.useState<Follower | null>(null);
  const speed = player.setRate;
  const hasSpeed = !!speed;

  React.useEffect(() => {
    if (!playlistItemId) return;
    const raw = latest.current.setRate;
    const follower = new Follower(
      () => latest.current,
      hasSpeed && raw ? (rate) => latest.current.setRate?.(rate) : undefined,
      playlistItemId
    );
    setFollower(follower);
    const stopPlayhead = latest.current.playhead.subscribe(() =>
      follower.onPosition(latest.current.playhead.positionMs)
    );
    const stopEvents = party.on((event) => {
      if (event.type === 'command') follower.onCommand(event.command);
    });
    const ticker = setInterval(() => follower.tick(), TICK_MS);
    return () => {
      stopPlayhead();
      stopEvents();
      clearInterval(ticker);
      follower.stop();
      setFollower(null);
    };
  }, [playlistItemId, latest, hasSpeed]);

  const previous = React.useRef<PlayerState | null>(null);
  React.useEffect(() => {
    follower?.onState(player.state, previous.current);
    previous.current = player.state;
  }, [follower, player.state]);

  if (!playlistItemId) return player;
  const own = { ...player, setRate: undefined, queueNext: undefined };
  if (state?.status !== 'live') return { ...own, shared: true };
  const groupPlaying = state?.timeline?.playing ?? !player.state.paused;
  return {
    ...own,
    togglePlay: () =>
      party.request({ type: groupPlaying ? 'Pause' : 'Unpause' }),
    setPaused: (paused) =>
      party.request({ type: paused ? 'Pause' : 'Unpause' }),
    seek: (ms) => party.request({ type: 'Seek', positionMs: Math.max(ms, 0) }),
    shared: true,
  };
}
