import { t } from '@lingui/core/macro';
import React from 'react';
import type { JellyfinClient } from '../client';
import { clock } from '../format';
import { settings, useSetting } from '../settings';
import { storage } from '../storage';
import type { Span } from '../subtitles/align';
import { referenceTrack, SubtitleSync } from '../subtitles/auto-sync';
import {
  parseSubtitle,
  plainLines,
  retimeSubtitle,
  subtitleExtension,
} from '../subtitles/cues';
import {
  clampDelay,
  savedSubtitleDelay,
  saveSubtitleDelay,
  SUBTITLE_DELAY_LIMIT_MS,
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
  type SyncOutcome,
  type SyncStatus,
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
import { thumbnailFeed } from './thumbnails';
import { chooseTracks, serverFacts, trackFacts } from './track-picks';

/** How long the player says it is syncing; an answer after that still shows. */
const ASKED_WAIT_MS = 10_000;

/** An end of file this far before the duration is a stream that gave out, not the end. */
const EARLY_END_MS = 30_000;

/** Late enough after the start that reading the file's index for thumbnails doesn't slow it. */
const THUMBNAIL_INDEX_MS = 5_000;

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

/** A subtitle's copy stretched to the video's frame rate, which shows in its place. */
interface Retimed {
  name: string;
  text: string;
}

/** The subtitle as the page names it: a server subtitle by its own id once loaded, a copy as the one it was made from. */
function shownSubtitle(
  tracks: EngineTrack[],
  id: string | null,
  retimed: Record<string, Retimed>
): string | null {
  const track = tracks.find((t) => t.type === 'subtitle' && t.id === id);
  const original =
    track?.external &&
    Object.keys(retimed).find((from) => retimed[from].name === track.title);
  return original || (track?.server ?? id);
}

function copyOf(
  tracks: EngineTrack[],
  retimed: Record<string, Retimed>,
  id: string | null
): EngineTrack | undefined {
  const copy = id ? retimed[id] : undefined;
  return copy
    ? tracks.find(
        (t) => t.type === 'subtitle' && t.external && t.title === copy.name
      )
    : undefined;
}

/** Lines of the file's own subtitle heard so far, which every sync starts from, and the syncs taking new ones. */
interface Heard {
  track: string;
  lines: Span[];
  takers: Set<(lines: Span[]) => void>;
}

/** What a subtitle's delay is kept under: an added file by its name, as its id is just the next free one. */
function delayKey(tracks: EngineTrack[], id: string): string {
  const track = tracks.find((t) => t.id === id);
  return track?.external && !track.server && track.title
    ? `file:${track.title}`
    : id;
}

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
    subtitleDelayMs: savedSubtitleDelay(source.Id, null)?.ms ?? 0,
  }));
  // Engines report several things in one go, before the page draws again.
  const live = React.useRef({ ...state, tracks: [] as EngineTrack[] });
  const patch = React.useCallback((next: Partial<PlayerState>) => {
    live.current = { ...live.current, ...next };
    setState((s) => ({ ...s, ...next }));
  }, []);
  const playhead = usePlayheadWriter(startMs);
  const [tracks, setTracks] = React.useState<EngineTrack[]>([]);
  const [chapters, setChapters] = React.useState<Chapter[]>();
  const [subtitleText, setSubtitleText] = React.useState<string>();
  const [thumbnails, setThumbnails] =
    React.useState<ReturnType<typeof thumbnailFeed>>();
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
  const heard = React.useRef<Heard | null>(null);
  const asking = React.useRef(false);
  const [syncRuns, setSyncRuns] = React.useState(0);
  const [syncWaiting, setSyncWaiting] = React.useState(false);
  const [syncOutcome, setSyncOutcome] = React.useState<{
    subtitle: string;
    outcome: SyncOutcome;
  } | null>(null);
  const [retimed, setRetimed] = React.useState<Record<string, Retimed>>({});
  const [subtitleIndex, setSubtitleIndex] = React.useState<{
    url: string;
    tracks: Record<string, Span[]> | null;
  }>();

  const readSubtitle = (id: string): Promise<string> | null => {
    if (copyOf(tracks, retimed, id)) return Promise.resolve(retimed[id].text);
    const server = servers.find((s) => s.id === id);
    if (!server) {
      const text = engine.ownText?.(id);
      return text ? Promise.resolve(text) : null;
    }
    return fetch(server.url).then((res) => (res.ok ? res.text() : ''));
  };
  const latestRead = useLatest(readSubtitle);

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
    volume: engine.ownVolume ? null : storedVolume(Infinity),
  });
  const latestFile = useLatest(fileFor);

  const setAudio = (id: string) => {
    engine.setAudio(id);
    patch({ audio: id });
  };
  const setSubtitle = (id: string | null) => {
    engine.setSubtitle(copyOf(live.current.tracks, retimed, id)?.id ?? id);
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
        const { tracks, audio, subtitle } = live.current;
        const shown = shownSubtitle(tracks, subtitle, retimed);
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
        return latest.current.onAdvance?.(event.next);
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
    setRetimed({});
    const file = latestFile.current(startMs);
    if (file.volume) patch(file.volume);
    engine.load(file);
    return () => engine.close();
    // Reloading restarts playback, so only a new url or start does it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, startMs]);

  const [thumbnailsOn] = useSetting(settings.controls.thumbnails);
  React.useEffect(() => {
    if (!engine.thumbnails || !thumbnailsOn) return;
    const feed = thumbnailFeed((onThumbnail) =>
      engine.thumbnails!({ url, headers: latest.current.headers }, onThumbnail)
    );
    setThumbnails(feed);
    return () => {
      feed.stop();
      setThumbnails(undefined);
    };
  }, [engine, latest, url, thumbnailsOn]);

  React.useEffect(() => {
    if (!thumbnails || !state.started) return;
    const timer = setTimeout(() => thumbnails.prepare(), THUMBNAIL_INDEX_MS);
    return () => clearTimeout(timer);
  }, [thumbnails, state.started]);

  const shown = shownSubtitle(tracks, state.subtitle, retimed);
  const copy = copyOf(tracks, retimed, shown)?.id;
  const shownServer = servers.find((s) => s.id === shown);
  const shownTrack = tracks.find((t) => t.id === shown);
  const syncing =
    !!engine.watchLines && !!(shownServer || shownTrack?.external);
  const index = subtitleIndex?.url === url ? subtitleIndex : undefined;
  React.useEffect(() => {
    if (!syncing || !engine.subtitleIndex || index) return;
    let stale = false;
    void engine
      .subtitleIndex()
      .then((tracks) => !stale && setSubtitleIndex({ url, tracks }));
    return () => {
      stale = true;
    };
  }, [engine, syncing, index, url]);
  const lang = shownServer?.lang ?? shownTrack?.lang;
  // An engine that reads the file's index is waited on, so a track its others don't back is never used.
  const waiting = !!engine.subtitleIndex && !index;
  const reference = React.useMemo(
    () =>
      syncing && !waiting
        ? referenceTrack(tracks, lang, index?.tracks)?.id
        : undefined,
    [syncing, waiting, tracks, lang, index]
  );

  React.useEffect(() => {
    if (!shown || !engine.setSubtitleDelay) return;
    const ms = savedSubtitleDelay(source.Id, delayKey(tracks, shown))?.ms ?? 0;
    if (ms === live.current.subtitleDelayMs) return;
    engine.setSubtitleDelay(ms);
    patch({ subtitleDelayMs: ms });
  }, [engine, patch, shown, source.Id, tracks]);

  // One watch while added subtitles show, however often they change or a sync is asked for.
  React.useEffect(() => {
    if (!reference || !engine.watchLines) return;
    const history: Heard = { track: reference, lines: [], takers: new Set() };
    heard.current = history;
    const stop = engine.watchLines(reference, (lines) => {
      history.lines.push(...lines);
      for (const take of history.takers) take(lines);
    });
    return () => {
      stop();
      if (heard.current === history) heard.current = null;
    };
  }, [engine, reference, source.Id]);

  // Lines an added subtitle up with the file's own, retiming one made for another frame rate; a delay set by hand holds.
  React.useEffect(() => {
    const { setSubtitleDelay } = engine;
    const history = heard.current;
    if (!shown || !history || history.track !== reference || !setSubtitleDelay)
      return;
    const key = delayKey(live.current.tracks, shown);
    const asked = asking.current;
    asking.current = false;
    // Asked, a delay set by hand no longer holds.
    if (asked)
      saveSubtitleDelay(source.Id, key, {
        ms: live.current.subtitleDelayMs,
      });
    let stopped = false;
    let stop = () => {};
    let first = true;
    const report = (outcome: SyncOutcome) => {
      setSyncWaiting(false);
      setSyncOutcome({ subtitle: shown, outcome });
    };
    const retime = (text: string, ratio: number) => {
      const add = engine.subtitleFiles?.add;
      if (copy || !add) return report({ asked, failed: 'speed' });
      const body = retimeSubtitle(text, ratio);
      const name = `retimed-${shown.replace(/\W/g, '-')}.${subtitleExtension(body)}`;
      setRetimed((all) => ({ ...all, [shown]: { name, text: body } }));
      add(new File([body], name)).catch(() =>
        report({ asked, failed: 'speed' })
      );
    };
    const take = (sync: SubtitleSync, text: string, lines: Span[]) => {
      const result = sync.add(lines);
      if (sync.done) stop();
      if (!result) return;
      if ('ratio' in result) return retime(text, result.ratio);
      if ('failed' in result) return report({ asked, failed: result.failed });
      if (savedSubtitleDelay(source.Id, key)?.fixed) {
        stop();
        if (copy && first)
          report({
            asked,
            delayMs: live.current.subtitleDelayMs,
            movedMs: 0,
            first,
            retimed: true,
          });
        return;
      }
      const ms = clampDelay(result.delayMs);
      const movedMs = ms - live.current.subtitleDelayMs;
      saveSubtitleDelay(source.Id, key, { ms });
      setSubtitleDelay(ms);
      patch({ subtitleDelayMs: ms });
      report({ asked, delayMs: ms, movedMs, first, retimed: !!copy && !asked });
      first = false;
    };
    setSyncWaiting(asked);
    const waited = setTimeout(() => setSyncWaiting(false), ASKED_WAIT_MS);
    latestRead.current(shown)?.then(
      (text) => {
        if (stopped) return;
        const cues = parseSubtitle(text);
        if (!cues.length) return report({ asked, failed: 'unmatched' });
        const sync = new SubtitleSync(
          cues,
          SUBTITLE_DELAY_LIMIT_MS,
          () => playhead.positionMs,
          asked
        );
        const taker = (lines: Span[]) => take(sync, text, lines);
        taker(history.lines);
        if (sync.done) return;
        history.takers.add(taker);
        stop = () => history.takers.delete(taker);
      },
      () => !stopped && report({ asked, failed: 'unmatched' })
    );
    return () => {
      stopped = true;
      stop();
      clearTimeout(waited);
      setSyncWaiting(false);
    };
  }, [engine, latestRead, patch, reference, shown, copy, source.Id, syncRuns]);

  const lastSync = syncOutcome?.subtitle === shown ? syncOutcome.outcome : null;
  const syncStatus: SyncStatus | undefined =
    shown && savedSubtitleDelay(source.Id, delayKey(tracks, shown))?.fixed
      ? 'hand'
      : !lastSync
        ? undefined
        : 'failed' in lastSync
          ? lastSync.failed
          : copy
            ? 'retimed'
            : 'synced';
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
      ...servers.map((s) => ({ ...asTrack(s), facts: serverFacts(s) })),
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
    setSubtitleDelay:
      engine.setSubtitleDelay &&
      ((ms) => {
        const delay = clampDelay(ms);
        engine.setSubtitleDelay!(delay);
        if (shown)
          saveSubtitleDelay(source.Id, delayKey(tracks, shown), {
            ms: delay,
            fixed: true,
          });
        patch({ subtitleDelayMs: delay });
      }),
    skipAhead: engine.skipAhead && ((skips) => engine.skipAhead!(skips)),
    liftSubtitles: engine.setStyle && setLift,
    canReadSubtitle: (id) =>
      servers.some((s) => s.id === id) || !!engine.ownText?.(id),
    subtitleLines: async () => {
      const text = shown ? await readSubtitle(shown) : null;
      return text === null ? null : plainLines(parseSubtitle(text));
    },
    autoSync: reference
      ? {
          run: () => {
            asking.current = true;
            setSyncRuns((n) => n + 1);
          },
          waiting: syncWaiting,
          outcome: syncOutcome?.outcome ?? null,
          status: syncStatus,
        }
      : undefined,
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
    queueNext: engine.queueNext && ((next) => engine.queueNext!(next)),
    sound: engine.sound,
    fit: engine.fits,
    retry,
  };
}
