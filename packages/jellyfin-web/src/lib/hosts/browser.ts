import React from 'react';
import { storage } from '../storage';
import { subtitleUrl, textSubtitles } from '../playback';
import { sameLanguage } from '../languages';
import type { PlaybackPrefs } from '../user-config';
import {
  clampDelay,
  savedSubtitleDelay,
  saveSubtitleDelay,
} from '../subtitle-lines';
import type { MediaStream } from '../types';
import {
  initialState,
  storedVolume,
  trackLabel,
  useLatest,
  VOLUME_KEY,
  type PlayerController,
  type PlayerOptions,
  type PlayerState,
} from '../player';

/** The text subtitle the user's language and subtitle mode start with. */
function preferredSubtitle(
  subtitles: MediaStream[],
  prefs: PlaybackPrefs
): MediaStream | undefined {
  const lang = prefs.SubtitleLanguagePreference;
  switch (prefs.SubtitleMode) {
    case 'None':
      return undefined;
    case 'OnlyForced':
      return subtitles.find(
        (s) => s.IsForced && (!lang || sameLanguage(lang, s.Language))
      );
    default:
      return lang
        ? subtitles.find((s) => sameLanguage(lang, s.Language))
        : undefined;
  }
}

function toggleDocumentFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

/** A `<video>` element; its external subtitles are `<track>`s in source order. */
export function useBrowserPlayer(
  video: React.RefObject<HTMLVideoElement | null>,
  opts: PlayerOptions
): PlayerController {
  const { source, startMs } = opts;
  const [state, setState] = React.useState(() => ({
    ...initialState(source, startMs),
    subtitleDelayMs: savedSubtitleDelay(source.Id),
  }));
  const onEnded = useLatest(opts.onEnded);
  const prefs = useLatest(opts.prefs);
  const subtitles = React.useMemo(() => textSubtitles(source), [source]);
  const patch = (next: Partial<PlayerState>) =>
    setState((s) => ({ ...s, ...next }));
  // A text track's cues load late, so each one remembers the shift it has.
  const shifted = React.useRef(new WeakMap<TextTrack, number>());
  const delayMs = React.useRef(savedSubtitleDelay(source.Id));
  const shiftCues = React.useCallback(() => {
    const tracks = video.current?.textTracks;
    if (!tracks) return;
    for (const track of Array.from(tracks)) {
      const cues = track.cues;
      if (!cues?.length) continue;
      const by = (delayMs.current - (shifted.current.get(track) ?? 0)) / 1000;
      if (!by) continue;
      for (const cue of Array.from(cues)) {
        cue.startTime += by;
        cue.endTime += by;
      }
      shifted.current.set(track, delayMs.current);
    }
  }, [video]);
  const showSubtitle = (id: string | null) => {
    const tracks = video.current?.textTracks;
    if (!tracks) return;
    subtitles.forEach((s, i) => {
      const track = tracks[i];
      if (track) track.mode = String(s.Index) === id ? 'showing' : 'disabled';
    });
    shiftCues();
    patch({ subtitle: id });
  };

  React.useEffect(() => {
    const el = video.current;
    if (!el) return;
    const { volume, muted } = storedVolume();
    el.volume = volume;
    el.muted = muted;
    const bufferedEnd = () => {
      for (let i = el.buffered.length - 1; i >= 0; i--) {
        if (el.buffered.start(i) <= el.currentTime)
          return el.buffered.end(i) * 1000;
      }
      return 0;
    };
    const handlers: Record<string, () => void> = {
      loadedmetadata: () => {
        if (startMs) el.currentTime = startMs / 1000;
        patch({ durationMs: el.duration * 1000 || 0 });
        const first = preferredSubtitle(subtitles, prefs.current ?? {});
        if (first) showSubtitle(String(first.Index));
      },
      durationchange: () => patch({ durationMs: el.duration * 1000 || 0 }),
      playing: () => patch({ started: true, paused: false, waiting: false }),
      pause: () => patch({ paused: true }),
      play: () => patch({ paused: false }),
      waiting: () => patch({ waiting: true }),
      canplay: () => patch({ waiting: false }),
      timeupdate: () =>
        patch({ positionMs: el.currentTime * 1000, bufferedMs: bufferedEnd() }),
      progress: () => patch({ bufferedMs: bufferedEnd() }),
      volumechange: () => {
        patch({ volume: el.volume, muted: el.muted });
        storage.set(VOLUME_KEY, { volume: el.volume, muted: el.muted });
      },
      ratechange: () => patch({ rate: el.playbackRate }),
      ended: () => onEnded.current(),
      error: () =>
        patch({
          error:
            'This browser cannot play this version. Nothing is converted on the server, so try another version, an external player or the desktop app.',
        }),
    };
    for (const [event, handler] of Object.entries(handlers))
      el.addEventListener(event, handler);
    const trackElements = Array.from(el.querySelectorAll('track'));
    for (const t of trackElements) t.addEventListener('load', shiftCues);
    const onFullscreen = () =>
      patch({ fullscreen: !!document.fullscreenElement });
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      for (const [event, handler] of Object.entries(handlers))
        el.removeEventListener(event, handler);
      document.removeEventListener('fullscreenchange', onFullscreen);
      for (const t of trackElements) t.removeEventListener('load', shiftCues);
    };
  }, [video, startMs, onEnded]);

  const el = () => video.current;
  return {
    state,
    audioTracks: [],
    subtitleTracks: subtitles.map((s, i) => ({
      id: String(s.Index),
      label: trackLabel(s, i + 1),
    })),
    togglePlay: () => {
      const v = el();
      if (!v) return;
      if (v.paused) void v.play().catch(() => {});
      else v.pause();
    },
    seek: (ms) => {
      const v = el();
      if (!v) return;
      v.currentTime = ms / 1000;
      patch({ positionMs: ms });
    },
    setVolume: (volume) => {
      const v = el();
      if (!v) return;
      v.volume = volume;
      v.muted = volume === 0;
    },
    toggleMute: () => {
      const v = el();
      if (!v) return;
      if (v.muted && v.volume === 0) v.volume = 0.5;
      v.muted = !v.muted;
    },
    setRate: (rate) => {
      const v = el();
      if (v) v.playbackRate = rate;
    },
    setAudio: () => {},
    setSubtitle: showSubtitle,
    setSubtitleDelay: (ms) => {
      delayMs.current = clampDelay(ms);
      shiftCues();
      saveSubtitleDelay(source.Id, delayMs.current);
      patch({ subtitleDelayMs: delayMs.current });
    },
    subtitleLines: async () => {
      const index = subtitles.findIndex(
        (s) => String(s.Index) === state.subtitle
      );
      const cues = video.current?.textTracks[index]?.cues;
      if (!cues?.length) return null;
      // Cues carry the shift already applied, so it comes off again.
      return Array.from(cues).map((cue) => ({
        startMs: cue.startTime * 1000 - delayMs.current,
        text: (cue as VTTCue).text.replace(/<[^>]*>/g, ''),
      }));
    },
    toggleFullscreen: toggleDocumentFullscreen,
  };
}
