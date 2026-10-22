import { t } from '@lingui/core/macro';
import type React from 'react';
import {
  Logger,
  LogLevel,
  MoviPlayer,
  type PlayerState,
  type Track as MoviTrack,
} from 'movi-player/element/slim';
import type { VideoFit } from '../settings';
import { clock } from '../format';
import { sameLanguage } from '../languages';
import { parseCues, type SubtitleCue } from '../subtitles/cues';
import { checkSubtitleFile, readSubtitleFile } from '../subtitles/files';
import type { MediaStream } from '../types';
import { ofType, ownTrackLabel, trackLabel } from './controller';
import type {
  EngineEvent,
  EngineFactory,
  EngineFile,
  EngineState,
  EngineStyle,
  EngineTrack,
  PlayerEngine,
} from './engine';
import { isFullscreen, toggleDocumentFullscreen } from './fullscreen';
import { moviDebug, moviDebugging } from './movi-debug';
import { embeddedCss, textAt } from './movi-subtitles';
import type { TimeRange } from './playhead';

const setLogLevel = () =>
  Logger.setLevel(moviDebugging ? LogLevel.INFO : LogLevel.WARN);
setLogLevel();

const SUBTITLE_TYPES = ['srt', 'vtt', 'ass', 'ssa'];
const EMBEDDED = 'embedded:';
const FIT: Record<VideoFit, 'contain' | 'cover' | 'fill'> = {
  fit: 'contain',
  crop: 'cover',
  stretch: 'fill',
};
/** Failures worth opening the stream again for, as movi's own element sees them. */
const NETWORK =
  /HTTP \d|Stream (failed|ended)|Failed to fetch|Connection lost|network|does not support range|corrupt data stream/i;
/** Of those, the ones a reopen can't mend, as movi's element also leaves them. */
const FATAL = /HTTP 40[134]\b|does not support range/i;
/** Quiet reopens in a row before the user is asked. */
const RECOVERIES = 2;
/** Playing this long after a reopen means the stream is well again. */
const RECOVERED_MS = 30_000;
const STATS_MS = 1_000;

type Assessment = Awaited<ReturnType<typeof MoviPlayer.assessPlayback>>;

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

/* eslint-disable lingui/no-unlocalized-strings -- a technical readout, as movi's own stats are */
/** Movi's verdict on whether this device plays the file smoothly, and why. */
function assessmentText(a: Assessment | null): string {
  if (!a) return 'Checking…';
  const lines = [
    `Playable: ${yesNo(a.playable)}`,
    `Smooth at ${a.rate}×: ${yesNo(a.smooth)}`,
    `Power efficient: ${yesNo(a.powerEfficient)}`,
  ];
  const { video, audio } = a;
  if (video)
    lines.push(
      `Video: ${video.codec} ${video.width}×${video.height} @ ${video.fps} fps`,
      `Video decoder: ${video.decoder} (load ${video.load.toFixed(2)})`
    );
  if (audio)
    lines.push(
      `Audio: ${audio.codec} ${audio.channels} ch ${audio.sampleRate} Hz`,
      `Audio decoder: ${audio.decoder}`
    );
  if (a.reasons.length) lines.push('Why:', ...a.reasons.map((r) => `  ${r}`));
  return lines.join('\n');
}
/* eslint-enable lingui/no-unlocalized-strings */
/** Longer than the debrid hop takes to pick and resolve a release. */
const RESOLVE_MS = 45_000;

/**
 * Movi's slim build looks for `movi.wasm` beside its own script, which the
 * bundler fixes as a `file://` path, and more than its player loads it (the
 * audio time-stretcher, thumbnails). The element's `wasmurl` is the one public
 * way to point all of them at where the bundler put it, and its handler runs
 * on an element never added to the page.
 */
let wasmPointed = false;
function pointAtWasm(): void {
  if (wasmPointed) return;
  wasmPointed = true;
  const url = new URL('movi-player/movi.wasm', import.meta.url).href;
  document.createElement('movi-player').setAttribute('wasmurl', url);
  // Its constructor turns movi's logging all the way up.
  setLogLevel();
  moviDebug('wasm', { url });
}

/**
 * Where the stream's redirects end. Movi fetches every range from the address
 * it is given, which would run the server's item lookup and each redirect
 * again for every one, and asks it with a HEAD first, which the debrid hop
 * refuses.
 */
