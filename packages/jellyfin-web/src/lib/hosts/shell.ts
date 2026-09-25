import React from 'react';
import { storage } from '../storage';
import { subtitleUrl, textSubtitles } from '../playback';
import { sameLanguage } from '../languages';
import {
  onSettingsChange,
  readDesktopSettings,
  type DesktopSettings,
  type SubtitleStyle,
} from '../settings';
import type { PlaybackPrefs } from '../user-config';
import {
  clampDelay,
  parseSubtitleLines,
  savedSubtitleDelay,
  saveSubtitleDelay,
} from '../subtitle-lines';
import { MPV_OUTLINE, mpvColor, subtitleScale } from '../subtitle-style';
import {
  initialState,
  storedVolume,
  trackLabel,
  useLatest,
  VOLUME_KEY,
  type NativePlayerOptions,
  type PlayerController,
  type PlayerState,
  type Track,
} from '../player';

export type ShellMessage =
  | { type: 'mpv-prop'; name: string; data: unknown }
  | { type: 'mpv-event'; name: string }
  | { type: 'mpv-ended'; reason: string; error: string | null }
  | { type: 'fullscreen'; value: boolean }
  | {
      type: 'app-info';
      app: string;
      platform: string;
      mpv: string | null;
      ffmpeg: string | null;
    }
  | { type: 'diagnostics'; text: string }
  | { type: 'error'; message: string };

/** The AIOStreams desktop app's bridge to mpv. */
interface ShellBridge {
  protocol: number;
  version: string;
  platform: string;
  send(message: { type: string; [key: string]: unknown }): void;
  subscribe(listener: (message: ShellMessage) => void): () => void;
}

declare global {
  interface Window {
    aiostreamsDesktop?: ShellBridge;
  }
}

interface MpvTrack {
  id: number;
  type: 'video' | 'audio' | 'sub';
  title?: string;
  lang?: string;
  external?: boolean;
  'external-filename'?: string;
  selected?: boolean;
}

function mpvTrackLabel(track: MpvTrack): string {
  const parts = [track.title, track.lang?.toUpperCase()].filter(Boolean);
  return parts.join(' · ') || `Track ${track.id}`;
}

const EXTERNAL = 'ext:';

/**
 * The AIOStreams desktop app's mpv, drawn beneath the page. Its tracks are the
 * file's own, plus the server's external subtitles, which mpv downloads only
 * when picked: a version can carry dozens.
 */
