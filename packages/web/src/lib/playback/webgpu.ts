import { t } from '@lingui/core/macro';
import type React from 'react';
import { currentHost } from '@/lib/hosts';
import { appLog } from '@/lib/hosts/shell/bridge';
import { onSettingsChange, settings, type VideoFit } from '@/lib/settings';
import { plainCueText, type SubtitleCue } from '@/lib/subtitles/cues';
import {
  embeddedSubtitles,
  readsOwnSubtitles,
  type EmbeddedSubtitles,
  type SuppliedBlock,
} from '@/lib/subtitles/embedded';
import {
  checkSubtitleFile,
  readSubtitleFile,
  READABLE_SUBTITLE_TYPES,
} from '@/lib/subtitles/files';
import type { FileSubtitle } from '@/lib/subtitles/file-subtitle';
import { subtitleHeight } from '@/lib/subtitles/style';
import {
  pictureBox,
  type PictureSurface,
  type SubtitleLayer,
} from '@/lib/subtitles/surface';
import { ownTrackLabel } from './controller';
import type {
  EngineFactory,
  EngineFile,
  EngineState,
  EngineTrack,
} from './engine';
import {
  canFullscreen,
  isFullscreen,
  onFullscreenChange,
  toggleDocumentFullscreen,
} from './fullscreen';
import { canPlayWithWebGpu } from './player-choice';
import {
  drawSubtitle,
  fetchCues,
  ownLines,
  ownSubtitleTrack,
  ownTrackLost,
  readOwnCues,
} from './page-subtitles';
import upscalePass from './aiostreams-upscale.wgsl';
import { onShadersChange, readShaders } from './shaders';
import { onUpscalingChange, upscalingOn } from './upscaling';
import { gpuStatsRows, UPSCALE_PASS, type GpuStats } from './webgpu-stats';

interface GpuAudioTrack {
  ordinal: number;
  codec: string | null;
  channels: number | null;
  language: string | null;
  title: string | null;
  isDefault: boolean;
}

type GpuOpened =
  | {
      eligible: true;
      audio: GpuAudioTrack[];
      audioOrdinal: number | null;
      width: number | null;
      height: number | null;
      durationMs: number | null;
      route: string;
    }
  | { eligible: false; reason: string };

