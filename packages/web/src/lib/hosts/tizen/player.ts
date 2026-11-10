import { t } from '@lingui/core/macro';
import { sameLanguage } from '../../languages';
import {
  parseCues,
  plainCueText,
  type SubtitleCue,
} from '../../subtitles/cues';
import {
  embeddedSubtitles,
  isMatroska,
  type EmbeddedSubtitles,
} from '../../subtitles/embedded';
import { assLayer, canDrawAss } from '../../subtitles/libass';
import type { MkvSubtitle } from '../../subtitles/matroska/file';
import { subtitleHeight } from '../../subtitles/style';
import type { PictureSurface, SubtitleLayer } from '../../subtitles/surface';
import { ownTrackLabel } from '../../playback/controller';
import { appLog } from '../shell/bridge';
import type {
  EngineFactory,
  EngineFile,
  EngineState,
  EngineTrack,
} from '../../playback/engine';
import type { AvPlay } from '.';

interface AvTrack {
  index: number;
  language?: string;
  codec?: string;
  label: string;
}

const EMBEDDED = 'embedded:';
const TICK_MS = 250;
/** Samsung's TVs since 2018 can't decode it. */
const DTS = /dts/i;

function tracksOf(av: AvPlay, type: 'AUDIO' | 'TEXT'): AvTrack[] {
  return av
    .getTotalTrackInfo()
    .filter((t) => t.type === type)
    .map((t, i) => {
      let info: Record<string, string> = {};
      try {
        info = JSON.parse(t.extra_info) ?? {};
      } catch {}
      const language = info.language ?? info.track_lang;
      const codec = info.fourCC;
      return {
        index: t.index,
        language,
        codec,
        label: ownTrackLabel(
          type === 'AUDIO' ? codec : undefined,
          language,
          i + 1
        ),
      };
    });
}

function errorMessage(error: unknown): string {
  const code = String((error as { name?: string } | null)?.name ?? error);
  if (/CONNECTION|NETWORK|INVALID_URI|TIMEOUT/i.test(code))
    return t`the TV could not load the stream`;
  if (/NOT_SUPPORTED|UNSUPPORTED/i.test(code))
    return t`the TV cannot play this format`;
  return t`the TV's player failed (${code})`;
}