export function useShellPlayer(opts: NativePlayerOptions): PlayerController {
  const { source, startMs, url } = opts;
  const [state, setState] = React.useState(() => initialState(source, startMs));
  const [tracks, setTracks] = React.useState<MpvTrack[]>([]);
  const latest = useLatest({ ...opts, state });
  const externals = React.useMemo(
    () =>
      textSubtitles(source)
        .filter((s) => s.IsExternal)
        .flatMap((s, i) => {
          const link = subtitleUrl(opts.client, s);
          return link
            ? [
                {
                  id: `${EXTERNAL}${s.Index}`,
                  url: link,
                  label: trackLabel(s, i + 1),
                  lang: s.Language ?? '',
                },
              ]
            : [];
        }),
    [source, opts.client]
  );
  const loaded = (url: string) =>
    tracks.find((t) => t.type === 'sub' && t['external-filename'] === url);
  // mpv's id for a loaded external subtitle reads back as its external id.
  const subtitleId = (sid: string | null) => {
    const track = tracks.find((t) => t.type === 'sub' && String(t.id) === sid);
    const external = externals.find(
      (e) => e.url === track?.['external-filename']
    );
    return external?.id ?? sid;
  };
  const patch = (next: Partial<PlayerState>) =>
    setState((s) => ({ ...s, ...next }));
  const shell = window.aiostreamsDesktop!;
  const set = (name: string, value: unknown) =>
    shell.send({ type: 'mpv-set-prop', name, value });
  const command = (...args: unknown[]) =>
    shell.send({ type: 'mpv-command', args });

  React.useEffect(() => {
    const { volume, muted } = storedVolume();
    let cache = false;
    let seeking = false;

    let fileTracks: MpvTrack[] = [];
    // Shows an external subtitle in the user's language when their mode wants
    // one and the file has none of its own; Default only honours the file's.
    const addPreferredSubtitle = () => {
      const { SubtitleLanguagePreference: lang, SubtitleMode: mode } =
        latest.current.prefs ?? {};
      if (!lang || (mode !== 'Always' && mode !== 'Smart')) return;
      const has = (type: MpvTrack['type']) =>
        fileTracks.some(
          (t) =>
            t.type === type &&
            (type === 'sub' ? !t.external : t.selected) &&
            sameLanguage(lang, t.lang)
        );
      if (has('sub') || (mode === 'Smart' && has('audio'))) return;
      const external = externals.find((e) => sameLanguage(lang, e.lang));
      if (external)
        command(
          'sub-add',
          external.url,
          'select',
          external.label,
          external.lang
        );
    };
    const onProp = (name: string, data: unknown) => {
      const num = typeof data === 'number' ? data : null;
      switch (name) {
        case 'time-pos':
          if (num !== null) patch({ positionMs: num * 1000 });
          break;
        case 'duration':
          if (num !== null) patch({ durationMs: num * 1000 });
          break;
        case 'demuxer-cache-time':
          if (num !== null) patch({ bufferedMs: num * 1000 });
          break;
        case 'pause':
          patch({ paused: data === true });
          break;
        case 'paused-for-cache':
        case 'seeking':
          if (name === 'seeking') seeking = data === true;
          else cache = data === true;
          patch({ waiting: cache || seeking });
          break;
        case 'volume':
          if (num !== null) patch({ volume: num / 100 });
          break;
        case 'mute':
          patch({ muted: data === true });
          break;
        case 'speed':
          if (num !== null) patch({ rate: num });
          break;
        case 'aid':
        case 'sid': {
          const id =
            typeof data === 'string' && /^\d+$/.test(data) ? data : null;
          patch(name === 'aid' ? { audio: id } : { subtitle: id });
          break;
        }
        case 'track-list':
          fileTracks = Array.isArray(data) ? (data as MpvTrack[]) : [];
          setTracks(fileTracks);
          break;
      }
    };

    const unsubscribe = shell.subscribe((m) => {
      if (m.type === 'mpv-prop') onProp(m.name, m.data);
      else if (m.type === 'fullscreen') patch({ fullscreen: m.value });
      else if (m.type === 'error') console.warn(m.message);
      else if (m.type === 'mpv-event' && m.name === 'playback-restart')
        patch({ started: true, waiting: false });
      else if (m.type === 'mpv-event' && m.name === 'file-loaded')
        addPreferredSubtitle();
      else if (m.type === 'mpv-ended' && m.reason === 'eof')
        latest.current.onEnded();
      else if (m.type === 'mpv-ended' && m.reason === 'error')
        patch({ error: m.error ?? 'mpv could not play this version' });
    });
    shell.send({ type: 'mpv-sync' });
    // mpv keeps pause from the last file.
    set('pause', false);
    set('volume', Math.round(volume * 100));
    set('mute', muted);
    applySubtitleStyle(latest.current.subtitleStyle);
    const delay = savedSubtitleDelay(source.Id);
    set('sub-delay', delay / 1000);
    patch({ subtitleDelayMs: delay });
    const options = [
      ...(startMs ? [`start=${(startMs / 1000).toFixed(3)}`] : []),
      ...trackOptions(latest.current.prefs ?? {}),
    ];
    command('loadfile', url, 'replace', -1, options.join(','));
    return () => {
      unsubscribe();
      command('stop');
    };
    // Reloading restarts playback, so only a new url or start does it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, startMs]);

  const setVolume = (volume: number, muted = volume === 0) => {
    set('volume', Math.round(volume * 100));
    set('mute', muted);
    storage.set(VOLUME_KEY, { volume, muted });
    patch({ volume, muted });
  };

  const toTrack = (t: MpvTrack): Track => ({
    id: String(t.id),
    label: mpvTrackLabel(t),
  });
  return {
    state: { ...state, subtitle: subtitleId(state.subtitle) },
    audioTracks: tracks.filter((t) => t.type === 'audio').map(toTrack),
    subtitleTracks: [
      ...tracks.filter((t) => t.type === 'sub' && !t.external).map(toTrack),
      ...externals.map(({ id, label }) => ({ id, label })),
    ],
    togglePlay: () => set('pause', !latest.current.state.paused),
    seek: (ms) => {
      command('seek', ms / 1000, 'absolute');
      patch({ positionMs: ms });
    },
    setVolume: (volume) => setVolume(volume),
    toggleMute: () => {
      const { volume, muted } = latest.current.state;
      setVolume(muted && volume === 0 ? 0.5 : volume, !muted);
    },
    setRate: (rate) => set('speed', rate),
    setAudio: (id) => set('aid', Number(id)),
    setSubtitle: (id) => {
      const external = externals.find((e) => e.id === id);
      if (!external) return set('sid', id ? Number(id) : 'no');
      const track = loaded(external.url);
      if (track) set('sid', track.id);
      else
        command(
          'sub-add',
          external.url,
          'select',
          external.label,
          external.lang
        );
    },
    setSubtitleDelay: (ms) => {
      const delay = clampDelay(ms);
      set('sub-delay', delay / 1000);
      saveSubtitleDelay(source.Id, delay);
      patch({ subtitleDelayMs: delay });
    },
    // Only external subtitles can be read; mpv keeps embedded ones to itself.
    subtitleLines: async () => {
      const shown = subtitleId(latest.current.state.subtitle);
      const external = externals.find((e) => e.id === shown);
      if (!external) return null;
      const res = await fetch(external.url);
      return res.ok ? parseSubtitleLines(await res.text()) : null;
    },
    toggleFullscreen: () => shell.send({ type: 'fullscreen' }),
  };
}

/**
 * The user's languages and subtitle mode as mpv's per-file track choices.
 * mpv matches a language across its two- and three-letter codes.
 */
function trackOptions(prefs: PlaybackPrefs): string[] {
  const options: string[] = [];
  if (prefs.AudioLanguagePreference)
    options.push(`alang=${prefs.AudioLanguagePreference}`);
  const slang = prefs.SubtitleLanguagePreference
    ? [`slang=${prefs.SubtitleLanguagePreference}`]
    : [];
  switch (prefs.SubtitleMode) {
    case 'None':
      options.push('sid=no');
      break;
    case 'OnlyForced':
      options.push('subs-fallback=no', 'subs-fallback-forced=always');
      break;
    case 'Always':
      options.push(
        ...slang,
        'subs-fallback=yes',
        'subs-with-matching-audio=yes'
      );
      break;
    case 'Smart':
      options.push(...slang, 'subs-with-matching-audio=no');
      break;
    default:
      options.push(...slang);
  }
  return options;
}

function setProp(name: string, value: unknown) {
  window.aiostreamsDesktop?.send({ type: 'mpv-set-prop', name, value });
}

export function applySubtitleStyle(style: SubtitleStyle | undefined): void {
  if (!style) return;
  setProp('sub-scale', subtitleScale(style));
  setProp('sub-bold', style.bold);
  setProp('sub-color', mpvColor(style.textColor));
  setProp('sub-outline-color', mpvColor(style.outlineColor));
  setProp('sub-outline-size', MPV_OUTLINE[style.outline]);
  setProp(
    'sub-back-color',
    mpvColor(style.backgroundColor, style.backgroundOpacity)
  );
  setProp(
    'sub-border-style',
    style.backgroundOpacity > 0 ? 'background-box' : 'outline-and-shadow'
  );
  setProp('sub-ass-override', style.overrideStyled ? 'force' : 'scale');
}

function applyDesktopSettings(settings: DesktopSettings): void {
  setProp('hwdec', settings.hardwareDecoding ? 'auto-safe' : 'no');
  setProp(
    'audio-channels',
    settings.audioChannels === 'auto' ? 'auto-safe' : settings.audioChannels
  );
  setProp('audio-spdif', settings.passthrough ? 'ac3,eac3,dts-hd,truehd' : '');
}

/** Keeps mpv in step with this device's settings, and handles Esc. */
export function ShellSetup() {
  React.useEffect(() => {
    const shell = window.aiostreamsDesktop;
    if (!shell) return;
    let fullscreen = false;
    const apply = () => applyDesktopSettings(readDesktopSettings());
    apply();
    const unsubscribeSettings = onSettingsChange(apply);
    const unsubscribe = shell.subscribe((m) => {
      if (m.type === 'fullscreen') fullscreen = m.value;
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !fullscreen || e.defaultPrevented) return;
      if (readDesktopSettings().escExitsFullscreen)
        shell.send({ type: 'fullscreen', value: false });
    };
    window.addEventListener('keydown', onKey);
    shell.send({ type: 'mpv-sync' });
    return () => {
      unsubscribeSettings();
      unsubscribe();
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return null;
}

export type ShellInfo = Extract<ShellMessage, { type: 'app-info' }>;

export function useShellInfo(): ShellInfo | null {
  const [info, setInfo] = React.useState<ShellInfo | null>(null);
  React.useEffect(() => {
    const shell = window.aiostreamsDesktop;
    if (!shell) return;
    const unsubscribe = shell.subscribe((m) => {
      if (m.type === 'app-info') setInfo(m);
    });
    shell.send({ type: 'app-info' });
    return unsubscribe;
  }, []);
  return info;
}

export function openMpvConfig(): void {
  window.aiostreamsDesktop?.send({ type: 'open-mpv-config' });
}

export function openLogs(): void {
  window.aiostreamsDesktop?.send({ type: 'open-logs' });
}

/** Versions, paths and the recent log, for a bug report. */
export function requestDiagnostics(): Promise<string> {
  const shell = window.aiostreamsDesktop;
  if (!shell)
    return Promise.reject(new Error('Only the desktop app has these'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('The app did not answer'));
    }, 5000);
    const unsubscribe = shell.subscribe((m) => {
      if (m.type !== 'diagnostics') return;
      clearTimeout(timer);
      unsubscribe();
      resolve(m.text);
    });
    shell.send({ type: 'diagnostics' });
  });
}
