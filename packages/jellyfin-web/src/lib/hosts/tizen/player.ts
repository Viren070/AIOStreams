import React from 'react';
import { sameLanguage } from '../../languages';
import { parseCues, type SubtitleCue } from '../../subtitles/cues';
import {
  clampDelay,
  savedSubtitleDelay,
  saveSubtitleDelay,
} from '../../subtitles/delay';
import {
  preferredSubtitle,
  subtitleUrl,
  textSubtitles,
} from '../../subtitles/tracks';
import {
  initialState,
  ownTrackLabel,
  trackLabel,
  type NativePlayerOptions,
  type PlayerController,
  type PlayerState,
  type Track,
} from '../../playback/controller';
import { useLatest } from '../../use-latest';
import type { AvPlay } from '.';

interface AvTrack {
  index: number;
  language?: string;
  codec?: string;
  label: string;
}

const EMBEDDED = 'embedded:';
const EXTERNAL = 'external:';
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

/**
 * The user's language, else the file's own pick, in a format the TV decodes
 * where the file has one.
 */
function startAudio(
  tracks: AvTrack[],
  current: number | undefined,
  lang: string | null | undefined
): number | undefined {
  const playing = tracks.find((t) => t.index === current);
  const wanted = tracks.some((t) => sameLanguage(lang, t.language))
    ? tracks.filter((t) => sameLanguage(lang, t.language))
    : tracks.filter((t) => t.language === playing?.language);
  const decoded = wanted.filter((t) => !DTS.test(t.codec ?? ''));
  if (playing && decoded.includes(playing)) return playing.index;
  return (decoded[0] ?? wanted[0] ?? playing)?.index;
}

function errorMessage(error: unknown): string {
  const code = String((error as { name?: string } | null)?.name ?? error);
  if (/CONNECTION|NETWORK|INVALID_URI|TIMEOUT/i.test(code))
    return 'the TV could not load the stream';
  if (/NOT_SUPPORTED|UNSUPPORTED/i.test(code))
    return 'the TV cannot play this format';
  return `the TV's player failed (${code})`;
}

const plain = (text: string) =>
  text.replace(/\\N/g, '\n').replace(TAGS, '').trim();

/**
 * Samsung's own player, drawn beneath the page through an
 * `application/avplayer` object. It draws no subtitles and can't fetch them,
 * so the page draws both the file's and the server's from their text. Its
 * volume is the TV's.
 */
