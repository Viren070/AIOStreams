import React from 'react';
import type { JellyfinClient } from '../client';
import { clock } from '../format';
import { settings, useSetting } from '../settings';
import { storage } from '../storage';
import { parseSubtitleLines } from '../subtitles/cues';
import {
  clampDelay,
  savedSubtitleDelay,
  saveSubtitleDelay,
} from '../subtitles/delay';
import { subtitleUrl, textSubtitles } from '../subtitles/tracks';
import type { MediaStream, SourceInfo } from '../types';
import { useLatest } from '../use-latest';
import type { Chapter } from './chapters';
import {
  initialState,
  storedVolume,
  trackLabel,
  VOLUME_KEY,
  type PlayerController,
  type PlayerOptions,
  type PlayerState,
  type Track,
} from './controller';
import type {
  EngineEvent,
  EngineFactory,
  EngineFile,
  EngineTrack,
  ServerSubtitle,
} from './engine';
import { usePlayheadWriter } from './playhead';
import { chooseTracks } from './track-picks';

/** An end of file this far before the duration is a stream that gave out, not the end. */
const EARLY_END_MS = 30_000;

function serverSubtitles(
  client: JellyfinClient,
  source: SourceInfo,
  ownSubtitles: boolean,
  urlOf?: (stream: MediaStream) => string | null
): ServerSubtitle[] {
  return textSubtitles(source)
    .filter((s) => !ownSubtitles || s.IsExternal)
    .flatMap((stream, i) => {
      const url = urlOf ? urlOf(stream) : subtitleUrl(client, stream);
      return url
        ? [
            {
              id: `server:${stream.Index}`,
              url,
              label: trackLabel(stream, i + 1),
              lang: stream.Language ?? undefined,
              stream,
            },
          ]
        : [];
    });
}

const asTrack = ({ id, label, lang }: Track): Track => ({ id, label, lang });

/** The subtitle as the page names it: a server subtitle by its own id once loaded. */
const shownSubtitle = (tracks: EngineTrack[], id: string | null) =>
  tracks.find((t) => t.type === 'subtitle' && t.id === id)?.server ?? id;

