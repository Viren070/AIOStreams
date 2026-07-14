import { log } from '../logger';
import { Context, StreamResult } from '../types';
import { StreamFetcher } from './fetcher';

// The playback surface a session is being tracked on. External player links
// have no feedback channel, so they never create a session.
export type AutoNextMode = 'desktop' | 'builtin';

interface AutoNextSession {
  anime: $app.AL_BaseAnime;
  episodeNumber: number;
  bingeGroup: string | null;
  mode: AutoNextMode;
  // Built-in player playback id, used to ignore late events from a previous
  // playback after the chain has already advanced.
  playbackId: string | null;
  completedSeen: boolean;
  // Whether a position signal was seen away from the very end - guards the
  // paused-at-end detector against continuity restores near 100%.
  sawMidPlayback: boolean;
  triggered: boolean;
  startedAtMs: number;
}

const PREFETCH_DELAY_MS = 5000;
const RETRY_DELAY_MS = 800;
// After the old playback's video-terminated is observed, wait before starting
// the next stream. Must outlast the client's deferred screen close: the
// native player's handleTerminateStream sets `active = false` on a 700ms
// timer, which would otherwise close the player we just reopened.
const TERMINATE_SETTLE_MS = 1000;
// Proceed anyway if no video-terminated arrives after calling terminate().
const TERMINATE_TIMEOUT_MS = 1500;
// A video-terminated this soon after session start, while the playback id is
// still unknown, is treated as a stale event from the previous playback.
const STARTUP_GRACE_MS = 5000;

// Positions further than this from the end count as mid-playback.
const MID_PLAYBACK_MARGIN_S = 5;

// Tracks the currently playing plugin stream and advances to the next episode
// when playback finishes:
// - desktop (mpv/vlc via the playback manager): trigger when the player stops
//   after Seanime's 80% "completed" threshold was crossed.
// - builtin (web/native/mpv player): trigger on the `video-ended` event, or
//   on a paused-at-the-very-end position signal (the embedded MPV player
//   pauses on EOF via keep-open and does not seem to emit an ended event),
//   or when the player is closed after the 80% `video-completed` threshold
//   was crossed.
export class AutoNextController {
  private session: AutoNextSession | null = null;
  private fetcher: StreamFetcher | null = null;
  private pendingTerminationResolve: (() => void) | null = null;

  constructor(private readonly ctx: Context) {}

  wire(fetcher: StreamFetcher): void {
    this.fetcher = fetcher;
  }

  private get prefs() {
    return this.ctx.preferences.playback;
  }

  registerListeners(): void {
    this.ctx.playback.registerEventListener((event) =>
      this.onPlaybackEvent(event)
    );
    this.ctx.videoCore.addEventListener('video-loaded', (event) =>
      this.onVideoLoaded(event)
    );
    this.ctx.videoCore.addEventListener('video-playback-state', (event) =>
      this.onVideoLoaded(event)
    );
    this.ctx.videoCore.addEventListener('video-completed', (event) =>
      this.onVideoCompleted(event)
    );
    this.ctx.videoCore.addEventListener('video-ended', (event) =>
      this.onVideoEnded(event)
    );
    this.ctx.videoCore.addEventListener('video-paused', (event) =>
      this.onVideoPosition(event)
    );
    this.ctx.videoCore.addEventListener('video-status', (event) =>
      this.onVideoPosition(event)
    );
    this.ctx.videoCore.addEventListener('video-terminated', (event) =>
      this.onVideoGone(event, 'video-terminated')
    );
    this.ctx.videoCore.addEventListener('video-error', (event) =>
      this.onVideoGone(event, 'video-error')
    );
  }

  reset(): void {
    this.session = null;
  }

