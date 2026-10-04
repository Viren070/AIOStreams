import React from 'react';
import { storage } from '../storage';
import { subtitleUrl, textSubtitles } from '../subtitles/tracks';
import { sameLanguage } from '../languages';
import type { PlaybackPrefs } from '../user-config';
import { currentHost } from '.';
import {
  clampDelay,
  savedSubtitleDelay,
  saveSubtitleDelay,
} from '../subtitles/delay';
import type { MediaStream } from '../types';
import { checkSubtitleFile, readSubtitleCues } from '../subtitles/files';
import { subtitleLine } from '../subtitles/style';
import {
  initialState,
  storedVolume,
  trackLabel,
  VOLUME_KEY,
  type PlayerController,
  type PlayerOptions,
  type PlayerState,
} from '../playback/controller';
import { useLatest } from '../use-latest';

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

function isPhone(): boolean {
  return (
    matchMedia('(pointer: coarse)').matches &&
    Math.min(screen.width, screen.height) < 600
  );
}

const isFullscreen = () =>
  !!document.fullscreenElement || !!currentHost().fullscreen?.active();

/** Phones also turn to landscape, which only a full screen page may lock. */
async function enterFullscreen(): Promise<void> {
  const app = currentHost().fullscreen;
  if (app) return app.set(true);
  await document.documentElement.requestFullscreen?.();
  const orientation = screen.orientation as ScreenOrientation & {
    lock?(orientation: string): Promise<void>;
  };
  if (isPhone()) await orientation.lock?.('landscape');
}

async function exitFullscreen(): Promise<void> {
  const app = currentHost().fullscreen;
  if (app?.active()) app.set(false);
  else await document.exitFullscreen();
}

function toggleDocumentFullscreen(): void {
  void (isFullscreen() ? exitFullscreen() : enterFullscreen()).catch(() => {});
}

/** Phones play full screen in landscape, as their own players do. */
export function usePhoneFullscreen(enabled: boolean): void {
  React.useEffect(() => {
    if (!enabled || !isPhone()) return;
    if (!isFullscreen()) void enterFullscreen().catch(() => {});
    return () => {
      // The next episode's player keeps it, as it could not enter again without a tap.
      setTimeout(() => {
        const playing = document.documentElement.classList.contains('playing');
        if (!playing && isFullscreen()) void exitFullscreen().catch(() => {});
      });
    };
  }, [enabled]);
}

const SUBTITLE_TYPES = ['srt', 'vtt', 'ass', 'ssa'];

interface FileTrack {
  id: string;
  label: string;
  track: TextTrack;
}

/**
 * A `<video>` element; its external subtitles are `<track>`s in source order,
 * and files the user adds are text tracks after them.
 */
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
  const files = React.useRef<FileTrack[]>([]);
  const [fileList, setFileList] = React.useState<FileTrack[]>([]);
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
  // Browsers disagree on where a cue the file leaves unplaced goes.
  const placed = React.useRef(new WeakSet<VTTCue>());
  const line = subtitleLine(opts.subtitleStyle);
  const placeCues = React.useCallback(() => {
    for (const track of Array.from(video.current?.textTracks ?? [])) {
      for (const cue of Array.from(track.cues ?? [])) {
        const vtt = cue as VTTCue;
        if (vtt.line !== 'auto' && !placed.current.has(vtt)) continue;
        placed.current.add(vtt);
        vtt.snapToLines = false;
        vtt.line = line;
        vtt.lineAlign = 'end';
      }
    }
  }, [video, line]);
  React.useEffect(placeCues, [placeCues]);
  const latestPlaceCues = useLatest(placeCues);
  const showSubtitle = (id: string | null) => {
    const tracks = video.current?.textTracks;
    if (!tracks) return;
    subtitles.forEach((s, i) => {
      const track = tracks[i];
      if (track) track.mode = String(s.Index) === id ? 'showing' : 'disabled';
    });
    for (const file of files.current)
      file.track.mode = file.id === id ? 'showing' : 'disabled';
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
    const onTrackLoad = () => {
      latestPlaceCues.current();
      shiftCues();
    };
    for (const t of trackElements) t.addEventListener('load', onTrackLoad);
    const onFullscreen = () => patch({ fullscreen: isFullscreen() });
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      for (const [event, handler] of Object.entries(handlers))
        el.removeEventListener(event, handler);
      document.removeEventListener('fullscreenchange', onFullscreen);
      for (const t of trackElements) t.removeEventListener('load', onTrackLoad);
    };
  }, [video, startMs, onEnded]);

  // Browsers keep a closed player in their media controls until its video drops the stream.
  React.useEffect(() => {
    const el = video.current;
    return () => {
      if (!el) return;
      el.pause();
      el.removeAttribute('src');
      el.load();
    };
  }, [video]);

  const el = () => video.current;
  return {
    state,
    audioTracks: [],
    subtitleTracks: [
      ...subtitles.map((s, i) => ({
        id: String(s.Index),
        label: trackLabel(s, i + 1),
      })),
      ...fileList.map(({ id, label }) => ({ id, label })),
    ],
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
      const file = files.current.find((f) => f.id === state.subtitle);
      const cues = (file?.track ?? video.current?.textTracks[index])?.cues;
      if (!cues?.length) return null;
      // Cues carry the shift already applied, so it comes off again.
      return Array.from(cues).map((cue) => ({
        startMs: cue.startTime * 1000 - delayMs.current,
        text: (cue as VTTCue).text.replace(/<[^>]*>/g, ''),
      }));
    },
    subtitleFiles: {
      types: SUBTITLE_TYPES,
      add: async (file) => {
        checkSubtitleFile(file, SUBTITLE_TYPES);
        const cues = await readSubtitleCues(file);
        const v = video.current;
        if (!v) return;
        const track = v.addTextTrack('subtitles', file.name);
        track.mode = 'hidden';
        for (const cue of cues)
          track.addCue(
            new VTTCue(cue.startMs / 1000, cue.endMs / 1000, cue.text)
          );
        const added = {
          id: `file:${files.current.length}`,
          label: file.name,
          track,
        };
        files.current = [...files.current, added];
        setFileList(files.current);
        latestPlaceCues.current();
        showSubtitle(added.id);
      },
    },
    toggleFullscreen: toggleDocumentFullscreen,
  };
}
