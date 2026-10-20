import { t } from '@lingui/core/macro';
import type React from 'react';
import {
  Logger,
  LogLevel,
  MoviPlayer,
  type AudioTrack,
  type Track as MoviTrack,
} from 'movi-player/element/slim';
import type { VideoFit } from '../settings';
import { clock } from '../format';
import { sameLanguage } from '../languages';
import { parseCues, type SubtitleCue } from '../subtitles/cues';
import { checkSubtitleFile, readSubtitleCues } from '../subtitles/files';
import type { MediaStream } from '../types';
import { ofType, ownTrackLabel, trackLabel } from './controller';
import type {
  EngineFactory,
  EngineFile,
  EngineState,
  EngineTrack,
} from './engine';
import { isFullscreen, toggleDocumentFullscreen } from './fullscreen';
import { moviDebug, moviDebugging } from './movi-debug';
import { embeddedCss, linesOf, textAt } from './movi-subtitles';

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

const embeddedLabel = (label: string) =>
  t({
    comment: 'A subtitle track inside the video file',
    message: `Embedded: ${label}`,
  });

const failedToStart = () =>
  t({
    comment: 'Follows "Playback failed:"',
    message:
      "this browser can't run the player. Try another browser, an external player or the desktop app.",
  });

const failedToDecode = () =>
  t({
    comment: 'Follows "Playback failed:"',
    message: "this browser couldn't decode this version",
  });

const failedToLoad = () =>
  t({
    comment: 'Follows "Playback failed:"',
    message: 'the stream stopped loading',
  });

/**
 * Movi's FFmpeg and WebCodecs player, drawing on a canvas put in place of the
 * page's `<video>`, so files a browser can't open play with all their tracks.
 * Movi draws the file's own subtitles; the page draws the server's and
 * dropped files.
 */