async function finalUrl(
  url: string,
  headers: Record<string, string> | undefined,
  signal: AbortSignal
): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { ...headers, Range: 'bytes=0-0' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(RESOLVE_MS)]),
    });
    void res.body?.cancel();
    return res.ok && res.url ? res.url : url;
  } catch {
    return url;
  }
}

/** Movi names a track without a title by its language or number. */
function ownTitle(track: MoviTrack): string | undefined {
  const { label = '', language = '' } = track;
  return label && label !== language && !/^Track \d+$/.test(label)
    ? label
    : undefined;
}

/**
 * The server's entry for one of the file's tracks: both number streams the
 * way FFmpeg does, unless the languages say otherwise.
 */
function serverStream(
  streams: MediaStream[],
  track: MoviTrack
): MediaStream | undefined {
  const stream = streams.find((s) => s.Index === track.id);
  if (!stream) return undefined;
  const differ =
    !!track.language &&
    !!stream.Language &&
    !sameLanguage(track.language, stream.Language);
  return differ ? undefined : stream;
}

/* eslint-disable lingui/no-unlocalized-strings -- the fork's own messages, left untranslated */
const embeddedLabel = (label: string) => `Embedded: ${label}`;

const failedToStart = () =>
  "this browser can't run the player. Try another browser, an external player or the desktop app.";

const failedToDecode = () => "this browser couldn't decode this version";

const failedToLoad = () => 'the stream stopped loading';

const TRY_SOFTWARE = 'Try software decoding';

const SMOOTHNESS_CHECK = 'Smoothness check';
/* eslint-enable lingui/no-unlocalized-strings */

// ── Types for the three lifetimes ──

/** What the user last asked for; outlives a player and reaches it before it exists. */
interface Intent {
  /** The requested start until the session is ready; the last known position after. */
  positionMs: number;
  paused: boolean;
  audio: string | null;
  subtitle: string | null;
  /** Null when the page keeps none, as `file.volume` is. */
  volume: { volume: number; muted: boolean } | null;
}

/** Subtitles the page draws, which Movi doesn't know. */
interface PageSubtitles {
  delayMs: number;
  /** By the page's id. */
  cues: Map<string, SubtitleCue[]>;
  files: { id: string; label: string; text: string }[];
  shownText: string;
}

interface Recovery {
  count: number;
  at: number;
  softwareTried: boolean;
}

/** One `MoviPlayer`, from open() to stop(). */
interface Session {
  /** Null while the URL resolves; one per open, never reused. */
  player: MoviPlayer | null;
  abort: AbortController;
  /** `ready`: loaded and at its start, so commands go straight to the player. */
  phase: 'resolving' | 'loading' | 'ready';
  /** Movi passes through a pause on its way to the first frame, which isn't the user's. */
  swallowPause: boolean;
  openedAt: number;
  assessment: Assessment | null;
}

/** The canvas, subtitle overlay and styles put beside the page's `<video>`. */
interface Surface {
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  sheet: HTMLStyleElement;
  observer: ResizeObserver;
  size: string;
}

/**
 * Movi's FFmpeg and WebCodecs player, drawing on a canvas put in place of the
 * page's `<video>`, so files a browser can't open play with all their tracks.
 * Movi draws the file's own subtitles; the page draws the server's and
 * dropped files.
 *
 * What the page relies on:
 * - `emit` carries no load identity, so the engine drops every event of a
 *   closed or replaced load itself.
 * - `load()` can be called twice without a `close()` between, and any command
 *   can arrive in any phase: before the first load, while loading, after a
 *   failure or after `close()`.
 * - `tracks` and `state{audio}` come before `loaded`, which fires once per
 *   `load()`; a reopen after an error emits `state{loaded}` and keeps the picks.
 * - `loaded`'s handler calls `setAudio` and `setSubtitle` from inside the
 *   emit, so the session isn't `ready` until after it.
 * - After `failed{retry}` the player is stopped, and `retry.run()` leads back
 *   to `started` and `loaded`.
 */
class MoviEngine implements PlayerEngine {
  // Engine lifetime: from create until the page unmounts.
  private surface: Surface | null = null;
  private fit: VideoFit = 'fit';
  private subtitleCss = '';
  private rate = 1;
  private statsTimer = 0;