function videoSizeOf(av: AvPlay): { width: number; height: number } | null {
  try {
    const video = av.getCurrentStreamInfo().find((t) => t.type === 'VIDEO');
    const info = JSON.parse(video?.extra_info ?? '{}') as Record<
      string,
      string
    >;
    const width = Number(info.Width ?? info.width);
    const height = Number(info.Height ?? info.height);
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

/**
 * Samsung's own player, drawn beneath the page through an
 * `application/avplayer` object. It draws no subtitles and can't fetch them,
 * so the page draws both the file's and the server's from their text, except
 * styled scripts and PGS pictures, which it draws over the picture. Its volume
 * is the TV's.
 */
export const avPlayEngine: EngineFactory = (emit) => {
  const av = window.webapis!.avplay!;
  const audioControl = window.tizen?.tvaudiocontrol;
  const report = (state: EngineState) => emit({ type: 'state', state });
  let file: EngineFile | null = null;
  let position = 0;
  // When AVPlay last said where it was, and whether it was playing on.
  let positionAt = 0;
  let playing = false;
  let videoSize: { width: number; height: number } | null = null;
  let object: HTMLObjectElement | null = null;
  let liftHeight = subtitleHeight();
  let layer: SubtitleLayer | null = null;
  let assFailed = false;
  let embedded: EmbeddedSubtitles | null = null;
  // The file's subtitle tracks once read, beside the ones AVPlay lists.
  let ownTracks: MkvSubtitle[] | null = null;
  let textTracks: AvTrack[] = [];
  // Tracks whose reads failed for good, which AVPlay draws as text instead.
  const lost = new Set<string>();
  const moved = new Set<() => void>();
  let delayMs = 0;
  let externalCues: SubtitleCue[] = [];
  let embeddedCue: SubtitleCue | null = null;
  let subtitle: string | null = null;
  // No other call may reach AVPlay until a seek reports back.
  let seeking = false;
  let nextSeek: number | null = null;
  let queued: (() => void)[] = [];
  let teardown = () => {};
  const run = (fn: () => void) => {
    if (seeking) queued.push(fn);
    else fn();
  };

  // AVPlay letterboxes its picture in the whole window, under the page.
  const surface: PictureSurface = {
    box() {
      const { innerWidth: w, innerHeight: h } = window;
      if (!videoSize) return { x: 0, y: 0, width: w, height: h };
      const scale = Math.min(w / videoSize.width, h / videoSize.height);
      const width = videoSize.width * scale;
      const height = videoSize.height * scale;
      return { x: (w - width) / 2, y: (h - height) / 2, width, height };
    },
    zIndex: () => 'auto',
    insert: (canvas) =>
      object ? object.after(canvas) : document.body.prepend(canvas),
    frames(shown) {
      let frame = 0;
      let lastMs = 0;
      const tick = () => {
        // Between AVPlay's reports its clock runs on, as it only plays at 1x.
        let ms = playing ? position + performance.now() - positionAt : position;
        // A report a little behind the estimate isn't a step back.
        if (playing && ms < lastMs && lastMs - ms < TICK_MS * 2) ms = lastMs;
        lastMs = ms;
        const { width, height } = videoSize ?? surface.box();
        shown({ mediaTime: ms / 1000, width, height });
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    },
    watch(onMoved) {
      moved.add(onMoved);
      window.addEventListener('resize', onMoved);
      return () => {
        moved.delete(onMoved);
        window.removeEventListener('resize', onMoved);
      };
    },
  };

  const showText = () => {
    const at = position - delayMs;
    const cues = [...externalCues, embeddedCue].filter(
      (c): c is SubtitleCue => !!c && c.startMs <= at && at < c.endMs
    );
    emit({
      type: 'subtitle-text',
      text: cues.map((c) => plainCueText(c.text)).join('\n'),
    });
  };

  const seekTo = (ms: number) => {
    position = ms;
    positionAt = performance.now();
    emit({ type: 'position', positionMs: ms });
    if (seeking) {
      nextSeek = ms;
      return;
    }
    seeking = true;
    const done = () => {
      seeking = false;
      const next = nextSeek;
      nextSeek = null;
      if (next !== null) return seekTo(next);
      const fns = queued;
      queued = [];
      fns.forEach((fn) => fn());
    };
    try {
      av.seekTo(ms, done, done);
    } catch {
      done();
    }
  };

  /** By its place among the text tracks, where both lists agree on how many there are and their languages. */
  const ownTrack = (id: string): MkvSubtitle | null => {
    if (!ownTracks || ownTracks.length !== textTracks.length) return null;
    const ordinal = textTracks.findIndex((t) => `${EMBEDDED}${t.index}` === id);
    const track = ownTracks[ordinal];
    const drawn =
      track?.kind === 'pgs' ||
      (track?.kind === 'ass' && canDrawAss() && !assFailed);
    if (!drawn) return null;
    const listed = textTracks[ordinal].language;
    if (listed && track.language && !sameLanguage(listed, track.language))
      return null;
    return track;
  };

  const setSubtitle = (id: string | null) => {
    subtitle = id;
    externalCues = [];
    embeddedCue = null;
    layer?.destroy();
    layer = null;
    report({ subtitle: id });
    const start = { delayMs, height: liftHeight };
    const failed = (error: unknown) => {
      appLog(
        'warn',
        `subtitles: libass could not start, so they show as text: ${String(error)}`
      );
      assFailed = true;
      setSubtitle(id);
    };
    const own =
      id?.startsWith(EMBEDDED) && embedded && !lost.has(id)
        ? ownTrack(id)
        : null;
    if (own && embedded)
      layer = embedded.draw(own.number, surface, start, {
        onFail: failed,
        onLost: (error) => {
          appLog(
            'warn',
            `subtitles: the file's own track could not be read, so avplay draws it: ${String(error)}`
          );
          lost.add(id!);
          setSubtitle(id);
        },
      });
    const native = !!id?.startsWith(EMBEDDED) && !layer;
    run(() => {
      try {
        if (native)
          av.setSelectTrack('TEXT', Number(id!.slice(EMBEDDED.length)));
        av.setSilentSubtitle(!native);
      } catch {}
    });
    if (layer) return showText();
    const server = file?.subtitles.find((s) => s.id === id);
    if (server?.assUrl && canDrawAss() && !assFailed) {
      layer = assLayer(surface, { url: server.assUrl }, start, failed);
      return showText();
    }
    if (!server) return showText();
    void fetch(server.url)
      .then((res) => (res.ok ? res.text() : ''))
      .then((body) => {
        if (subtitle !== id) return;
        externalCues = parseCues(body);
        showText();
      })
      .catch(() => {});
  };

  return {
    load(next) {
      teardown();
      file = next;
      position = next.startMs;
      delayMs = next.subtitleDelayMs;
      subtitle = null;
      externalCues = [];
      embeddedCue = null;
      seeking = false;
      nextSeek = null;
      queued = [];
      report({
        volume: (audioControl?.getVolume() ?? 100) / 100,
        muted: audioControl?.isMute() ?? false,
      });
      positionAt = performance.now();
      playing = false;
      videoSize = null;
      ownTracks = null;
      textTracks = [];
      lost.clear();
      if (isMatroska(next.source)) {
        const opened = embeddedSubtitles(next.url, next.headers);
        embedded = opened;
        void opened.subtitles.then((found) => {
          if (embedded !== opened) return;
          ownTracks = found;
          // A track AVPlay already shows moves to the page's drawing.
          if (subtitle?.startsWith(EMBEDDED)) setSubtitle(subtitle);
        });
      }
      const shown = document.createElement('object');
      object = shown;
      shown.type = 'application/avplayer';
      shown.style.cssText =
        'position:fixed;left:0;top:0;width:100%;height:100%';
      document.body.prepend(shown);

      const onPrepared = () => {
        videoSize = videoSizeOf(av);
        moved.forEach((onMoved) => onMoved());
        const audio = tracksOf(av, 'AUDIO');
        const text = tracksOf(av, 'TEXT');
        textTracks = text;
        const tracks: EngineTrack[] = [
          ...audio.map((t) => ({
            id: String(t.index),
            type: 'audio' as const,
            label: t.label,
            lang: t.language,
            unplayable: DTS.test(t.codec ?? ''),
          })),
          ...text.map((t) => ({
            id: `${EMBEDDED}${t.index}`,
            type: 'subtitle' as const,
            label: t.label,
            lang: t.language,
          })),
        ];
        emit({ type: 'tracks', tracks });
        const duration = av.getDuration();
        if (duration) report({ durationMs: duration });
        const current = av
          .getCurrentStreamInfo()
          .find((t) => t.type === 'AUDIO')?.index;
        report({ audio: current === undefined ? null : String(current) });
        emit({ type: 'loaded' });
        if (next.startMs) seekTo(next.startMs);
        if (next.paused) return report({ paused: true });
        run(() => {
          av.play();
          report({ paused: false });
        });
      };

      try {
        av.open(next.url);
        av.setListener({
          onbufferingstart: () => report({ waiting: true }),
          onbufferingcomplete: () => report({ waiting: false }),
          onstreamcompleted: () => emit({ type: 'ended' }),
          onerror: (type: string) =>
            emit({ type: 'failed', error: errorMessage(type) }),
          onsubtitlechange: (duration: number, text: string) => {
            const at = position;
            embeddedCue = text
              ? { startMs: at, endMs: at + Number(duration), text }
              : null;
            showText();
          },
        });
        // AVPlay places its picture in a 1920x1080 space, whatever the screen.
        av.setDisplayRect(0, 0, 1920, 1080);
        av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
        // AVPlay starts a trailer's playlist on its smallest size and stays there.
        if (/^https:\/\/[^/]+\.googlevideo\.com\//.test(next.url))
          av.setStreamingProperty(
            'ADAPTIVE_INFO',
            // eslint-disable-next-line lingui/no-unlocalized-strings -- AVPlay's syntax
            'STARTBITRATE=HIGHEST|SKIPBITRATE=LOWEST'
          );
        av.prepareAsync(onPrepared, (error) =>
          emit({ type: 'failed', error: errorMessage(error) })
        );
      } catch (error) {
        emit({ type: 'failed', error: errorMessage(error) });
      }

      const tick = setInterval(() => {
        if (seeking) return;
        const state = av.getState();
        if (state !== 'PLAYING' && state !== 'PAUSED') return;
        position = av.getCurrentTime();
        positionAt = performance.now();
        playing = state === 'PLAYING';
        if (playing) embedded?.setPlaying(true);
        embedded?.setPosition(position, null);
        emit({ type: 'position', positionMs: position });
        report({ started: true, paused: !playing });
        showText();
      }, TICK_MS);

      // Samsung's rule for an app sent to the background and back.
      const onVisibility = () => {
        try {
          if (document.hidden) av.suspend();
          else av.restore();
        } catch {}
      };
      document.addEventListener('visibilitychange', onVisibility);
      audioControl?.setVolumeChangeListener((volume) =>
        report({ volume: volume / 100 })
      );

      teardown = () => {
        clearInterval(tick);
        document.removeEventListener('visibilitychange', onVisibility);
        audioControl?.unsetVolumeChangeListener();
        try {
          // While AVPlay is still open, or its subtitle layer can stay on screen.
          av.setSilentSubtitle(true);
          av.setListener({});
          if (!['NONE', 'IDLE'].includes(av.getState())) av.stop();
          av.close();
        } catch {}
        layer?.destroy();
        layer = null;
        embedded?.close();
        embedded = null;
        shown.remove();
        object = null;
      };
    },
    close() {
      teardown();
      teardown = () => {};
    },
    setPaused: (paused) =>
      run(() => {
        if (paused) av.pause();
        else av.play();
        position = av.getCurrentTime();
        positionAt = performance.now();
        playing = !paused;
        report({ paused });
      }),
    seek: seekTo,
    setVolume(volume, muted) {
      audioControl?.setVolume(Math.round(volume * 100));
      audioControl?.setMute(muted);
    },
    setAudio: (id) => run(() => av.setSelectTrack('AUDIO', Number(id))),
    setSubtitle,
    setSubtitleDelay(ms) {
      delayMs = ms;
      showText();
      layer?.setDelay(ms);
    },
    setStyle({ height }) {
      liftHeight = height;
      layer?.setHeight(height);
    },
    ownVolume: true,
  };
};
