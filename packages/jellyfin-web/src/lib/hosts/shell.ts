import React from 'react';
import { storage } from '../storage';
import { subtitleUrl, textSubtitles } from '../playback';
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
}

function mpvTrackLabel(track: MpvTrack): string {
  const parts = [track.title, track.lang?.toUpperCase()].filter(Boolean);
  return parts.join(' · ') || `Track ${track.id}`;
}

/**
 * The AIOStreams desktop app's mpv, drawn beneath the page. Its tracks are the
 * file's own, plus the server's external subtitles.
 */
export function useShellPlayer(opts: NativePlayerOptions): PlayerController {
  const { source, startMs, url } = opts;
  const [state, setState] = React.useState(() => initialState(source, startMs));
  const [tracks, setTracks] = React.useState<MpvTrack[]>([]);
  const latest = useLatest({ ...opts, state });
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

    const addSubtitles = () => {
      textSubtitles(source).forEach((s, i) => {
        const link = subtitleUrl(latest.current.client, s);
        if (link)
          command(
            'sub-add',
            link,
            'auto',
            trackLabel(s, i + 1),
            s.Language ?? ''
          );
      });
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
          setTracks(Array.isArray(data) ? (data as MpvTrack[]) : []);
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
        addSubtitles();
      else if (m.type === 'mpv-ended' && m.reason === 'eof')
        latest.current.onEnded();
      else if (m.type === 'mpv-ended' && m.reason === 'error')
        patch({ error: m.error ?? 'mpv could not play this version' });
    });
    shell.send({ type: 'mpv-sync' });
    set('volume', Math.round(volume * 100));
    set('mute', muted);
    command(
      'loadfile',
      url,
      'replace',
      -1,
      startMs ? `start=${(startMs / 1000).toFixed(3)}` : ''
    );
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
    state,
    audioTracks: tracks.filter((t) => t.type === 'audio').map(toTrack),
    subtitleTracks: tracks.filter((t) => t.type === 'sub').map(toTrack),
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
    setSubtitle: (id) => set('sid', id ? Number(id) : 'no'),
    toggleFullscreen: () => shell.send({ type: 'fullscreen' }),
  };
}