  // Load lifetime: from load() until the next load() or close().
  private file: EngineFile | null = null;
  private intent: Intent = {
    positionMs: 0,
    paused: false,
    audio: null,
    subtitle: null,
    volume: null,
  };
  private subs: PageSubtitles = {
    delayMs: 0,
    cues: new Map(),
    files: [],
    shownText: '',
  };
  private recovery: Recovery = { count: 0, at: -1, softwareTried: false };

  // Session lifetime: from open() until stop().
  private session: Session | null = null;

  readonly ownSubtitles = true;
  readonly fits = true;

  constructor(
    private readonly video: React.RefObject<HTMLVideoElement | null>,
    private readonly emit: (event: EngineEvent) => void
  ) {}

  // ── Engine handlers ──

  load(file: EngineFile): void {
    this.file = file;
    this.intent = {
      positionMs: file.startMs,
      paused: !!file.paused,
      audio: null,
      subtitle: null,
      volume: file.volume,
    };
    // The text on screen is the previous file's until stop() clears it.
    this.subs = {
      delayMs: file.subtitleDelayMs,
      cues: new Map(),
      files: [],
      shownText: this.subs.shownText,
    };
    this.recovery = { count: 0, at: -1, softwareTried: false };
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    document.addEventListener('fullscreenchange', this.onFullscreen);
    this.onFullscreen();
    void this.open({ reopen: false });
  }

  close(): void {
    this.stop();
    clearInterval(this.statsTimer);
    this.statsTimer = 0;
    this.unmount();
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    this.file = null;
  }

  setPaused(paused: boolean): void {
    this.intent.paused = paused;
    const s = this.session;
    const p = s?.player;
    if (!s || !p || s.phase !== 'ready') return;
    s.swallowPause = false;
    if (paused) p.pause();
    else
      void p.play().catch((error: unknown) => {
        moviDebug('play-failed', { error: String(error) });
      });
  }

  seek(ms: number): void {
    this.intent.positionMs = ms;
    const s = this.session;
    const ready = s?.phase === 'ready';
    moviDebug('seek', { ms: Math.round(ms), ready });
    if (ready) void s.player?.seek(ms / 1000);
  }

  setVolume(volume: number, muted: boolean): void {
    this.intent.volume = { volume, muted };
    const p = this.session?.player;
    p?.setVolume(Math.min(1, volume));
    p?.setMuted(muted);
  }

  setRate(rate: number): void {
    this.rate = rate;
    const s = this.session;
    s?.player?.setPlaybackRate(rate);
    this.set({ rate });
    // Decode work scales with the speed.
    if (s) this.assess(s);
  }

  setAudio(id: string): void {
    this.intent.audio = id;
    this.session?.player?.selectAudioTrack(Number(id));
    moviDebug('audio', { id });
    this.set({ audio: id });
  }

  setSubtitle(id: string | null): void {
    this.intent.subtitle = id;
    this.drawText();
    this.set({ subtitle: id });
    const s = this.session;
    const p = s?.player;
    const selected = p && this.selectEmbedded(p);
    if (!id) return moviDebug('subtitle', { id });
    if (id.startsWith(EMBEDDED)) {
      moviDebug('subtitle', { id, path: 'embedded' });
      // Movi reads only the tracks it plays, ahead of the picture, so a
      // track picked once playing has nothing until that read-ahead runs
      // out; seeking where it is reads it again.
      if (s && p && selected && s.phase === 'ready')
        void selected.then(() => {
          if (this.live(s) && this.intent.subtitle === id)
            void p.seek(p.getCurrentTime());
        });
      return;
    }
    const server = this.file?.subtitles.find((s) => s.id === id);
    moviDebug('subtitle', { id, path: server ? 'server' : 'file' });
    if (!server || this.subs.cues.has(id)) return;
    this.fetchServerSubtitle(id, server.url);
  }

  setSubtitleDelay(ms: number): void {
    this.subs.delayMs = ms;
    moviDebug('subtitle-delay', { ms });
    this.drawText();
  }

  setStyle({ subtitleStyle, fit, lift }: EngineStyle): void {
    this.fit = fit;
    this.session?.player?.setFitMode(FIT[fit]);
    this.subtitleCss = subtitleStyle ? embeddedCss(subtitleStyle, lift) : '';
    if (this.surface) this.surface.sheet.textContent = this.subtitleCss;
  }

  toggleFullscreen = toggleDocumentFullscreen;