  onPlaybackStarted(
    anime: $app.AL_BaseAnime,
    episodeNumber: number,
    result: StreamResult,
    mode: AutoNextMode
  ): void {
    const isMovie = String(anime.format ?? '').toUpperCase() === 'MOVIE';
    if (isMovie) {
      this.session = null;
      return;
    }

    let playbackId: string | null = null;
    if (mode === 'builtin') {
      playbackId = this.currentPlaybackIdFor(anime, episodeNumber);
    }

    this.session = {
      anime,
      episodeNumber,
      bingeGroup: result.bingeGroup ?? null,
      mode,
      playbackId,
      completedSeen: false,
      sawMidPlayback: false,
      triggered: false,
      startedAtMs: Date.now(),
    };
    log.info('auto-next session started', {
      animeId: anime.id,
      episodeNumber,
      bingeGroup: this.session.bingeGroup,
      mode,
      playbackId,
    });

    if (!this.prefs.autoNext && !this.prefs.prefetchNext) return;
    const next = this.nextEpisodeNumber(anime, episodeNumber);
    if (next === null) {
      log.info('auto-next prefetch skipped (no next episode)', {
        animeId: anime.id,
        episodeNumber,
      });
      return;
    }
    log.info('scheduling next-episode prefetch', {
      animeId: anime.id,
      nextEpisode: next,
      delayMs: PREFETCH_DELAY_MS,
    });
    this.ctx.setTimeout(() => {
      const s = this.session;
      // Only prefetch if this playback is still the active session.
      if (!s || s.anime.id !== anime.id || s.episodeNumber !== episodeNumber) {
        log.info('next-episode prefetch skipped (session changed)');
        return;
      }
      void this.resolveEpisode(anime, next).then((ep) =>
        this.fetcher?.prefetch(anime, ep)
      );
    }, PREFETCH_DELAY_MS);
  }

  private nextEpisodeNumber(
    anime: $app.AL_BaseAnime,
    episodeNumber: number
  ): number | null {
    // For airing shows both bounds can be present; the last aired episode
    // (nextAiringEpisode - 1) is the effective limit, not the planned total.
    const bounds = [
      anime.episodes,
      anime.nextAiringEpisode ? anime.nextAiringEpisode.episode - 1 : undefined,
    ].filter((n): n is number => typeof n === 'number');
    const total = bounds.length > 0 ? Math.min(...bounds) : null;
    const next = episodeNumber + 1;
    if (total !== null && next > total) return null;
    return next;
  }

  private async resolveEpisode(
    anime: $app.AL_BaseAnime,
    episodeNumber: number
  ): Promise<$app.Anime_Episode | number> {
    try {
      const entry = await this.ctx.anime.getAnimeEntry(anime.id);
      const ep = entry?.episodes?.find(
        (e) => e.episodeNumber === episodeNumber
      );
      if (ep) return ep;
    } catch (err) {
      log.warn('could not resolve next episode object', err);
    }
    return episodeNumber;
  }

  // Desktop path (playback manager).
  private onPlaybackEvent(event: $ui.PlaybackEvent): void {
    const s = this.session;
    if (!s || s.mode !== 'desktop') return;

    const mediaId = event.state?.mediaId;
    const matches = !mediaId || mediaId === s.anime.id;

    if (event.isVideoStarted || event.isStreamStarted) {
      if (!matches) {
        log.info('auto-next session cleared (other playback)');
        this.session = null;
      }
      return;
    }

    if (event.isVideoCompleted || event.isStreamCompleted) {
      if (matches) {
        s.completedSeen = true;
        log.info('auto-next completion threshold reached', {
          animeId: s.anime.id,
          episodeNumber: s.episodeNumber,
        });
      }
      return;
    }

    if (event.isVideoStopped || event.isStreamStopped) {
      if (matches && s.completedSeen && !s.triggered) {
        this.trigger('stopped');
      } else if (matches) {
        log.info('auto-next session cleared (stopped early)');
        this.session = null;
      }
    }
  }

  // Returns the current playback id only if the coordinator already reflects
  // this exact playback.
  private currentPlaybackIdFor(
    anime: $app.AL_BaseAnime,
    episodeNumber: number
  ): string | null {
    try {
      const info = this.ctx.videoCore.getCurrentPlaybackInfo();
      if (
        info?.id &&
        info.media?.id === anime.id &&
        info.episode?.episodeNumber === episodeNumber
      ) {
        return info.id;
      }
    } catch {}
    return null;
  }