export function useAvPlayer(opts: NativePlayerOptions): PlayerController {
  const { source, startMs, url } = opts;
  const audioControl = window.tizen?.tvaudiocontrol;
  const [state, setState] = React.useState<PlayerState>(() => ({
    ...initialState(source, startMs),
    volume: (audioControl?.getVolume() ?? 100) / 100,
    muted: audioControl?.isMute() ?? false,
    subtitleDelayMs: savedSubtitleDelay(source.Id),
  }));
  const [audioTracks, setAudioTracks] = React.useState<AvTrack[]>([]);
  const [embedded, setEmbedded] = React.useState<AvTrack[]>([]);
  const [subtitleText, setSubtitleText] = React.useState('');
  const latest = useLatest(opts);
  const patch = (next: Partial<PlayerState>) =>
    setState((s) => ({ ...s, ...next }));
  const external = React.useMemo(() => textSubtitles(source), [source]);
  const av = window.webapis!.avplay!;

  const position = React.useRef(startMs);
  const delayMs = React.useRef(savedSubtitleDelay(source.Id));
  const externalCues = React.useRef<SubtitleCue[]>([]);
  const embeddedCue = React.useRef<SubtitleCue | null>(null);
  const subtitle = React.useRef<string | null>(null);
  // No other call may reach AVPlay until a seek reports back.
  const seeking = React.useRef(false);
  const nextSeek = React.useRef<number | null>(null);
  const queued = React.useRef<(() => void)[]>([]);
  const run = (fn: () => void) => {
    if (seeking.current) queued.current.push(fn);
    else fn();
  };

  const showText = () => {
    const at = position.current - delayMs.current;
    const cues = [...externalCues.current, embeddedCue.current].filter(
      (c): c is SubtitleCue => !!c && c.startMs <= at && at < c.endMs
    );
    setSubtitleText(cues.map((c) => plain(c.text)).join('\n'));
  };

  const seekTo = (ms: number) => {
    position.current = ms;
    patch({ positionMs: ms });
    if (seeking.current) {
      nextSeek.current = ms;
      return;
    }
    seeking.current = true;
    const done = () => {
      seeking.current = false;
      const next = nextSeek.current;
      nextSeek.current = null;
      if (next !== null) return seekTo(next);
      const fns = queued.current;
      queued.current = [];
      fns.forEach((fn) => fn());
    };
    try {
      av.seekTo(ms, done, done);
    } catch {
      done();
    }
  };

  const showSubtitle = (id: string | null) => {
    subtitle.current = id;
    externalCues.current = [];
    embeddedCue.current = null;
    patch({ subtitle: id });
    run(() => {
      try {
        if (id?.startsWith(EMBEDDED))
          av.setSelectTrack('TEXT', Number(id.slice(EMBEDDED.length)));
        av.setSilentSubtitle(!id?.startsWith(EMBEDDED));
      } catch {}
    });
    const stream = external.find((s) => `${EXTERNAL}${s.Index}` === id);
    const link = stream && subtitleUrl(latest.current.client, stream);
    if (!link) return showText();
    void fetch(link)
      .then((res) => (res.ok ? res.text() : ''))
      .then((body) => {
        if (subtitle.current !== id) return;
        externalCues.current = parseCues(body);
        showText();
      })
      .catch(() => {});
  };

  React.useEffect(() => {
    const object = document.createElement('object');
    object.type = 'application/avplayer';
    object.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%';
    document.body.prepend(object);

    const onPrepared = () => {
      const audio = tracksOf(av, 'AUDIO');
      const text = tracksOf(av, 'TEXT');
      setAudioTracks(audio);
      setEmbedded(text);
      const duration = av.getDuration();
      if (duration) patch({ durationMs: duration });
      const current = av
        .getCurrentStreamInfo()
        .find((t) => t.type === 'AUDIO')?.index;
      const { prefs = {} } = latest.current;
      const start = startAudio(audio, current, prefs.AudioLanguagePreference);
      if (start !== undefined && start !== current)
        av.setSelectTrack('AUDIO', start);
      patch({ audio: start === undefined ? null : String(start) });
      // The file's own subtitles rank before the server's.
      const first = preferredSubtitle(
        [
          ...text.map((t) => ({
            id: `${EMBEDDED}${t.index}`,
            Language: t.language,
            IsForced: false,
          })),
          ...external.map((s) => ({ ...s, id: `${EXTERNAL}${s.Index}` })),
        ],
        prefs
      );
      showSubtitle(first?.id ?? null);
      if (startMs) seekTo(startMs);
      run(() => {
        av.play();
        patch({ paused: false });
      });
    };

    try {
      av.open(url);
      av.setListener({
        onbufferingstart: () => patch({ waiting: true }),
        onbufferingcomplete: () => patch({ waiting: false }),
        onstreamcompleted: () => latest.current.onEnded(),
        onerror: (type: string) => patch({ error: errorMessage(type) }),
        onsubtitlechange: (duration: number, text: string) => {
          const at = position.current;
          embeddedCue.current = text
            ? { startMs: at, endMs: at + Number(duration), text }
            : null;
          showText();
        },
      });
      // AVPlay places its picture in a 1920x1080 space, whatever the screen.
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      av.prepareAsync(onPrepared, (error) =>
        patch({ error: errorMessage(error) })
      );
    } catch (error) {
      patch({ error: errorMessage(error) });
    }

    const tick = setInterval(() => {
      if (seeking.current) return;
      const playing = av.getState();
      if (playing !== 'PLAYING' && playing !== 'PAUSED') return;
      position.current = av.getCurrentTime();
      patch({
        positionMs: position.current,
        started: true,
        paused: playing === 'PAUSED',
      });
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
      patch({ volume: volume / 100 })
    );

    return () => {
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
    // Reloading restarts playback, so only a new url or start does it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, startMs]);

  return {
    state,
    audioTracks: audioTracks.map(({ index, label }) => ({
      id: String(index),
      label,
    })),
    subtitleTracks: [
      ...embedded.map(
        ({ index, label }): Track => ({ id: `${EMBEDDED}${index}`, label })
      ),
      ...external.map((s, i) => ({
        id: `${EXTERNAL}${s.Index}`,
        label: trackLabel(s, embedded.length + i + 1),
      })),
    ],
    subtitleText,
    togglePlay: () =>
      run(() => {
        const playing = av.getState() === 'PLAYING';
        if (playing) av.pause();
        else av.play();
        patch({ paused: playing });
      }),
    seek: seekTo,
    setVolume: (volume) => {
      audioControl?.setVolume(Math.round(volume * 100));
      if (volume > 0) audioControl?.setMute(false);
      patch({ volume, muted: volume > 0 ? false : state.muted });
    },
    toggleMute: () => {
      audioControl?.setMute(!state.muted);
      patch({ muted: !state.muted });
    },
    setAudio: (id) => {
      run(() => av.setSelectTrack('AUDIO', Number(id)));
      patch({ audio: id });
    },
    setSubtitle: showSubtitle,
    setSubtitleDelay: (ms) => {
      delayMs.current = clampDelay(ms);
      saveSubtitleDelay(source.Id, delayMs.current);
      patch({ subtitleDelayMs: delayMs.current });
      showText();
    },
    subtitleLines: async () =>
      subtitle.current?.startsWith(EXTERNAL) && externalCues.current.length
        ? externalCues.current.map((c) => ({
            startMs: c.startMs,
            text: plain(c.text).replace(/\n/g, ' '),
          }))
        : null,
    canReadSubtitle: (id) => id.startsWith(EXTERNAL),
  };
}
