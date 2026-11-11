import { t } from '@lingui/core/macro';
import React from 'react';
import type { JellyfinClient } from '@/lib/jellyfin/client';
import { clock } from '@/lib/format';
import { settings, useSetting } from '@/lib/settings';
import { storage } from '@/lib/storage';
import { parseSubtitle, plainLines } from '@/lib/subtitles/cues';
import { savedSubtitleDelay } from '@/lib/subtitles/delay';
import { subtitleUrl, textSubtitles } from '@/lib/subtitles/tracks';
import { SUBTITLE_LIFT_MS, subtitleHeight } from '@/lib/subtitles/style';
import type { MediaStream, SourceInfo } from '@/lib/jellyfin/types';
import { appLog } from '@/lib/hosts/shell/bridge';
import { useLatest } from '@/hooks/use-latest';
import type { Chapter } from './chapters';
import { useLiveRecovery } from './live-recovery';
import {
  initialState,
  storedVolume,
  trackLabel,
  trackRow,
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
  PlayerEngine,
  ServerSubtitle,
  StatsRow,
} from './engine';
import { usePlayheadWriter } from './playhead';
import { thumbnailFeed } from './thumbnails';
import { chooseTracks, serverFacts, trackFacts } from './track-picks';
import { createLive } from '@/lib/live-value';
import { copyOf, shownSubtitle, useSubtitleTiming } from './subtitle-timing';

/** An end of file this far before the duration is a stream that gave out, not the end. */
const EARLY_END_MS = 30_000;

/** Late enough after the start that reading the file's index for thumbnails doesn't slow it. */
const THUMBNAIL_INDEX_MS = 5_000;

/** How long subtitles stay at a newly picked height while the controls show. */
const PLACING_MS = 3_000;

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
      const assUrl =
        !urlOf && stream.Codec === 'ass'
          ? subtitleUrl(client, stream, { original: true })
          : null;
      return url
        ? [
            {
              id: `server:${stream.Index}`,
              url,
              label: trackLabel(stream, i + 1),
              lang: stream.Language ?? undefined,
              stream,
              ...(assUrl && { assUrl }),
            },
          ]
        : [];
    });
}

const asTrack = (track: EngineTrack): Track => ({
  id: track.id,
  lang: track.lang,
  ...trackRow(track, track.type, track.label),
});

const serverTrack = (s: ServerSubtitle): Track => ({
  id: s.id,
  lang: s.lang,
  ...trackRow(
    {
      lang: s.stream.Language,
      title: s.stream.Title,
      forced: s.stream.IsForced,
      hearingImpaired: s.stream.IsHearingImpaired,
    },
    'subtitle',
    s.label
  ),
});

const STATS_MS = 1000;

/**
 * One set of controls over an engine, with what every player shares. Each of
 * `engines` plays what the one before it calls unplayable.
 */