  ownText(id: string): string | null {
    return this.subs.files.find((f) => f.id === id)?.text ?? null;
  }

  subtitleFiles = {
    types: SUBTITLE_TYPES,
    add: async (added: File): Promise<void> => {
      checkSubtitleFile(added, SUBTITLE_TYPES);
      const { text, cues: read } = await readSubtitleFile(added);
      const { subs } = this;
      const id = `file:${subs.files.length}`;
      subs.cues.set(id, read);
      subs.files = [...subs.files, { id, label: added.name, text }];
      moviDebug('subtitle-file', {
        id,
        name: added.name,
        cues: read.length,
      });
      this.listTracks();
      this.setSubtitle(id);
    },
  };

  stats = {
    pages: [
      { id: 'movi', label: t`Playback` },
      { id: 'assessment', label: SMOOTHNESS_CHECK },
    ],
    show: (page: string | null): void => {
      clearInterval(this.statsTimer);
      this.statsTimer = 0;
      if (!page) return this.emit({ type: 'stats-text', text: undefined });
      const tick = () =>
        this.emit({ type: 'stats-text', text: this.statsText(page) });
      tick();
      this.statsTimer = window.setInterval(tick, STATS_MS);
    },
  };

  private onFullscreen = () => this.set({ fullscreen: isFullscreen() });

  // ── Movi handlers ──

  private bind(p: MoviPlayer): void {
    p.on('stateChange', this.onStateChange);
    p.on('timeUpdate', this.onTimeUpdate);
    // Movi never emits this.
    p.on('bufferUpdate', this.onBufferUpdate);
    p.on('durationChange', this.onDurationChange);
    p.on('tracksChange', this.onTracksChange);
    p.on('ended', this.onEnded);
    p.on('error', this.onError);
  }

  private onStateChange = (state: PlayerState): void => {
    const s = this.session!;
    moviDebug('state', state);
    if (state === 'playing') {
      this.intent.paused = false;
      s.swallowPause = false;
      this.set({ started: true, paused: false, waiting: false });
    } else if (state === 'paused') {
      // While loading, the pause wanted is what resume() ends on.
      if (s.swallowPause || s.phase !== 'ready') return;
      this.intent.paused = true;
      this.set({ paused: true, waiting: false });
    } else if (
      state === 'buffering' ||
      state === 'seeking' ||
      state === 'loading'
    )
      this.set({ waiting: true });
  };

  private onTimeUpdate = (seconds: number): void => {
    // Before resume() seeks, the time is the file's start, not the user's.
    if (this.session!.phase !== 'ready') return;
    const positionMs = seconds * 1000;
    const { recovery } = this;
    this.drawText();
    if (recovery.count && positionMs - recovery.at > RECOVERED_MS)
      recovery.count = 0;
    this.emit({
      type: 'position',
      positionMs,
      buffered: this.buffered(positionMs),
    });
  };

  private onBufferUpdate = (): void => {
    this.emit({ type: 'position', buffered: this.buffered() });
  };

  private onDurationChange = (seconds: number): void => {
    this.set({ durationMs: seconds * 1000 });
  };

  private onTracksChange = (): void => {
    this.listTracks();
  };

  private onEnded = (): void => {
    moviDebug('ended', {
      positionMs: Math.round(this.positionMs()),
      durationMs: Math.round((this.session!.player?.getDuration() ?? 0) * 1000),
    });
    this.emit({ type: 'ended' });
  };

  /** Only a ready session acts: while loading, the rejection of load() reports the same error. */
  private onError = (error: Error): void => {
    if (this.session!.phase !== 'ready')
      return moviDebug('error-ignored', { message: error?.message });
    this.handleFailure(error);
  };

  // ── Internal helpers: lifecycle ──