/** One set of controls over an engine, with what every player shares. */
export function usePlayer(
  create: EngineFactory,
  opts: PlayerOptions
): PlayerController {
  const { client, source, startMs, url } = opts;
  const latest = useLatest(opts);
  const handle = React.useRef<(event: EngineEvent) => void>(() => {});
  const [engine] = React.useState(() =>
    create((event) => handle.current(event), { launched: opts.launched })
  );
  const [state, setState] = React.useState<PlayerState>(() => ({
    ...initialState(source),
    subtitleDelayMs: savedSubtitleDelay(source.Id),
  }));
  // Engines report several things in one go, before the page draws again.
  const live = React.useRef({ ...state, tracks: [] as EngineTrack[] });
  const patch = (next: Partial<PlayerState>) => {
    live.current = { ...live.current, ...next };
    setState((s) => ({ ...s, ...next }));
  };
  const playhead = usePlayheadWriter(startMs);
  const [tracks, setTracks] = React.useState<EngineTrack[]>([]);
  const [chapters, setChapters] = React.useState<Chapter[]>();
  const [subtitleText, setSubtitleText] = React.useState<string>();
  const [statsPage, setStatsPage] = React.useState<string | null>(null);
  const [statsText, setStatsText] = React.useState<string>();
  const [retry, setRetry] = React.useState<PlayerController['retry']>();
  const [lift, setLift] = React.useState(0);
  const [fit] = useSetting(settings.video.fit);
  const servers = React.useMemo(
    () =>
      serverSubtitles(client, source, !!engine.ownSubtitles, opts.subtitleUrl),
    [client, source, engine, opts.subtitleUrl]
  );
  const latestServers = useLatest(servers);

  const fileFor = (from: number): EngineFile => ({
    url,
    headers: opts.headers,
    startMs: from,
    item: opts.item,
    source,
    prefs: opts.prefs ?? {},
    subtitles: servers,
    subtitleDelayMs: live.current.subtitleDelayMs,
    volume: engine.ownVolume ? null : storedVolume(Infinity),
  });
  const latestFile = useLatest(fileFor);

  const setAudio = (id: string) => {
    engine.setAudio(id);
    patch({ audio: id });
  };
  const setSubtitle = (id: string | null) => {
    engine.setSubtitle(id);
    patch({ subtitle: id });
  };
  const setVolume = (volume: number, muted = volume === 0) => {
    engine.setVolume(volume, muted);
    if (!engine.ownVolume) storage.set(VOLUME_KEY, { volume, muted });
    patch({ volume, muted });
  };
  const restart = () => {
    setRetry(undefined);
    patch({ error: null, started: false, waiting: true });
  };

  handle.current = (event) => {
    switch (event.type) {
      case 'state':
        return patch(event.state);
      case 'position':
        return playhead.set(event);
      case 'tracks':
        live.current.tracks = event.tracks;
        return setTracks(event.tracks);
      case 'chapters':
        return setChapters(event.chapters);
      case 'loaded': {
        const { tracks, audio, subtitle } = live.current;
        const shown = shownSubtitle(tracks, subtitle);
        const picks = chooseTracks(
          tracks,
          latestServers.current,
          { audio, subtitle: shown },
          latest.current.prefs ?? {},
          latest.current.source,
          !!engine.picksTracks
        );
        if (picks.audio && picks.audio !== audio) setAudio(picks.audio);
        if (picks.subtitle !== shown) setSubtitle(picks.subtitle);
        return;
      }
      case 'ended': {
        const at = playhead.positionMs;
        if (live.current.durationMs - at <= EARLY_END_MS)
          return latest.current.onEnded();
        patch({ error: 'the stream ended early' });
        return setRetry({
          label: `Resume from ${clock(at)}`,
          run: () => {
            restart();
            engine.load(latestFile.current(at));
          },
        });
      }
      case 'failed': {
        patch({ error: event.error });
        const again = event.retry;
        return setRetry(
          again && {
            label: again.label,
            run: () => {
              restart();
              again.run();
            },
          }
        );
      }
      case 'advanced':
        return latest.current.onAdvance?.(event.episode);
      case 'closed':
        return latest.current.onClosed?.();
      case 'subtitle-text':
        return setSubtitleText(event.text);
      case 'stats-text':
        return setStatsText(event.text);
    }
  };

  const { subtitleStyle } = opts;
  React.useEffect(() => {
    engine.setStyle?.({ subtitleStyle, fit, lift });
  }, [engine, subtitleStyle, fit, lift]);

  React.useEffect(() => {
    setRetry(undefined);
    setStatsPage(null);
    setStatsText(undefined);
    const file = latestFile.current(startMs);
    if (file.volume) patch(file.volume);
    engine.load(file);
    return () => engine.close();
    // Reloading restarts playback, so only a new url or start does it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, startMs]);

  const shown = shownSubtitle(tracks, state.subtitle);
  const subtitleTracks = tracks.filter((t) => t.type === 'subtitle');
  const { stats } = engine;
  return {
    state: { ...state, subtitle: shown },
    playhead,
    audioTracks: tracks.filter((t) => t.type === 'audio').map(asTrack),
    // The file's own, the server's, then any the user added.
    subtitleTracks: [
      ...subtitleTracks.filter((t) => !t.external).map(asTrack),
      ...servers.map(asTrack),
      ...subtitleTracks.filter((t) => t.external && !t.server).map(asTrack),
    ],
    subtitleText,
    togglePlay: () => engine.setPaused(!live.current.paused),
    seek: (ms) => {
      engine.seek(ms);
      playhead.set({ positionMs: ms });
    },
    setVolume: (volume) => setVolume(volume),
    toggleMute: () => {
      const { volume, muted } = live.current;
      setVolume(muted && volume === 0 ? 0.5 : volume, !muted);
    },
    setRate: engine.setRate && ((rate) => engine.setRate!(rate)),
    setAudio,
    setSubtitle,
    setSubtitleDelay:
      engine.setSubtitleDelay &&
      ((ms) => {
        const delay = clampDelay(ms);
        engine.setSubtitleDelay!(delay);
        saveSubtitleDelay(source.Id, delay);
        patch({ subtitleDelayMs: delay });
      }),
    liftSubtitles: engine.setStyle && setLift,
    canReadSubtitle: (id) =>
      servers.some((s) => s.id === id) || !!engine.ownLines,
    subtitleLines: async () => {
      const server = servers.find((s) => s.id === shown);
      if (server) {
        const res = await fetch(server.url);
        return res.ok ? parseSubtitleLines(await res.text()) : null;
      }
      return shown ? ((await engine.ownLines?.(shown)) ?? null) : null;
    },
    subtitleFiles: engine.subtitleFiles,
    toggleFullscreen:
      engine.toggleFullscreen && (() => engine.toggleFullscreen!()),
    chapters,
    stats: stats && {
      pages: stats.pages,
      page: statsPage,
      show: (page) => {
        stats.show(page);
        setStatsPage(page);
      },
      text: statsText,
    },
    external: engine.external,
    close: engine.closeWindow && (() => engine.closeWindow!()),
    queueNext: engine.queueNext && ((episode) => engine.queueNext!(episode)),
    sound: engine.sound,
    fit: engine.fits,
    retry,
  };
}
