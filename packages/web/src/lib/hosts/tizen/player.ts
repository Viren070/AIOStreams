import { t } from '@lingui/core/macro';
import { adaptiveInfo } from './youtube';
import { parseCues, type SubtitleCue } from '../../subtitles/cues';
import { ownTrackLabel } from '../../playback/controller';
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
const TAGS = /<[^>]*>|\{[^}]*\}/g;

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

const plain = (text: string) =>
  text.replace(/\\N/g, '\n').replace(TAGS, '').trim();

/**
 * Samsung's own player, drawn beneath the page through an
 * `application/avplayer` object. It draws no subtitles and can't fetch them,
 * so the page draws both the file's and the server's from their text. Its
 * volume is the TV's.
 */
export const avPlayEngine: EngineFactory = (emit) => {
  const av = window.webapis!.avplay!;
  const audioControl = window.tizen?.tvaudiocontrol;
  const report = (state: EngineState) => emit({ type: 'state', state });
  let file: EngineFile | null = null;
  let position = 0;
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

  const showText = () => {
    const at = position - delayMs;
    const cues = [...externalCues, embeddedCue].filter(
      (c): c is SubtitleCue => !!c && c.startMs <= at && at < c.endMs
    );
    emit({
      type: 'subtitle-text',
      text: cues.map((c) => plain(c.text)).join('\n'),
    });
  };

  const seekTo = (ms: number) => {
    position = ms;
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

  const setSubtitle = (id: string | null) => {
    subtitle = id;
    externalCues = [];
    embeddedCue = null;
    report({ subtitle: id });
    run(() => {
      try {
        if (id?.startsWith(EMBEDDED))
          av.setSelectTrack('TEXT', Number(id.slice(EMBEDDED.length)));
        av.setSilentSubtitle(!id?.startsWith(EMBEDDED));
      } catch {}
    });
    const server = file?.subtitles.find((s) => s.id === id);
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
      const object = document.createElement('object');
      object.type = 'application/avplayer';
      object.style.cssText =
        'position:fixed;left:0;top:0;width:100%;height:100%';
      document.body.prepend(object);

      const adaptive = adaptiveInfo(next.url);
      const onPrepared = () => {
        const audio = tracksOf(av, 'AUDIO');
        const text = tracksOf(av, 'TEXT');
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
        // See adaptiveInfo; set between open and prepare.
        if (adaptive) av.setStreamingProperty('ADAPTIVE_INFO', adaptive);
        // AVPlay places its picture in a 1920x1080 space, whatever the screen.
        av.setDisplayRect(0, 0, 1920, 1080);
        av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
        av.prepareAsync(onPrepared, (error) =>
          emit({ type: 'failed', error: errorMessage(error) })
        );
      } catch (error) {
        emit({ type: 'failed', error: errorMessage(error) });
      }

      const tick = setInterval(() => {
        if (seeking) return;
        const playing = av.getState();
        if (playing !== 'PLAYING' && playing !== 'PAUSED') return;
        position = av.getCurrentTime();
        emit({ type: 'position', positionMs: position });
        report({ started: true, paused: playing === 'PAUSED' });
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
        object.remove();
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
    },
    ownVolume: true,
  };
};