  private async open({ software = false, reopen = false } = {}): Promise<void> {
    this.stop();
    const file = this.file!;
    const s: Session = {
      player: null,
      abort: new AbortController(),
      phase: 'resolving',
      swallowPause: !this.intent.paused,
      openedAt: 0,
      assessment: null,
    };
    this.session = s;
    const el = this.video.current;
    if (!el) return;
    if (typeof WebAssembly === 'undefined' || !window.AudioContext)
      return this.fail(failedToStart());
    const surface = this.mount(el);
    this.set({ waiting: true });
    pointAtWasm();
    const url = await finalUrl(file.url, file.headers, s.abort.signal);
    if (!this.live(s)) return;
    moviDebug('load', {
      url: file.url,
      resolved: url,
      startMs: this.intent.positionMs,
      paused: this.intent.paused,
      headers: !!file.headers,
      software,
      reopen,
    });
    const p = this.createPlayer(file, url, surface.canvas, software);
    s.player = p;
    s.openedAt = performance.now();
    this.bind(p);
    this.applyIntent(p, surface);
    s.phase = 'loading';

    try {
      await p.load();
    } catch (error) {
      if (!this.live(s)) return;
      moviDebug('load-failed', { error: String(error) });
      return this.handleFailure(
        error instanceof Error ? error : new Error(String(error))
      );
    }
    if (!this.live(s)) return;
    this.announceOpened(s, p, reopen);
    await this.resume(s, p);
  }

  /** Whether `s` is still the open session, which every await in open() asks. */
  private live(s: Session): boolean {
    return this.session === s;
  }

  /** Closes the session. Its listeners go first, so what teardown emits goes nowhere. */
  private stop(): void {
    const s = this.session;
    s?.abort.abort();
    this.showText('');
    const p = s?.player;
    if (s && p) {
      moviDebug('close', {
        playedMs: Math.round(performance.now() - s.openedAt),
        positionMs: Math.round(this.positionMs()),
        stats: p.getStats(),
      });
      p.removeAllListeners();
      try {
        p.destroy();
      } catch {}
    }
    this.session = null;
  }

  private createPlayer(
    file: EngineFile,
    url: string,
    canvas: HTMLCanvasElement,
    software: boolean
  ): MoviPlayer {
    const p = new MoviPlayer({
      source: { type: 'url', url, headers: file.headers },
      canvas,
      renderer: 'canvas',
      decoder: software ? 'software' : 'auto',
    });
    if (moviDebugging)
      (window as unknown as { __movi?: MoviPlayer }).__movi = p;
    return p;
  }

  /** What Movi takes before load(). */
  private applyIntent(p: MoviPlayer, { canvas, overlay }: Surface): void {
    p.setSubtitleOverlay(overlay);
    p.setFitMode(FIT[this.fit]);
    p.setPlaybackRate(this.rate);
    const { volume } = this.intent;
    if (volume) {
      p.setVolume(Math.min(1, volume.volume));
      p.setMuted(volume.muted);
    }
    if (canvas.clientWidth && canvas.clientHeight)
      p.resizeCanvas(canvas.clientWidth, canvas.clientHeight);
  }

  /** Still `loading` here: `loaded`'s handler picks tracks from inside the emit. */
  private announceOpened(s: Session, p: MoviPlayer, reopen: boolean): void {
    const durationMs = p.getDuration() * 1000;
    s.assessment = null;
    this.assess(s);
    moviDebug('opened', this.describeOpened(p, durationMs));
    this.set({ durationMs });
    this.listTracks();
    this.emit({
      type: 'chapters',
      chapters: p.getChapters().map((c) => ({
        title: c.title?.trim() ?? '',
        startMs: Math.max(0, c.start * 1000),
      })),
    });
    const { intent } = this;
    if (reopen) {
      // The same file again: the picks it had still stand, and choosing
      // again would undo the user's.
      if (intent.audio) p.selectAudioTrack(Number(intent.audio));
      this.selectEmbedded(p);
      this.set({ loaded: true });
    } else {
      const active = p.trackManager.getActiveAudioTrack();
      intent.audio = active ? String(active.id) : null;
      this.set({ audio: intent.audio });
      this.emit({ type: 'loaded' });
    }
  }

  private async resume(s: Session, p: MoviPlayer): Promise<void> {
    // Pauses and seeks asked for while loading stand over the ones it started with.
    s.phase = 'ready';
    const at = this.intent.positionMs;
    if (at) {
      this.emit({ type: 'position', positionMs: at });
      await p.seek(at / 1000);
      if (!this.live(s)) return;
    }
    s.swallowPause = !this.intent.paused;
    if (this.intent.paused) return this.set({ paused: true, waiting: false });
    try {
      await p.play();
    } catch (error) {
      moviDebug('play-failed', { error: String(error) });
      if (this.live(s)) this.set({ paused: true, waiting: false });
    }
  }