interface GpuPlayer {
  open(request: {
    url: string;
    startMs: number;
    paused: boolean;
    audioOrdinal: number | null;
    volume: number;
    muted: boolean;
    rate: number;
  }): Promise<GpuOpened>;
  play(): void;
  pause(): void;
  seek(ms: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setRate(rate: number): void;
  setAudio(ordinal: number): Promise<GpuOpened>;
  presentedMs(): number | null;
  stats(): GpuStats | null;
  setPasses(sources: readonly string[]): Promise<{
    inactivePasses: readonly { name: string; reason: string; detail: string }[];
  }>;
  setHDROutput(enabled: boolean): Promise<void>;
  captureStream(): MediaStream | null;
  destroy(): void;
}

interface GpuEvents {
  onState(state: 'loading' | 'playing' | 'paused' | 'waiting' | 'ended'): void;
  onTime(ms: number): void;
  onDuration(ms: number | null): void;
  onFallback(reason: string, atMs: number): void;
  onError(message: string): void;
  onSubtitleBlocks(blocks: readonly SuppliedBlock[]): void;
}

interface GpuModule {
  isEmbeddedPlayerSupported(): boolean;
  warmUp(isPlaybackActive: () => boolean): Promise<void>;
  createEmbeddedPlayer(
    surface: { container: HTMLDivElement; video: HTMLVideoElement },
    events: GpuEvents
  ): GpuPlayer;
}

let loading: Promise<GpuModule | null> | undefined;

function loadModule(): Promise<GpuModule | null> {
  loading ??= import(
    /* webpackIgnore: true */ new URL(
      __WEBGPU_PLAYER_MODULE__,
      new URL(__webpack_public_path__, location.href)
    ).href
  ).then(
    (module: GpuModule) => (module.isEmbeddedPlayerSupported() ? module : null),
    (error: unknown) => {
      appLog('warn', `webgpu: the engine could not load: ${String(error)}`);
      loading = undefined;
      return null;
    }
  );
  return loading;
}

/** Runs the engine's decoder tests and compiles its GPU decoders before the first playback needs them. */
export async function warmWebGpu(isPlaybackActive: () => boolean) {
  await (await loadModule())?.warmUp(isPlaybackActive);
}

const GESTURES = ['pointerdown', 'keydown', 'touchend'];
/** Upscaling stays off for a video that drops this share of a window's frames with it. */
const MAX_DROPPED = 0.2;
const DROP_WINDOW_FRAMES = 60;

/** The engine's audio only starts once the page has had a click or key press. */
function activated(): Promise<void> {
  const activation = navigator.userActivation;
  if (!activation || activation.hasBeenActive) return Promise.resolve();
  return new Promise((done) => {
    const on = () => {
      if (!activation.hasBeenActive) return;
      for (const type of GESTURES) removeEventListener(type, on, true);
      done();
    };
    for (const type of GESTURES) addEventListener(type, on, true);
  });
}

interface FileTrack {
  id: string;
  label: string;
  text: string;
  cues: SubtitleCue[];
}

/**
 * WebGPU-Player, drawing over the page's `<video>`, whose box and fit it
 * takes. Text subtitles show as the page's text, styled ones and pictures in
 * layers over the picture.
 */
export function webGpuEngine(
  video: React.RefObject<HTMLVideoElement | null>
): EngineFactory {
  return (emit) => {
    let player: GpuPlayer | null = null;
    let file: EngineFile | null = null;
    // So a slow open that a newer load replaced does nothing.
    let opening = 0;
    let position = 0;
    let paused = false;
    let size: { width: number; height: number } | null = null;
    let volume = 1;
    let muted = false;
    let rate = 1;
    let fit: VideoFit | undefined;
    let audioTracks: GpuAudioTrack[] = [];
    let subtitle: string | null = null;
    let delayMs = 0;
    let height = subtitleHeight();
    let layer: SubtitleLayer | null = null;
    let assFailed = false;
    let embedded: EmbeddedSubtitles | null = null;
    let ownTracks: FileSubtitle[] = [];
    let stopOwnText = () => {};
    let files: FileTrack[] = [];
    let cues: SubtitleCue[] = [];
    let shownText = '';
    let textFrame = 0;
    let shownAt: number | null = null;
    const moved = new Set<() => void>();
    let detach: (() => void)[] = [];
    let lastClock: { clockMs: number; at: number } | null = null;
    let struggling = false;
    // Picture-in-picture shows the canvas as a stream in a video of its own.
    let pip: HTMLVideoElement | null = null;
    const leavePip = () => {
      const shown = pip;
      pip = null;
      if (!shown) return;
      if (document.pictureInPictureElement === shown)
        void document.exitPictureInPicture().catch(() => {});
      for (const track of (
        shown.srcObject as MediaStream | null
      )?.getTracks() ?? [])
        track.stop();
      shown.srcObject = null;
      shown.remove();
    };
    let dropBase: { shown: number; dropped: number } | null = null;

    const set = (state: EngineState) => emit({ type: 'state', state });
    const surface: PictureSurface = {
      box() {
        const el = video.current;
        if (!el) return { x: 0, y: 0, width: innerWidth, height: innerHeight };
        return pictureBox(el, size?.width ?? 0, size?.height ?? 0);
      },
      // Over the engine's canvas.
      zIndex: () => '2',
      insert: (canvas) => video.current?.after(canvas),
      frames(shown) {
        let frame = 0;
        let last: number | null = null;
        const tick = () => {
          const ms = player?.presentedMs() ?? null;
          if (ms !== null && ms !== last) {
            last = ms;
            shown({
              mediaTime: ms / 1000,
              width: size?.width ?? 0,
              height: size?.height ?? 0,
            });
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
      },
      watch(onMoved) {
        const el = video.current;
        const resize = new ResizeObserver(onMoved);
        if (el) resize.observe(el);
        moved.add(onMoved);
        return () => {
          resize.disconnect();
          moved.delete(onMoved);
        };
      },
    };

    const showText = () => {
      const at = (player?.presentedMs() ?? position) - delayMs;
      if (at === shownAt) return;
      shownAt = at;
      const text = cues
        .filter((c) => c.startMs <= at && at < c.endMs)
        .map((c) => plainCueText(c.text))
        .filter(Boolean)
        .join('\n');
      if (text === shownText) return;
      shownText = text;
      emit({ type: 'subtitle-text', text });
    };
    const followText = (on: boolean) => {
      cancelAnimationFrame(textFrame);
      textFrame = 0;
      shownAt = null;
      if (!on) {
        if (shownText) emit({ type: 'subtitle-text', text: '' });
        shownText = '';
        return;
      }
      const tick = () => {
        showText();
        textFrame = requestAnimationFrame(tick);
      };
      tick();
    };

    const listTracks = () => {
      const tracks: EngineTrack[] = [
        ...audioTracks.map((t, i) => ({
          id: String(t.ordinal),
          type: 'audio' as const,
          label: ownTrackLabel(
            t.title ?? undefined,
            t.language ?? undefined,
            i + 1
          ),
          lang: t.language ?? undefined,
          title: t.title ?? undefined,
          codec: t.codec ?? undefined,
          default: t.isDefault,
        })),
        ...ownTracks.map(ownSubtitleTrack),
        ...files.map(({ id, label }) => ({
          id,
          type: 'subtitle' as const,
          label,
          external: true,
        })),
      ];
      emit({ type: 'tracks', tracks });
    };

    const setSubtitle = (id: string | null) => {
      subtitle = id;
      layer?.destroy();
      layer = null;
      stopOwnText();
      stopOwnText = () => {};
      cues = [];
      const picked = drawSubtitle(
        id,
        { own: ownTracks, embedded, server: file?.subtitles ?? [] },
        surface,
        { delayMs, height },
        {
          assFailed,
          onAssFail() {
            assFailed = true;
            setSubtitle(id);
          },
        }
      );
      layer = picked.layer;
      if (!picked.drawn) {
        if (picked.own && embedded)
          stopOwnText = readOwnCues(embedded, picked.own.number, cues, {
            read: () => (shownAt = null),
            lost: ownTrackLost,
          });
        else if (picked.server)
          fetchCues(picked.server.url, (read) => {
            if (subtitle !== id) return;
            cues = read;
            shownAt = null;
          });
        else cues = files.find((f) => f.id === id)?.cues ?? [];
      }
      followText(!!id && !layer);
      set({ subtitle: id });
    };

    /** Keeps the files the user added. */
    const stop = () => {
      opening++;
      for (const undo of detach) undo();
      detach = [];
      followText(false);
      layer?.destroy();
      layer = null;
      stopOwnText();
      stopOwnText = () => {};
      embedded?.close();
      embedded = null;
      ownTracks = [];
      audioTracks = [];
      size = null;
      leavePip();
      player?.destroy();
      player = null;
    };

    const applyPasses = async (shown: GpuPlayer) => {
      const sources = (await readShaders().catch(() => [])).map((s) => s.text);
      if (shown !== player) return;
      if (upscalingOn() && !struggling) sources.push(upscalePass);
      const { inactivePasses } = await shown.setPasses(sources);
      for (const { name, reason, detail } of inactivePasses)
        if (reason !== 'condition-false')
          appLog('warn', `webgpu: pass ${name} left out: ${reason} ${detail}`);
    };
    const reapply = () => {
      if (player) void applyPasses(player).catch(() => {});
    };

    const watchDrops = () => {
      const stats = player?.stats();
      if (
        !stats ||
        paused ||
        struggling ||
        !stats.passes.includes(UPSCALE_PASS)
      ) {
        dropBase = null;
        return;
      }
      const now = {
        shown: stats.framesPresented,
        dropped: stats.framesDropped,
      };
      if (!dropBase) {
        dropBase = now;
        return;
      }
      const dropped = now.dropped - dropBase.dropped;
      const frames = now.shown - dropBase.shown + dropped;
      if (frames < DROP_WINDOW_FRAMES) return;
      dropBase = now;
      if (dropped / frames < MAX_DROPPED) return;
      struggling = true;
      appLog(
        'info',
        'webgpu: upscaling is off for this video, which dropped frames with it'
      );
      reapply();
    };

    const unplayable = (reason: string, positionMs?: number) => {
      stop();
      emit({ type: 'unplayable', reason, positionMs });
    };

    const events = (load: number): GpuEvents => {
      const current = () => load === opening;
      return {
        onState(state) {
          if (!current()) return;
          if (state === 'playing') {
            paused = false;
            void pip?.play().catch(() => {});
            embedded?.setPlaying(true);
            set({ started: true, paused: false, waiting: false });
          } else if (state === 'paused') {
            paused = true;
            pip?.pause();
            set({ paused: true, waiting: false });
          } else if (state === 'ended') emit({ type: 'ended' });
          else set({ waiting: true });
        },
        onTime(ms) {
          if (!current()) return;
          position = ms;
          embedded?.setPosition(ms, null);
          emit({ type: 'position', positionMs: ms });
        },
        onDuration(ms) {
          if (current() && ms) set({ durationMs: ms });
        },
        onFallback(reason, atMs) {
          if (current()) unplayable(reason, atMs);
        },
        onError(message) {
          if (current()) unplayable(message, position);
        },
        onSubtitleBlocks(blocks) {
          if (current()) embedded?.supply(blocks);
        },
      };
    };

    const open = async (next: EngineFile, load: number) => {
      const module = await loadModule();
      const el = video.current;
      const container = el?.parentElement;
      if (load !== opening) return;
      if (!module || !el || !(container instanceof HTMLDivElement))
        return unplayable('engine-unavailable');
      if (navigator.userActivation?.hasBeenActive === false) {
        paused = true;
        set({ paused: true, waiting: false });
        await activated();
        if (load !== opening) return;
      }
      const opened = (player = module.createEmbeddedPlayer(
        { container, video: el },
        events(load)
      ));
      await Promise.all([
        applyPasses(opened).catch((error: unknown) =>
          appLog('warn', `webgpu: passes not set: ${String(error)}`)
        ),
        opened.setHDROutput(settings.video.hdrOutput.read()).catch(() => {}),
      ]);
      if (load !== opening) return;
      const asked = paused;
      const result = await opened.open({
        url: next.url,
        startMs: next.startMs,
        paused: asked,
        audioOrdinal: null,
        volume,
        muted,
        rate,
      });
      if (load !== opening) return;
      if (!result.eligible) return unplayable(result.reason);
      appLog('info', `webgpu: playing (${result.route})`);
      if (paused !== asked) {
        if (paused) opened.pause();
        else opened.play();
      }
      size =
        result.width && result.height
          ? { width: result.width, height: result.height }
          : null;
      moved.forEach((onMoved) => onMoved());
      if (result.durationMs) set({ durationMs: result.durationMs });
      audioTracks = result.audio;
      listTracks();
      set({
        audio:
          result.audioOrdinal === null ? null : String(result.audioOrdinal),
      });
      if (embedded) await embedded.listed();
      if (load === opening) emit({ type: 'loaded' });
    };

    return {
      load(next) {
        stop();
        const load = opening;
        file = next;
        position = next.startMs;
        paused = !!next.paused;
        struggling = false;
        dropBase = null;
        delayMs = next.subtitleDelayMs;
        subtitle = null;
        if (next.volume) {
          volume = Math.min(1, next.volume.volume);
          muted = next.volume.muted;
        }
        // The engine reads files with plain requests.
        if (
          !canPlayWithWebGpu() ||
          next.source.IsInfiniteStream ||
          (next.headers && Object.keys(next.headers).length)
        )
          return unplayable('source-unsupported');
        const onFullscreen = () => set({ fullscreen: isFullscreen() });
        detach.push(onFullscreenChange(onFullscreen));
        onFullscreen();
        const drops = setInterval(watchDrops, 1000);
        detach.push(
          onUpscalingChange(reapply),
          onShadersChange(reapply),
          onSettingsChange(() => {
            void player
              ?.setHDROutput(settings.video.hdrOutput.read())
              .catch(() => {});
          }),
          () => clearInterval(drops)
        );
        if (next.paused) set({ paused: true });
        if (readsOwnSubtitles(next.source)) {
          const reading = embeddedSubtitles(
            next.url,
            next.headers,
            currentHost().fetchFile
          );
          embedded = reading;
          void reading.subtitles.then((found) => {
            if (embedded !== reading) return;
            ownTracks = found;
            if (ownTracks.length) listTracks();
          });
        }
        void open(next, load).catch((error: unknown) => {
          if (load === opening) unplayable(String(error));
        });
      },
      close() {
        stop();
        file = null;
      },
      setPaused(next) {
        paused = next;
        if (next) player?.pause();
        else player?.play();
      },
      seek(ms) {
        player?.seek(ms);
        position = ms;
        dropBase = null;
        shownAt = null;
        embedded?.setPosition(ms, null);
        emit({ type: 'position', positionMs: ms });
      },
      setVolume(next, nextMuted) {
        volume = Math.min(1, next);
        muted = nextMuted;
        player?.setVolume(volume);
        player?.setMuted(muted);
        set({ volume, muted });
      },
      setRate(next) {
        rate = next;
        player?.setRate(next);
        set({ rate: next });
      },
      setAudio(id) {
        const shown = player;
        const load = opening;
        if (!shown) return;
        set({ audio: id });
        void shown.setAudio(Number(id)).then((result) => {
          if (load === opening && !result.eligible)
            unplayable(result.reason, position);
        });
      },
      setSubtitle,
      setSubtitleDelay(ms) {
        delayMs = ms;
        shownAt = null;
        layer?.setDelay(ms);
      },
      setStyle(next) {
        height = next.height;
        layer?.setHeight(next.height);
        if (next.fit !== fit) layer?.place();
        fit = next.fit;
      },
      toggleFullscreen: canFullscreen() ? toggleDocumentFullscreen : undefined,
      ...(document.pictureInPictureEnabled &&
        'captureStream' in HTMLCanvasElement.prototype && {
          async togglePictureInPicture() {
            if (pip) return leavePip();
            const stream = player?.captureStream();
            if (!stream) return;
            const shown = document.createElement('video');
            shown.muted = true;
            shown.playsInline = true;
            shown.srcObject = stream;
            shown.className = 'pointer-events-none absolute size-px opacity-0';
            (video.current?.parentElement ?? document.body).append(shown);
            pip = shown;
            shown.addEventListener('leavepictureinpicture', leavePip);
            // The window's own play and pause buttons act on this video.
            shown.addEventListener('pause', () => {
              if (pip === shown && !paused) player?.pause();
            });
            shown.addEventListener('play', () => {
              if (pip === shown && paused) player?.play();
            });
            try {
              await shown.play();
              await shown.requestPictureInPicture();
            } catch (error) {
              appLog('warn', `webgpu: picture-in-picture: ${String(error)}`);
              leavePip();
            }
          },
        }),
      ownText: (id) => files.find((f) => f.id === id)?.text ?? null,
      ...ownLines(() => embedded),
      subtitleFiles: {
        types: READABLE_SUBTITLE_TYPES,
        add: async (added) => {
          checkSubtitleFile(added, READABLE_SUBTITLE_TYPES);
          const { text, cues: read } = await readSubtitleFile(added);
          const id = `file:${files.length}`;
          files = [...files, { id, label: added.name, text, cues: read }];
          listTracks();
          setSubtitle(id);
        },
      },
      stats: {
        get pages() {
          return [{ id: 'playback', label: t`Playback` }];
        },
        read: async () => {
          const stats = player?.stats();
          if (!stats) return [];
          const at = performance.now();
          const last = lastClock;
          lastClock = { clockMs: stats.clockMs, at };
          const speed =
            last && at > last.at
              ? (stats.clockMs - last.clockMs) / (at - last.at)
              : null;
          return gpuStatsRows(stats, speed);
        },
      },
      fits: true,
    };
  };
}