export function moviEngine(
  video: React.RefObject<HTMLVideoElement | null>
): EngineFactory {
  return (emit) => {
    let file: EngineFile | null = null;
    let player: MoviPlayer | null = null;
    // Bumped by every open and close, so an old open's awaits stop short.
    let generation = 0;
    let abort = new AbortController();
    let surface: {
      canvas: HTMLCanvasElement;
      overlay: HTMLDivElement;
      sheet: HTMLStyleElement;
      observer: ResizeObserver;
      size: string;
    } | null = null;
    let fit: VideoFit = 'fit';
    let subtitleCss = '';
    let delayMs = 0;
    let paused = false;
    let positionMs = 0;
    let rate = 1;
    let audio: string | null = null;
    let subtitle: string | null = null;
    let tracks: AudioTrack[] = [];
    // Subtitles' cues, by the page's id.
    const cues = new Map<string, SubtitleCue[]>();
    let files: { id: string; label: string }[] = [];
    let shownText = '';
    let recoveries = 0;
    let recoveredAt = -1;
    let softwareTried = false;
    let statsTimer = 0;
    let openedAt = 0;
    let assessment: Assessment | null = null;
    // Movi passes through a pause on its way to the first frame, which isn't the user's.
    let starting = false;
    // Loaded and at its start, so pauses and seeks go to the player rather than wait for open().
    let ready = false;

    const set = (state: EngineState) => emit({ type: 'state', state });
    const showText = (text: string) => {
      if (text === shownText) return;
      shownText = text;
      emit({ type: 'subtitle-text', text });
    };

    // Movi reports the time every frame it plays, as a <video> times its cues.
    const drawText = () => {
      const list = subtitle ? cues.get(subtitle) : undefined;
      const at = (player?.getCurrentTime() ?? 0) * 1000 - delayMs;
      showText(list ? textAt(list, at) : '');
    };

    const listTracks = () => {
      const p = player;
      if (!p || !file) return;
      const from = file;
      tracks = p.getAudioTracks();
      const list: EngineTrack[] = [
        ...tracks.map((track, i) => {
          const stream = serverStream(ofType(from.source, 'Audio'), track);
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
          const stream = serverStream(ofType(from.source, 'Subtitle'), track);
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
        ...files.map(({ id, label }) => ({
          id,
          type: 'subtitle' as const,
          label,
          external: true,
        })),
      ];
      emit({ type: 'tracks', tracks: list });
    };

    const setAudio = (id: string) => {
      audio = id;
      player?.selectAudioTrack(Number(id));
      moviDebug('audio', { id });
      set({ audio: id });
    };

    // One of the file's own is movi's to draw; any other is drawn by the page.
    const selectEmbedded = (p: MoviPlayer) => {
      const embedded = subtitle?.startsWith(EMBEDDED);
      return p.selectSubtitleTrack(
        embedded ? Number(subtitle!.slice(EMBEDDED.length)) : null
      );
    };

    const setSubtitle = (id: string | null) => {
      subtitle = id;
      drawText();
      set({ subtitle: id });
      const p = player;
      const selected = p && selectEmbedded(p);
      if (!id) return moviDebug('subtitle', { id });
      if (id.startsWith(EMBEDDED)) {
        moviDebug('subtitle', { id, path: 'embedded' });
        // Movi reads only the tracks it plays, ahead of the picture, so a
        // track picked once playing has nothing until that read-ahead runs
        // out; seeking where it is reads it again.
        if (p && selected && ready)
          void selected.then(() => {
            if (p === player && subtitle === id)
              void p.seek(p.getCurrentTime());
          });
        return;
      }
      const server = file?.subtitles.find((s) => s.id === id);
      moviDebug('subtitle', { id, path: server ? 'server' : 'file' });
      if (!server || cues.has(id)) return;
      cues.set(id, []);
      void fetch(server.url)
        .then((res) => (res.ok ? res.text() : Promise.reject(res.status)))
        .then((body) => {
          const list = parseCues(body);
          cues.set(id, list);
          moviDebug('subtitle-loaded', { id, cues: list.length });
          if (id === subtitle) drawText();
        })
        .catch((error: unknown) => {
          cues.delete(id);
          moviDebug('subtitle-failed', { id, error: String(error) });
        });
    };

    // From the open file's tracks, so movi answers without reading anything more.
    const assess = (p: MoviPlayer) => {
      void MoviPlayer.assessPlayback(p.getMediaInfo()?.tracks ?? [], {
        rate,
      }).then((result) => {
        if (p !== player) return;
        assessment = result;
        moviDebug('assessment', result);
      });
    };

    const statsText = (page: string) => {
      if (page === 'assessment') return assessmentText(assessment);
      const stats = player?.getStats() ?? {};
      return Object.entries(stats)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join('\n');
    };

    const stop = () => {
      generation++;
      abort.abort();
      showText('');
      ready = false;
      const p = player;
      player = null;
      if (!p) return;
      moviDebug('close', {
        playedMs: Math.round(performance.now() - openedAt),
        positionMs: Math.round(positionMs),
        stats: p.getStats(),
      });
      try {
        p.destroy();
      } catch {}
    };

    const mount = (el: HTMLVideoElement) => {
      if (surface) return surface;
      const canvas = document.createElement('canvas');
      canvas.dataset.ui = 'video-canvas';
      canvas.style.cssText = 'display:block;width:100%;height:100%';
      // Movi places the file's subtitles over the picture inside it.
      const overlay = document.createElement('div');
      overlay.dataset.ui = 'player-subtitle-embedded';
      overlay.style.cssText = 'position:absolute;pointer-events:none';
      // Beside the overlay, whose contents movi replaces.
      const sheet = document.createElement('style');
      sheet.textContent = subtitleCss;
      el.hidden = true;
      el.after(canvas, overlay, sheet);
      const observer = new ResizeObserver(() => {
        const { clientWidth: w, clientHeight: h } = canvas;
        const size = `${w}x${h}`;
        if (!w || !h || !surface || size === surface.size) return;
        surface.size = size;
        player?.resizeCanvas(w, h);
      });
      observer.observe(canvas);
      return (surface = { canvas, overlay, sheet, observer, size: '' });
    };

    const unmount = () => {
      if (!surface) return;
      surface.observer.disconnect();
      surface.canvas.remove();
      surface.overlay.remove();
      surface.sheet.remove();
      surface = null;
      if (video.current) video.current.hidden = false;
    };

    const fail = (error: string, retry?: { label: string; run(): void }) => {
      moviDebug('failed', { error, retry: retry?.label });
      showText('');
      emit({ type: 'failed', error, retry });
    };

    const onError = (error: Error, gen: number): void => {
      if (gen !== generation || !file) return;
      const message = error?.message ?? String(error);
      const network = NETWORK.test(message) && !FATAL.test(message);
      moviDebug('error', {
        message,
        network,
        recoveries,
        positionMs: Math.round(positionMs),
        software: player?.isSoftwareDecoding(),
        stats: player?.getStats(),
      });
      const at = positionMs;
      const again = (software = false): Promise<void> =>
        open(file!, at, paused, { software, reopen: true });
      if (network && recoveries < RECOVERIES) {
        recoveries++;
        recoveredAt = at;
        moviDebug('recover', { attempt: recoveries, positionMs: at });
        void again();
        return;
      }
      stop();
      if (network) {
        const resumeAt = clock(at);
        return fail(failedToLoad(), {
          label: t`Resume from ${resumeAt}`,
          run: () => {
            recoveries = 0;
            moviDebug('retry', { resume: at });
            void again();
          },
        });
      }
      if (softwareTried) return fail(failedToDecode());
      fail(failedToDecode(), {
        label: t`Try software decoding`,
        run: () => {
          softwareTried = true;
          moviDebug('retry', { software: true, positionMs: at });
          void again(true);
        },
      });
    };

    async function open(
      next: EngineFile,
      startMs: number,
      startPaused: boolean,
      { software = false, reopen = false } = {}
    ): Promise<void> {
      stop();
      const gen = generation;
      paused = startPaused;
      positionMs = startMs;
      starting = !startPaused;
      abort = new AbortController();
      const el = video.current;
      if (!el) return;
      if (typeof WebAssembly === 'undefined' || !window.AudioContext)
        return fail(failedToStart());
      const { canvas, overlay } = mount(el);
      set({ waiting: true });
      pointAtWasm();
      const url = await finalUrl(next.url, next.headers, abort.signal);
      if (gen !== generation) return;
      moviDebug('load', {
        url: next.url,
        resolved: url,
        startMs,
        paused: startPaused,
        headers: !!next.headers,
        software,
        reopen,
      });
      const p = new MoviPlayer({
        source: { type: 'url', url, headers: next.headers },
        canvas,
        renderer: 'canvas',
        decoder: software ? 'software' : 'auto',
      });
      player = p;
      openedAt = performance.now();
      if (moviDebugging)
        (window as unknown as { __movi?: MoviPlayer }).__movi = p;
      p.on('stateChange', (state) => {
        if (gen !== generation) return;
        moviDebug('state', state);
        if (state === 'playing') {
          paused = false;
          starting = false;
          set({ started: true, paused: false, waiting: false });
        } else if (state === 'paused') {
          // While loading, the pause wanted is what open() ends on.
          if (starting || !ready) return;
          paused = true;
          set({ paused: true, waiting: false });
        } else if (
          state === 'buffering' ||
          state === 'seeking' ||
          state === 'loading'
        )
          set({ waiting: true });
      });
      p.on('timeUpdate', (seconds) => {
        // Before open() seeks, the time is the file's start, not the user's.
        if (gen !== generation || !ready) return;
        positionMs = seconds * 1000;
        drawText();
        if (recoveries && positionMs - recoveredAt > RECOVERED_MS)
          recoveries = 0;
        emit({
          type: 'position',
          positionMs,
          bufferedMs: p.getBufferedTime() * 1000,
        });
      });
      p.on('bufferUpdate', () => {
        if (gen === generation)
          emit({ type: 'position', bufferedMs: p.getBufferedTime() * 1000 });
      });
      p.on('durationChange', (seconds) => {
        if (gen === generation) set({ durationMs: seconds * 1000 });
      });
      p.on('tracksChange', () => {
        if (gen === generation) listTracks();
      });
      p.on('ended', () => {
        if (gen !== generation) return;
        moviDebug('ended', {
          positionMs: Math.round(positionMs),
          durationMs: Math.round(p.getDuration() * 1000),
        });
        emit({ type: 'ended' });
      });
      p.on('error', (error) => onError(error, gen));

      p.setSubtitleOverlay(overlay);
      p.setFitMode(FIT[fit]);
      p.setPlaybackRate(rate);
      if (next.volume) {
        p.setVolume(Math.min(1, next.volume.volume));
        p.setMuted(next.volume.muted);
      }
      if (canvas.clientWidth && canvas.clientHeight)
        p.resizeCanvas(canvas.clientWidth, canvas.clientHeight);

      try {
        await p.load();
      } catch (error) {
        if (gen !== generation) return;
        moviDebug('load-failed', { error: String(error) });
        return onError(
          error instanceof Error ? error : new Error(String(error)),
          gen
        );
      }
      if (gen !== generation) return;

      const durationMs = p.getDuration() * 1000;
      const info = p.getMediaInfo();
      assessment = null;
      assess(p);
      moviDebug('opened', {
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
        container: info?.formatName,
        server: next.source.MediaStreams?.map((s) => ({
          index: s.Index,
          type: s.Type,
          codec: s.Codec,
          lang: s.Language,
        })),
      });
      set({ durationMs });
      listTracks();
      emit({
        type: 'chapters',
        chapters: p.getChapters().map((c) => ({
          title: c.title?.trim() ?? '',
          startMs: Math.max(0, c.start * 1000),
        })),
      });
      if (reopen) {
        // The same file again: the picks it had still stand, and choosing
        // again would undo the user's.
        if (audio) p.selectAudioTrack(Number(audio));
        selectEmbedded(p);
        set({ loaded: true });
      } else {
        const active = p.trackManager.getActiveAudioTrack();
        audio = active ? String(active.id) : null;
        set({ audio });
        emit({ type: 'loaded' });
      }
      // Pauses and seeks asked for while loading stand over the ones it started with.
      ready = true;
      const at = positionMs;
      if (at) {
        emit({ type: 'position', positionMs: at });
        await p.seek(at / 1000);
        if (gen !== generation) return;
      }
      starting = !paused;
      if (paused) return set({ paused: true, waiting: false });
      try {
        await p.play();
      } catch (error) {
        moviDebug('play-failed', { error: String(error) });
        if (gen === generation) set({ paused: true, waiting: false });
      }
    }

    const onFullscreen = () => set({ fullscreen: isFullscreen() });

    return {
      load(next) {
        file = next;
        delayMs = next.subtitleDelayMs;
        audio = null;
        subtitle = null;
        positionMs = next.startMs;
        recoveries = 0;
        softwareTried = false;
        cues.clear();
        files = [];
        document.removeEventListener('fullscreenchange', onFullscreen);
        document.addEventListener('fullscreenchange', onFullscreen);
        onFullscreen();
        void open(next, next.startMs, !!next.paused);
      },
      close() {
        stop();
        clearInterval(statsTimer);
        statsTimer = 0;
        unmount();
        document.removeEventListener('fullscreenchange', onFullscreen);
        file = null;
      },
      setPaused(next) {
        paused = next;
        const p = player;
        if (!p || !ready) return;
        starting = false;
        if (next) p.pause();
        else
          void p.play().catch((error: unknown) => {
            moviDebug('play-failed', { error: String(error) });
          });
      },
      seek(ms) {
        positionMs = ms;
        moviDebug('seek', { ms: Math.round(ms), ready });
        if (ready) void player?.seek(ms / 1000);
      },
      setVolume(volume, muted) {
        player?.setVolume(Math.min(1, volume));
        player?.setMuted(muted);
      },
      setRate(next) {
        rate = next;
        player?.setPlaybackRate(next);
        set({ rate: next });
        // Decode work scales with the speed.
        if (player) assess(player);
      },
      setAudio,
      setSubtitle,
      setSubtitleDelay(ms) {
        delayMs = ms;
        moviDebug('subtitle-delay', { ms });
        drawText();
      },
      setStyle({ subtitleStyle, fit: nextFit, lift }) {
        fit = nextFit;
        player?.setFitMode(FIT[fit]);
        subtitleCss = subtitleStyle ? embeddedCss(subtitleStyle, lift) : '';
        if (surface) surface.sheet.textContent = subtitleCss;
      },
      toggleFullscreen: toggleDocumentFullscreen,
      // All of an added file.
      ownLines: async (id) => {
        const list = cues.get(id);
        return list?.length ? linesOf(list) : null;
      },
      subtitleFiles: {
        types: SUBTITLE_TYPES,
        add: async (added) => {
          checkSubtitleFile(added, SUBTITLE_TYPES);
          const read = await readSubtitleCues(added);
          const id = `file:${files.length}`;
          cues.set(id, read);
          files = [...files, { id, label: added.name }];
          moviDebug('subtitle-file', {
            id,
            name: added.name,
            cues: read.length,
          });
          listTracks();
          setSubtitle(id);
        },
      },
      stats: {
        pages: [
          { id: 'movi', label: t`Playback` },
          { id: 'assessment', label: t`Smoothness check` },
        ],
        show(page) {
          clearInterval(statsTimer);
          statsTimer = 0;
          if (!page) return emit({ type: 'stats-text', text: undefined });
          const tick = () =>
            emit({ type: 'stats-text', text: statsText(page) });
          tick();
          statsTimer = window.setInterval(tick, STATS_MS);
        },
      },
      ownSubtitles: true,
      fits: true,
    };
  };
}