  /** Where playback is: Movi's clock once loaded, the requested start before. */
  private positionMs(): number {
    const s = this.session;
    return s?.phase === 'ready' && s.player
      ? s.player.getCurrentTime() * 1000
      : this.intent.positionMs;
  }

  /** Movi knows only where its buffer ends, so it is one range from here. */
  private buffered(startMs = this.positionMs()): TimeRange[] {
    const endMs = (this.session?.player?.getBufferedTime() ?? 0) * 1000;
    return endMs > startMs ? [{ startMs, endMs }] : [];
  }

  // ── Internal helpers: tracks ──

  private listTracks(): void {
    const p = this.session?.player;
    const file = this.file;
    if (!p || !file) return;
    const tracks = p.getAudioTracks();
    const list: EngineTrack[] = [
      ...tracks.map((track, i) => {
        const stream = serverStream(ofType(file.source, 'Audio'), track);
        return {
          id: String(track.id),
          type: 'audio' as const,
          label: stream
            ? trackLabel(stream, i + 1)
            : ownTrackLabel(ownTitle(track), track.language, i + 1),
          lang: stream?.Language ?? track.language ?? undefined,
          title: stream?.Title ?? ownTitle(track),
          default: stream?.IsDefault ?? undefined,
        };
      }),
      ...p.getSubtitleTracks().map((track, i) => {
        const stream = serverStream(ofType(file.source, 'Subtitle'), track);
        return {
          id: `${EMBEDDED}${track.id}`,
          type: 'subtitle' as const,
          label: embeddedLabel(
            stream
              ? trackLabel(stream, i + 1)
              : ownTrackLabel(ownTitle(track), track.language, i + 1)
          ),
          lang: stream?.Language ?? track.language ?? undefined,
          title: stream?.Title ?? ownTitle(track),
          forced: stream?.IsForced ?? undefined,
          hearingImpaired: stream?.IsHearingImpaired ?? undefined,
          default: stream?.IsDefault ?? undefined,
        };
      }),
      ...this.subs.files.map(({ id, label }) => ({
        id,
        type: 'subtitle' as const,
        label,
        external: true,
      })),
    ];
    this.emit({ type: 'tracks', tracks: list });
  }

  // One of the file's own is movi's to draw; any other is drawn by the page.
  private selectEmbedded(p: MoviPlayer) {
    const { subtitle } = this.intent;
    const embedded = subtitle?.startsWith(EMBEDDED);
    return p.selectSubtitleTrack(
      embedded ? Number(subtitle!.slice(EMBEDDED.length)) : null
    );
  }

  // ── Internal helpers: page subtitles ──

  private set(state: EngineState): void {
    this.emit({ type: 'state', state });
  }

  private showText(text: string): void {
    if (text === this.subs.shownText) return;
    this.subs.shownText = text;
    this.emit({ type: 'subtitle-text', text });
  }

  // Movi reports the time every frame it plays, as a <video> times its cues.
  private drawText(): void {
    const { subtitle } = this.intent;
    const list = subtitle ? this.subs.cues.get(subtitle) : undefined;
    const at =
      (this.session?.player?.getCurrentTime() ?? 0) * 1000 - this.subs.delayMs;
    this.showText(list ? textAt(list, at) : '');
  }