  // Stamps the session's playback id once the built-in player reports the
  // loaded playback.
  private onVideoLoaded(
    event: $ui.VideoLoadedEvent | $ui.VideoPlaybackStateEvent
  ): void {
    const s = this.session;
    if (!s || s.mode !== 'builtin' || s.playbackId) return;
    const info = event.state?.playbackInfo;
    if (!info?.id) return;
    if (info.media?.id !== s.anime.id) return;
    // A stale playback-state report for the previous episode of the same
    // anime must not stamp its id onto this session.
    if (
      info.episode?.episodeNumber !== undefined &&
      info.episode.episodeNumber !== s.episodeNumber
    ) {
      return;
    }
    s.playbackId = event.playbackId || info.id;
    log.info('auto-next session playback id resolved', {
      playbackId: s.playbackId,
    });
  }

  // Returns true when the event belongs to a different playback than the one
  // this session is tracking.
  private isForeignVideoEvent(
    s: AutoNextSession,
    event: $ui.BaseVideoEvent
  ): boolean {
    return Boolean(
      s.playbackId && event.playbackId && event.playbackId !== s.playbackId
    );
  }

  // Built-in player: fires once when playback crosses the 80% threshold.
  private onVideoCompleted(event: $ui.VideoCompletedEvent): void {
    const s = this.session;
    if (!s || s.mode !== 'builtin') return;
    if (this.isForeignVideoEvent(s, event)) return;
    s.completedSeen = true;
    log.info('auto-next completion threshold reached (builtin)', {
      animeId: s.anime.id,
      episodeNumber: s.episodeNumber,
    });
  }

  // Built-in player: paused/status position signals.
  private onVideoPosition(
    event: $ui.VideoPausedEvent | $ui.VideoStatusEvent
  ): void {
    const s = this.session;
    if (!s || s.mode !== 'builtin' || s.triggered) return;
    if (this.isForeignVideoEvent(s, event)) return;

    const { currentTime, duration } = event;
    if (
      typeof currentTime !== 'number' ||
      typeof duration !== 'number' ||
      duration <= 0
    ) {
      return;
    }

    if (currentTime < duration - MID_PLAYBACK_MARGIN_S) {
      s.sawMidPlayback = true;
      return;
    }

    // 'video-paused' events are implicitly paused; 'video-status' carries a
    // paused flag and fires every second while the player is open.
    const paused = 'paused' in event ? event.paused : true;
    if (!paused || !s.sawMidPlayback) return;

    if (currentTime >= duration - 1) {
      log.info('end of video detected (paused at end)', {
        currentTime,
        duration,
      });
      this.trigger('ended');
    }
  }

  // True when Seanime's own auto-next will advance this playback: it only
  // handles playlist-backed playback types; plugin URL streams (type "url")
  // are never advanceable, regardless of the player's Auto Next setting.
  private async seanimeCanAdvance(): Promise<boolean> {
    try {
      const type = this.ctx.videoCore.getCurrentPlaybackType();
      const advanceable = ['localfile', 'torrent', 'debrid', 'nakama'];
      if (!advanceable.includes(type)) return false;
      const playlist = await this.ctx.videoCore.getPlaylist();
      return Boolean(playlist?.nextEpisode);
    } catch {
      return false;
    }
  }

  // Built-in player path (web/native player, incl. nativeplayer torrents).
  private onVideoEnded(event: $ui.VideoEndedEvent): void {
    const s = this.session;
    if (!s || s.mode !== 'builtin' || s.triggered) return;
    if (this.isForeignVideoEvent(s, event)) {
      log.info('video-ended skipped (playbackId mismatch)', {
        session: s.playbackId,
        event: event.playbackId,
      });
      return;
    }
    try {
      const media = this.ctx.videoCore.getCurrentMedia();
      if (media && media.id !== s.anime.id) {
        log.info('video-ended skipped (media mismatch)', {
          session: s.anime.id,
          current: media.id,
        });
        return;
      }
    } catch {}

    if (!event.autoNext) {
      log.info('video-ended received for active session');
      this.trigger('ended');
      return;
    }

    // only yield if Seanime will actually advance this playback itself.
    void this.seanimeCanAdvance().then((canAdvance) => {
      if (this.session !== s || s.triggered) return;
      if (canAdvance) {
        log.info('video-ended skipped (Seanime playlist auto-next active)');
        return;
      }
      log.info(
        'video-ended received for active session (Seanime auto-next inert for this playback)'
      );
      this.trigger('ended');
    });
  }