export function usePlayer(
  engines: readonly EngineFactory[],
  opts: PlayerOptions
): PlayerController {
  const { client, source, startMs, url } = opts;
  const latest = useLatest(opts);
  const handle = React.useRef<(event: EngineEvent) => void>(() => {});
  const [chain] = React.useState(() => engines);
  const make = (index: number) => {
    const made: PlayerEngine = chain[index](
      (event) => {
        if (active.current === made) handle.current(event);
      },
      { launched: latest.current.launched }
    );
    return made;
  };
  const [engine, setEngine] = React.useState(() => make(0));
  const active = React.useRef(engine);
  const engineAt = React.useRef(0);
  const use = (at: number) => {
    const made = make(at);
    active.current = made;
    engineAt.current = at;
    setEngine(made);
    return made;
  };
  // The picks a version keeps when it moves to the next engine mid-play.
  const carried = React.useRef<{
    audio: string | null;
    subtitle: string | null;
  } | null>(null);
  const [state, setState] = React.useState<PlayerState>(() => ({
    ...initialState(source),
    ...(opts.muted !== undefined && { muted: opts.muted }),
    subtitleDelayMs: savedSubtitleDelay(source.Id, null)?.ms ?? 0,
  }));
  // Engines report several things in one go, before the page draws again.
  const live = React.useRef({ ...state, tracks: [] as EngineTrack[] });
  const patch = React.useCallback((next: Partial<PlayerState>) => {
    // Hosts report unchanged state with every position.
    const current = live.current;
    const keys = Object.keys(next) as (keyof PlayerState)[];
    if (keys.every((k) => Object.is(current[k], next[k]))) return;
    live.current = { ...current, ...next };
    setState((s) => ({ ...s, ...next }));
  }, []);
  const playhead = usePlayheadWriter(startMs);
  const [tracks, setTracks] = React.useState<EngineTrack[]>([]);
  const [chapters, setChapters] = React.useState<Chapter[]>();
  const [subtitleText] = React.useState(() =>
    createLive<string | undefined>(undefined)
  );
  const [thumbnails, setThumbnails] =
    React.useState<ReturnType<typeof thumbnailFeed>>();
  const [statsPage, setStatsPage] = React.useState<string | null>(null);
  const [statsRows] = React.useState(() =>
    createLive<StatsRow[] | undefined>(undefined)
  );
  const [retry, setRetry] = React.useState<PlayerController['retry']>();
  const [lift] = React.useState(() => createLive(0));
  const [shownLift] = React.useState(() => createLive(0));
  const [savedFit] = useSetting(settings.video.fit);
  const fit = opts.fit ?? savedFit;
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
    paused: opts.startPaused,
    item: opts.item,
    source,
    prefs: opts.prefs ?? {},
    subtitles: servers,
    subtitleDelayMs: live.current.subtitleDelayMs,
    volume: engine.ownVolume
      ? null
      : {
          ...storedVolume(Infinity),
          ...(latest.current.muted !== undefined && {
            muted: latest.current.muted,
          }),
        },
  });
  const latestFile = useLatest(fileFor);

  const setAudio = (id: string) => {
    engine.setAudio(id);
    patch({ audio: id });
  };
  const setSubtitle = (id: string | null) => {
    engine.setSubtitle(
      copyOf(live.current.tracks, timing.retimed, id)?.id ?? id
    );
    patch({ subtitle: id });
  };
  const setVolume = (volume: number, muted = volume === 0) => {
    engine.setVolume(volume, muted);
    if (!engine.ownVolume) storage.set(VOLUME_KEY, { volume, muted });
    patch({ volume, muted });
  };
  const restart = () => {
    setRetry(undefined);
    patch({ error: null, started: false, loaded: false, waiting: true });
  };

  // Reopening keeps the last picture and the controls up, unlike a restart.
  const reopen = () => {
    setRetry(undefined);
    patch({ error: null, waiting: true });
    engine.load({ ...latestFile.current(0), paused: false });
  };
  const liveSource = !!source.IsInfiniteStream;
  const recovery = useLiveRecovery(liveSource, url, state, {
    reopen,
    failed: async (error, retry) => {
      if (await latest.current.onLiveFailed?.()) return;
      patch({
        waiting: false,
        error:
          error ??
          t({
            comment: 'Follows "Playback failed:"',
            message: 'the live stream stopped',
          }),
      });
      setRetry(retry && { label: t`Try again`, run: retry });
    },
    showNotice: (shown) => patch({ reconnecting: shown }),
    positionMs: () => playhead.positionMs,
  });

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
        patch({ loaded: true });
        const kept = carried.current;
        carried.current = null;
        if (kept) {
          if (kept.audio) setAudio(kept.audio);
          return setSubtitle(kept.subtitle);
        }
        const { tracks, audio, subtitle } = live.current;
        const shown = shownSubtitle(tracks, subtitle, timing.retimed);
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
        if (recovery) return recovery.dropped('ended');
        const at = playhead.positionMs;
        if (live.current.durationMs - at <= EARLY_END_MS)
          return latest.current.onEnded();
        patch({
          error: t({
            comment: 'Follows "Playback failed:"',
            message: 'the stream ended early',
          }),
        });
        const resumeAt = clock(at);
        return setRetry({
          label: t`Resume from ${resumeAt}`,
          run: () => {
            restart();
            engine.load(latestFile.current(at));
          },
        });
      }
      case 'failed': {
        if (recovery && event.unsupported && !recovery.played)
          return recovery.unsupported(event.error);
        // Another engine's offer comes first for a source that never played here.
        if (recovery && (!event.retry || recovery.played))
          return recovery.dropped(`failed: ${event.error}`);
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
      case 'unplayable': {
        if (!chain[engineAt.current + 1]) return patch({ error: event.reason });
        appLog(
          'info',
          `player: the next engine plays this version: ${event.reason}`
        );
        const { positionMs } = event;
        const now = live.current;
        carried.current =
          positionMs !== undefined && now.loaded
            ? { audio: now.audio, subtitle: now.subtitle }
            : null;
        active.current.close();
        const next = use(engineAt.current + 1);
        const file = latestFile.current(positionMs ?? startMs);
        next.load(
          positionMs === undefined ? file : { ...file, paused: now.paused }
        );
        if (now.rate !== 1) next.setRate?.(now.rate);
        return;
      }
      case 'advanced':
        return latest.current.onAdvance?.(event.next);
      case 'closed':
        return latest.current.onClosed?.();
      case 'subtitle-text':
        return subtitleText.set(event.text);
    }
  };

  const { subtitleStyle } = opts;
  // A new subtitle height shows where it puts them for a while, under the
  // controls too, which would otherwise keep them above it.
  const position = subtitleStyle?.position;
  const [placing, setPlacing] = React.useState(false);
  const placedAt = React.useRef(position);
  React.useEffect(() => {
    if (position === placedAt.current) return;
    placedAt.current = position;
    setPlacing(true);
    const timer = setTimeout(() => setPlacing(false), PLACING_MS);
    return () => clearTimeout(timer);
  }, [position]);
  // Subtitles slide to a new height, in the controls' time, rather than jump:
  // a new one every frame, which the players move to at once.
  const shownHeight = React.useRef<number | null>(null);
  React.useEffect(() => {
    const set = engine.setStyle;
    let frame = 0;
    const apply = () => {
      const lifted = placing ? 0 : lift.get();
      shownLift.set(lifted);
      if (!set) return;
      const height = subtitleHeight(subtitleStyle, lifted);
      const from = shownHeight.current ?? height;
      cancelAnimationFrame(frame);
      if (
        from === height ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        shownHeight.current = height;
        set({ subtitleStyle, fit, height });
        return;
      }
      const start = performance.now();
      frame = requestAnimationFrame(function step(now) {
        // A busy page runs a frame that began before the effect did.
        const done = Math.min(1, Math.max(0, now - start) / SUBTITLE_LIFT_MS);
        const value = from + (height - from) * (1 - (1 - done) ** 3);
        shownHeight.current = value;
        set({ subtitleStyle, fit, height: value });
        if (done < 1) frame = requestAnimationFrame(step);
      });
    };
    apply();
    const stop = lift.subscribe(apply);
    return () => {
      stop();
      cancelAnimationFrame(frame);
    };
  }, [engine, subtitleStyle, fit, placing, lift, shownLift]);

  // The controls lift the subtitles exactly while they show; hiding, both
  // still move for a while.
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown: boolean | null = null;
    const follow = () => {
      const now = lift.get() > 0;
      if (now === shown) return;
      shown = now;
      clearTimeout(timer);
      if (now) engine.showControls?.(true);
      else
        timer = setTimeout(
          () => engine.showControls?.(false),
          SUBTITLE_LIFT_MS + 100
        );
    };
    follow();
    const stop = lift.subscribe(follow);
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [engine, lift]);
  React.useEffect(() => () => engine.showControls?.(false), [engine]);

  React.useEffect(() => {
    setRetry(undefined);
    setStatsPage(null);
    timing.clearRetimed();
    const file = latestFile.current(startMs);
    if (file.volume) patch(file.volume);
    carried.current = null;
    (engineAt.current ? use(0) : active.current).load(file);
    return () => active.current.close();
    // Reloading restarts playback, so only a new url or start does it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, startMs]);

  const { muted } = opts;
  const loadedMuted = React.useRef(muted);
  React.useEffect(() => {
    if (muted === undefined || muted === loadedMuted.current) return;
    loadedMuted.current = muted;
    engine.setVolume(live.current.volume, muted);
    patch({ muted });
  }, [engine, muted, patch]);

  React.useEffect(() => {
    const read = engine.stats?.read;
    if (!statsPage || !read) return;
    let stopped = false;
    const ask = () =>
      read(statsPage).then(
        (rows) => !stopped && statsRows.set(rows),
        () => {}
      );
    void ask();
    const timer = setInterval(ask, STATS_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      statsRows.set(undefined);
    };
  }, [engine, statsPage, statsRows]);

  const [thumbnailsOn] = useSetting(settings.controls.thumbnails);
  React.useEffect(() => {
    // A live stream has no seek bar, and opening it again can take the
    // provider's only connection from the player.
    if (
      !engine.thumbnails ||
      !thumbnailsOn ||
      liveSource ||
      opts.thumbnails === false
    )
      return;
    const feed = thumbnailFeed((onThumbnail) =>
      engine.thumbnails!({ url, headers: latest.current.headers }, onThumbnail)
    );
    setThumbnails(feed);
    return () => {
      feed.stop();
      setThumbnails(undefined);
    };
  }, [engine, latest, url, thumbnailsOn, liveSource, opts.thumbnails]);

  React.useEffect(() => {
    if (!thumbnails || !state.started) return;
    const timer = setTimeout(() => thumbnails.prepare(), THUMBNAIL_INDEX_MS);
    return () => clearTimeout(timer);
  }, [thumbnails, state.started]);

  const timing = useSubtitleTiming({
    engine,
    sourceId: source.Id,
    url,
    tracks,
    servers,
    picked: state.subtitle,
    playhead,
    live,
    patch,
  });
  const { shown, retimed } = timing;
  const subtitleTracks = tracks.filter((t) => t.type === 'subtitle');
  const { stats } = engine;
  return {
    state: { ...state, subtitle: shown },
    playhead,
    audioTracks: tracks.filter((t) => t.type === 'audio').map(asTrack),
    // The file's own, the server's, then any the user added.
    subtitleTracks: [
      ...subtitleTracks
        .filter((t) => !t.external)
        .map((t) => ({ ...asTrack(t), file: true, facts: trackFacts(t) })),
      ...servers.map((s) => ({ ...serverTrack(s), facts: serverFacts(s) })),
      ...subtitleTracks
        .filter(
          (t) =>
            t.external &&
            !t.server &&
            !Object.values(retimed).some((c) => c.name === t.title)
        )
        .map((t) => ({ ...asTrack(t), facts: trackFacts(t) })),
    ],
    subtitleText,
    subtitleLift: shownLift,
    thumbnails,
    togglePlay: () => engine.setPaused(!live.current.paused),
    setPaused: (paused) => engine.setPaused(paused),
    seek: (ms, snapMs) => {
      engine.seek(ms, snapMs);
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
    setSubtitleDelay: timing.setSubtitleDelay,
    skipAhead: engine.skipAhead && ((skips) => engine.skipAhead!(skips)),
    // Also for players without styles: the page lifts the subtitle it draws for them.
    liftSubtitles: lift.set,
    canReadSubtitle: (id) =>
      servers.some((s) => s.id === id) || !!engine.ownText?.(id),
    subtitleLines: async () => {
      const text = shown ? await timing.readSubtitle(shown) : null;
      return text === null ? null : plainLines(parseSubtitle(text));
    },
    autoSync: timing.autoSync,
    subtitleFiles: engine.subtitleFiles,
    toggleFullscreen:
      engine.toggleFullscreen && (() => engine.toggleFullscreen!()),
    togglePictureInPicture:
      engine.togglePictureInPicture && (() => engine.togglePictureInPicture!()),
    setFrame: engine.setFrame && ((frame) => engine.setFrame!(frame)),
    chapters,
    stats: stats && {
      pages: stats.pages,
      page: statsPage,
      show: (page) => {
        stats.draw?.(page);
        setStatsPage(page);
      },
      rows: statsRows,
    },
    external: engine.external,
    close: engine.closeWindow && (() => engine.closeWindow!()),
    queueNext: engine.queueNext && ((next) => engine.queueNext!(next)),
    sound: engine.sound,
    fit: engine.fits,
    retry,
    goLive: liveSource ? reopen : undefined,
  };
}