  private fetchServerSubtitle(id: string, url: string): void {
    const { cues } = this.subs;
    cues.set(id, []);
    void fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject(res.status)))
      .then((body) => {
        const list = parseCues(body);
        cues.set(id, list);
        moviDebug('subtitle-loaded', { id, cues: list.length });
        if (id === this.intent.subtitle) this.drawText();
      })
      .catch((error: unknown) => {
        cues.delete(id);
        moviDebug('subtitle-failed', { id, error: String(error) });
      });
  }

  // ── Internal helpers: recovery ──

  private handleFailure(error: Error): void {
    const file = this.file;
    if (!file) return;
    const message = error?.message ?? String(error);
    const network = NETWORK.test(message) && !FATAL.test(message);
    const { recovery, intent } = this;
    const s = this.session;
    const player = s?.player;
    const at = this.positionMs();
    // What a reopen carries over.
    intent.positionMs = at;
    const active =
      s?.phase === 'ready' ? player?.trackManager.getActiveAudioTrack() : null;
    if (active) intent.audio = String(active.id);
    moviDebug('error', {
      message,
      network,
      recoveries: recovery.count,
      positionMs: Math.round(at),
      software: player?.isSoftwareDecoding(),
      stats: player?.getStats(),
    });
    if (network && recovery.count < RECOVERIES) {
      recovery.count++;
      recovery.at = at;
      moviDebug('recover', { attempt: recovery.count, positionMs: at });
      this.reopen();
      return;
    }
    this.stop();
    if (network) {
      const resumeAt = clock(at);
      return this.fail(failedToLoad(), {
        label: t`Resume from ${resumeAt}`,
        run: () => {
          this.recovery.count = 0;
          moviDebug('retry', { resume: at });
          this.reopen();
        },
      });
    }
    if (recovery.softwareTried) return this.fail(failedToDecode());
    this.fail(failedToDecode(), {
      label: TRY_SOFTWARE,
      run: () => {
        this.recovery.softwareTried = true;
        moviDebug('retry', { software: true, positionMs: at });
        this.reopen(true);
      },
    });
  }

  /** From the intent, which handleFailure filled with where the last player stood. */
  private reopen(software = false): void {
    void this.open({ software, reopen: true });
  }

  private fail(error: string, retry?: { label: string; run(): void }): void {
    moviDebug('failed', { error, retry: retry?.label });
    this.showText('');
    this.emit({ type: 'failed', error, retry });
  }

  // ── Internal helpers: surface ──

  private mount(el: HTMLVideoElement): Surface {
    if (this.surface) return this.surface;
    const canvas = document.createElement('canvas');
    canvas.dataset.ui = 'video-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    // Movi places the file's subtitles over the picture inside it.
    const overlay = document.createElement('div');
    overlay.dataset.ui = 'player-subtitle-embedded';
    overlay.style.cssText = 'position:absolute;pointer-events:none';
    // Beside the overlay, whose contents movi replaces.
    const sheet = document.createElement('style');
    sheet.textContent = this.subtitleCss;
    el.hidden = true;
    el.after(canvas, overlay, sheet);
    const observer = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = canvas;
      const size = `${w}x${h}`;
      const { surface } = this;
      if (!w || !h || !surface || size === surface.size) return;
      surface.size = size;
      this.session?.player?.resizeCanvas(w, h);
    });
    observer.observe(canvas);
    return (this.surface = { canvas, overlay, sheet, observer, size: '' });
  }

  private unmount(): void {
    const { surface } = this;
    if (!surface) return;
    surface.observer.disconnect();
    surface.canvas.remove();
    surface.overlay.remove();
    surface.sheet.remove();
    this.surface = null;
    if (this.video.current) this.video.current.hidden = false;
  }

  // ── Internal helpers: stats ──

  private statsText(page: string): string {
    const s = this.session;
    if (page === 'assessment') return assessmentText(s?.assessment ?? null);
    const stats = s?.player?.getStats() ?? {};
    return Object.entries(stats)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('\n');
  }

  // From the open file's tracks, so movi answers without reading anything more.
  private assess(s: Session): void {
    const p = s.player;
    if (!p) return;
    void MoviPlayer.assessPlayback(p.getMediaInfo()?.tracks ?? [], {
      rate: p.getPlaybackRate(),
    }).then((result) => {
      if (!this.live(s)) return;
      s.assessment = result;
      moviDebug('assessment', result);
    });
  }

  // ── Internal helpers: debug ──

  private describeOpened(p: MoviPlayer, durationMs: number) {
    return {
      durationMs,
      video: p.getVideoTracks().map((v) => ({
        id: v.id,
        codec: v.codec,
        size: `${v.width}x${v.height}`,
        fps: v.frameRate,
        hdr: v.isHDR,
      })),
      audio: p.getAudioTracks().map((a) => ({
        id: a.id,
        codec: a.codec,
        lang: a.language,
        label: a.label,
        channels: a.channels,
      })),
      subtitles: p.getSubtitleTracks().map((s) => ({
        id: s.id,
        codec: s.codec,
        lang: s.language,
        label: s.label,
        kind: s.subtitleType,
      })),
      chapters: p.getChapters().length,
      container: p.getMediaInfo()?.formatName,
      server: this.file?.source.MediaStreams?.map((s) => ({
        index: s.Index,
        type: s.Type,
        codec: s.Codec,
        lang: s.Language,
      })),
    };
  }
}

export function moviEngine(
  video: React.RefObject<HTMLVideoElement | null>
): EngineFactory {
  return (emit) => new MoviEngine(video, emit);
}
