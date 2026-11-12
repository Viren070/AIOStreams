import React from 'react';
import type { Span } from '@/lib/subtitles/align';
import { referenceTrack, SubtitleSync } from '@/lib/subtitles/auto-sync';
import {
  parseSubtitle,
  retimeSubtitle,
  subtitleExtension,
} from '@/lib/subtitles/cues';
import {
  clampDelay,
  savedSubtitleDelay,
  saveSubtitleDelay,
  SUBTITLE_DELAY_LIMIT_MS,
} from '@/lib/subtitles/delay';
import { useLatest } from '@/hooks/use-latest';
import type {
  PlayerController,
  PlayerState,
  SyncOutcome,
  SyncStatus,
} from './controller';
import type { EngineTrack, PlayerEngine, ServerSubtitle } from './engine';
import type { PlayheadWriter } from './playhead';

/** How long the player says it is syncing; an answer after that still shows. */
const ASKED_WAIT_MS = 10_000;

/** A subtitle's copy stretched to the video's frame rate, which shows in its place. */
export interface Retimed {
  name: string;
  text: string;
}

/** The subtitle as the page names it: a server subtitle by its own id once loaded, a copy as the one it was made from. */
export function shownSubtitle(
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

export function copyOf(
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

/** The shown subtitle's delay, saved per subtitle, and its sync with the file's own lines. */
export function useSubtitleTiming({
  engine,
  sourceId,
  url,
  tracks,
  servers,
  picked,
  playhead,
  live,
  patch,
}: {
  engine: PlayerEngine;
  sourceId: string | null | undefined;
  url: string;
  tracks: EngineTrack[];
  servers: ServerSubtitle[];
  picked: string | null;
  playhead: PlayheadWriter;
  live: React.RefObject<{ subtitleDelayMs: number; tracks: EngineTrack[] }>;
  patch: (next: Partial<PlayerState>) => void;
}) {
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

  const shown = shownSubtitle(tracks, picked, retimed);
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
    const ms = savedSubtitleDelay(sourceId, delayKey(tracks, shown))?.ms ?? 0;
    if (ms === live.current.subtitleDelayMs) return;
    engine.setSubtitleDelay(ms);
    patch({ subtitleDelayMs: ms });
  }, [engine, patch, shown, sourceId, tracks]);

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
  }, [engine, reference, sourceId]);

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
      saveSubtitleDelay(sourceId, key, {
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
      if (savedSubtitleDelay(sourceId, key)?.fixed) {
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
      saveSubtitleDelay(sourceId, key, { ms });
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
  }, [engine, latestRead, patch, reference, shown, copy, sourceId, syncRuns]);

  const lastSync = syncOutcome?.subtitle === shown ? syncOutcome.outcome : null;
  const syncStatus: SyncStatus | undefined =
    shown && savedSubtitleDelay(sourceId, delayKey(tracks, shown))?.fixed
      ? 'hand'
      : !lastSync
        ? undefined
        : 'failed' in lastSync
          ? lastSync.failed
          : copy
            ? 'retimed'
            : 'synced';

  const setSubtitleDelay: PlayerController['setSubtitleDelay'] =
    engine.setSubtitleDelay &&
    ((ms) => {
      const delay = clampDelay(ms);
      engine.setSubtitleDelay!(delay);
      if (shown)
        saveSubtitleDelay(sourceId, delayKey(tracks, shown), {
          ms: delay,
          fixed: true,
        });
      patch({ subtitleDelayMs: delay });
    });

  const autoSync: PlayerController['autoSync'] = reference
    ? {
        run: () => {
          asking.current = true;
          setSyncRuns((n) => n + 1);
        },
        waiting: syncWaiting,
        outcome: syncOutcome?.outcome ?? null,
        status: syncStatus,
      }
    : undefined;

  return {
    shown,
    retimed,
    clearRetimed: () => setRetimed({}),
    readSubtitle,
    setSubtitleDelay,
    autoSync,
  };
}