  // Terminates the current built-in playback and waits for its
  // video-terminated event before resolving. Starting the next stream while
  // the old one is still active makes the client's stale video-terminated
  // (from tearing down the old video element) unload the new stream
  // server-side.
  private terminateAndWait(): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.pendingTerminationResolve = null;
        this.ctx.setTimeout(resolve, TERMINATE_SETTLE_MS);
      };
      this.pendingTerminationResolve = finish;
      try {
        this.ctx.videoCore.terminate();
      } catch (err) {
        log.warn('terminate() before auto-next failed', err);
      }
      this.ctx.setTimeout(finish, TERMINATE_TIMEOUT_MS);
    });
  }

  private onVideoGone(
    event: $ui.VideoTerminatedEvent | $ui.VideoErrorEvent,
    reason: string
  ): void {
    if (reason === 'video-terminated' && this.pendingTerminationResolve) {
      this.pendingTerminationResolve();
    }

    const s = this.session;
    if (!s || s.mode !== 'builtin') return;
    if (this.isForeignVideoEvent(s, event)) return;
    // A triggered session has already advanced the chain; the new episode
    // replaces it via onPlaybackStarted.
    if (s.triggered) return;

    // Closing the player after the completion threshold counts as finishing
    // the episode (parity with the desktop stop-after-80% behaviour).
    if (reason === 'video-terminated' && s.completedSeen) {
      log.info('player closed after completion threshold, advancing');
      this.trigger('terminated');
      return;
    }

    if (
      reason === 'video-terminated' &&
      s.playbackId === null &&
      Date.now() - s.startedAtMs < STARTUP_GRACE_MS
    ) {
      log.info('ignoring stale video-terminated during startup grace');
      return;
    }

    log.info(`auto-next session cleared (${reason})`);
    this.session = null;
  }

  private trigger(cause: 'ended' | 'stopped' | 'terminated'): void {
    const s = this.session;
    if (!s || s.triggered || !this.prefs.autoNext || !this.fetcher) return;
    s.triggered = true;

    const next = this.nextEpisodeNumber(s.anime, s.episodeNumber);
    if (next === null) {
      log.info('auto-next chain ended (last episode)', {
        animeId: s.anime.id,
        episodeNumber: s.episodeNumber,
      });
      this.ctx.toast.info('Reached the last episode.');
      this.session = null;
      return;
    }

    log.info('auto-next triggered', {
      animeId: s.anime.id,
      from: s.episodeNumber,
      to: next,
      cause,
    });

    const fetcher = this.fetcher;
    // One delayed retry: the advance runs amid an end-of-video event storm
    // and a transient failure there shouldn't end the chain.
    const run = (attempt: number): void => {
      void this.resolveEpisode(s.anime, next)
        .then((ep) => fetcher.fetchAutoNext(s.anime, ep, s.bingeGroup))
        .catch((err) => {
          log.error(`auto-next attempt ${attempt} failed`, err);
          if (attempt === 1) {
            this.ctx.setTimeout(() => {
              // Only retry if nothing else took over in the meantime.
              if (this.session === s) run(2);
            }, RETRY_DELAY_MS);
            return;
          }
          this.ctx.toast.error('Auto-play of the next episode failed.');
        });
    };

    // Built-in player with the old playback still open: close it and let its
    // teardown settle before starting the next stream (see terminateAndWait).
    if (s.mode === 'builtin' && cause !== 'terminated') {
      void this.terminateAndWait().then(() => run(1));
    } else {
      run(1);
    }
  }
}
