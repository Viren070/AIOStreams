import { t } from '@lingui/core/macro';
import { fullTitle } from '@/lib/format';
import {
  base64,
  checkSubtitleFile,
  readSubtitleFile,
} from '@/lib/subtitles/files';
import { settings, type SubtitleStyle } from '@/lib/settings';
import { subtitleLanguages } from '@/lib/jellyfin/user-config';
import {
  MPV_OUTLINE,
  MPV_SHADOW,
  mpvColor,
  subtitleScale,
} from '@/lib/subtitles/style';
import { parseChapters } from '@/lib/playback/chapters';
import { upscalingOn } from '@/lib/playback/upscaling';
import type { Span } from '@/lib/subtitles/align';
import {
  ownTrackLabel,
  type QueuedItem,
  type Track,
} from '@/lib/playback/controller';
import type {
  EngineFactory,
  EngineFile,
  EngineState,
  EngineTrack,
  ServerSubtitle,
  VideoFrame,
} from '@/lib/playback/engine';
import { audioCodes } from '@/lib/playback/track-picks';
import { currentHost } from '..';
import { appBridge, type AppTrack, type ShellMessage } from './bridge';
import { exoStats } from './exo-stats';
import { passthroughFormats } from './sound';

const statsPages = (): Track[] => [
  { id: '1', label: t`Playback` },
  { id: '2', label: t`Frame timings` },
  { id: '3', label: t`Cache` },
  { id: '5', label: t`Tracks` },
];

/** How long a player in its own window waits for the next episode's page. */
const LINGER_MS = 10_000;
let linger: ReturnType<typeof setTimeout> | undefined;
/** What a launched player moved on to by itself, which the next page takes over. */
let advanced: { itemId: string; sourceId: string } | null = null;
/** The engine that loaded last, which alone may stop the one player. */
let loadedBy: object | null = null;

const SUBTITLE_TYPES = ['srt', 'vtt', 'ass', 'ssa', 'sub', 'sup'];
/** The apps list an added file under its name, cut to this length. */
const NAME_LENGTH = 200;
const INDEX_WAIT_MS = 12_000;

const SUBTITLE_MODES = {
  Default: 'default',
  Always: 'always',
  Smart: 'smart',
  OnlyForced: 'forced',
  None: 'none',
} as const;

type PlayedFile = Pick<QueuedItem, 'url' | 'source' | 'startMs' | 'headers'>;

/** From the app's player itself, rather than the window or the app. */
const fromPlayer = (m: ShellMessage) =>
  m.type === 'player-state' ||
  m.type === 'player-tracks' ||
  m.type === 'player-chapters' ||
  m.type === 'player-event' ||
  m.type === 'player-ended';

/**
 * The AIOStreams apps' player, drawn beneath the page, or with `launched`,
 * the user's own player in its own window. The server's subtitles are
 * downloaded only once picked: a version can carry dozens.
 */

// The apps' players draw a styled script with libass.
const subtitleAddress = (s: ServerSubtitle) => s.assUrl ?? s.url;

/**
 * In the app's own measure: a TV lays the page out zoomed to fit its width
 * (lib/tv.ts), which the app's pixels don't follow.
 */
function unzoomed(frame: VideoFrame): VideoFrame {
  const zoom = window.visualViewport?.scale ?? 1;
  if (zoom === 1) return frame;
  return {
    ...frame,
    x: frame.x * zoom,
    y: frame.y * zoom,
    width: frame.width * zoom,
    height: frame.height * zoom,
    radius: frame.radius * zoom,
    bottomRadius: frame.bottomRadius * zoom,
  };
}

export const appEngine: EngineFactory = (emit, { launched }) => {
  const external = !!launched;
  const shell = appBridge()!;
  const target = external ? { external: true } : {};
  const send = (type: string, fields: Record<string, unknown> = {}) =>
    shell.send({ type, ...fields, ...target });
  const report = (state: EngineState) => emit({ type: 'state', state });

  let file: EngineFile | null = null;
  let tracks: AppTrack[] = [];
  /** Files the user added, by the name the player lists them under. */
  const added = new Map<string, string>();
  let queued: QueuedItem | null = null;
  let moved = false;
  // Offered once per file.
  let retried = false;
  let statsPage: string | null = null;
  let fullscreen = false;
  let unsubscribe = () => {};

  const load = (played: PlayedFile, append: boolean) => {
    const prefs = file?.prefs ?? {};
    send('player-load', {
      url: played.url,
      headers: played.headers,
      startMs: played.startMs,
      live: !!played.source.IsInfiniteStream,
      append,
      audioLanguages: audioCodes(prefs, played.source),
      subtitleLanguages: subtitleLanguages(prefs),
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Jellyfin's name
      subtitleMode: SUBTITLE_MODES[prefs.SubtitleMode ?? 'Default'],
    });
  };

  const engineTracks = (): EngineTrack[] =>
    tracks.map((t) => ({
      id: t.id,
      type: t.type,
      label: ownTrackLabel(t.title, t.language, Number(t.id)),
      lang: t.language,
      title: t.title,
      codec: t.codec,
      forced: t.forced,
      hearingImpaired: t.hearingImpaired,
      visualImpaired: t.visualImpaired,
      default: t.default,
      external: t.external,
      server: file?.subtitles.find((s) => subtitleAddress(s) === t.url)?.id,
    }));

  const exoPlayerStats = exoStats();
  const showOverlay = (page: string | null) => {
    statsPage = page;
    send('player-stats-overlay', { page });
  };
  const self = {};

  return {
    load(next) {
      unsubscribe();
      if (!external) loadedBy = self;
      file = next;
      tracks = [];
      added.clear();
      moved = false;
      retried = false;
      let buffering = false;
      let seeking = false;
      // Set while the launched player may already play this version, until it says whether it is idle.
      let adopting =
        external &&
        advanced?.itemId === next.item.Id &&
        advanced?.sourceId === next.source.Id;
      let adopted = false;
      advanced = null;

      unsubscribe = shell.subscribe((m) => {
        const toLaunched = 'external' in m && m.external === true;
        if (fromPlayer(m) && (moved || toLaunched !== external)) return;
        switch (m.type) {
          case 'player-state': {
            const { positionMs, buffered, idle } = m;
            if (positionMs !== undefined || buffered !== undefined)
              emit({ type: 'position', positionMs, buffered });
            if (m.buffering !== undefined) buffering = m.buffering;
            if (m.fullscreen !== undefined) fullscreen = m.fullscreen;
            if (m.seeking !== undefined) seeking = m.seeking;
            report({
              ...(m.durationMs !== undefined && { durationMs: m.durationMs }),
              ...(m.paused !== undefined && { paused: m.paused }),
              ...((m.buffering !== undefined || m.seeking !== undefined) && {
                waiting: buffering || seeking,
              }),
              ...(m.volume !== undefined && { volume: m.volume }),
              ...(m.maxVolume !== undefined && { maxVolume: m.maxVolume }),
              ...(m.muted !== undefined && { muted: m.muted }),
              ...(m.speed !== undefined && { rate: m.speed }),
              ...(m.audio !== undefined && { audio: m.audio }),
              ...(m.subtitle !== undefined && { subtitle: m.subtitle }),
              ...(m.fullscreen !== undefined && { fullscreen: m.fullscreen }),
              ...(m.passthrough !== undefined && {
                passthrough: m.passthrough,
              }),
            });
            if (idle === undefined || !adopting) return;
            adopting = false;
            if (idle) load(next, false);
            else {
              report({ started: true, waiting: false });
              adopted = true;
            }
            return;
          }
          case 'player-tracks':
            tracks = m.tracks;
            emit({ type: 'tracks', tracks: engineTracks() });
            if (adopted) {
              adopted = false;
              emit({ type: 'loaded' });
            }
            return;
          case 'player-chapters':
            return emit({
              type: 'chapters',
              chapters: parseChapters(m.chapters),
            });
          case 'player-event':
            // The next file it starts is the queued one.
            if (m.name === 'start' && queued) {
              moved = true;
              advanced = { itemId: queued.itemId, sourceId: queued.source.Id! };
              emit({ type: 'advanced', next: queued });
            } else if (m.name === 'restart')
              report({ started: true, waiting: false });
            else if (m.name === 'loaded') emit({ type: 'loaded' });
            return;
          case 'player-ended': {
            if (m.reason === 'eof' && !queued) emit({ type: 'ended' });
            if (m.reason !== 'error') return;
            const other = playsWithExoPlayer() ? 'mpv' : 'exoplayer';
            const offer =
              !retried &&
              !external &&
              !LINK_FAILURES.has(m.error ?? '') &&
              appBridge()?.platform === 'android' &&
              // Automatic has tried both engines before a failure reaches the page.
              settings.player.engine.read() !== 'auto';
            return emit({
              type: 'failed',
              error: failure(m.error, m.status, m.cause),
              retry: offer
                ? {
                    label:
                      other === 'mpv'
                        ? t`Play with mpv`
                        : t`Play with ExoPlayer`,
                    run: () => {
                      retried = true;
                      shell.send({ type: 'player-retry', name: other });
                    },
                  }
                : undefined,
            });
          }
          case 'fullscreen':
            if (!external) report({ fullscreen: m.value });
            return;
          case 'error':
            return console.warn(m.message);
          case 'external-ended':
            if (!external) return;
            return emit(
              m.error ? { type: 'failed', error: m.error } : { type: 'closed' }
            );
        }
      });
      if (launched) {
        clearTimeout(linger);
        shell.send({
          type: 'external-open',
          player: launched.id,
          title: fullTitle(next.item),
        });
      }
      send('player-sync');
      // The player keeps pause from the last file.
      send('player-set', {
        paused: !!next.paused,
        subtitleDelayMs: next.subtitleDelayMs,
        ...next.volume,
      });
      if (!external)
        report({ fullscreen: !!currentHost().fullscreen?.active() });
      if (!adopting) load(next, false);
    },
    close() {
      unsubscribe();
      unsubscribe = () => {};
      if (statsPage) showOverlay(null);
      if (!external) {
        if (loadedBy !== self) return;
        loadedBy = null;
        return send('player-stop');
      }
      if (!moved) send('player-set', { paused: true });
      linger = setTimeout(
        () => shell.send({ type: 'external-close' }),
        LINGER_MS
      );
    },
    setPaused: (paused) => send('player-set', { paused }),
    seek: (positionMs, snapMs) => send('player-seek', { positionMs, snapMs }),
    setVolume: (volume, muted) => send('player-set', { volume, muted }),
    setRate: (speed) => send('player-set', { speed }),
    setAudio: (audio) => send('player-set', { audio }),
    setSubtitle(id) {
      const server = file?.subtitles.find((s) => s.id === id);
      if (!server) return send('player-set', { subtitle: id });
      // Fetched again on each pick: an addon may still be writing it.
      const url = subtitleAddress(server);
      const loaded = tracks.find((t) => t.url === url);
      send('player-subtitle-add', {
        url,
        title: server.label,
        language: server.lang ?? '',
        ...(loaded && { replace: Number(loaded.id) }),
      });
    },
    setSubtitleDelay: (subtitleDelayMs) =>
      send('player-set', { subtitleDelayMs }),
    skipAhead:
      external || appBridge()?.platform !== 'android'
        ? undefined
        : (skips) => send('player-skips', { segments: skips }),
    // The Android app draws the screen faster while they show.
    showControls:
      external || appBridge()?.platform !== 'android'
        ? undefined
        : (shown) => shell.send({ type: 'player-controls', shown }),
    setFrame:
      external || !shell.miniPlayer
        ? undefined
        : (frame) =>
            shell.send({
              type: 'player-frame',
              frame: frame && unzoomed(frame),
            }),
    // The user's own player keeps its own look.
    setStyle({ subtitleStyle, fit, height }) {
      if (external || !subtitleStyle) return;
      shell.send({
        type: 'player-style',
        fit,
        subtitles: subtitleLook(subtitleStyle, height),
      });
    },
    toggleFullscreen: external
      ? () => send('player-set', { fullscreen: !fullscreen })
      : () => shell.send({ type: 'fullscreen' }),
    togglePictureInPicture:
      external || !shell.pip ? undefined : () => shell.send({ type: 'pip' }),
    ownText(id) {
      const track = tracks.find((t) => t.id === id && t.external);
      return (track?.title && added.get(track.title)) || null;
    },
    watchLines: external
      ? undefined
      : (id, onLines) => {
          send('player-subtitle-lines', { track: id });
          const stop = shell.subscribe((m) => {
            if (m.type === 'player-subtitle-lines' && m.track === id)
              onLines(m.lines);
          });
          return () => {
            stop();
            send('player-subtitle-lines', { track: null });
          };
        },
    // The app gives up on the index well before this; an app that never answers has none to give.
    subtitleIndex: external
      ? undefined
      : () =>
          new Promise((resolve) => {
            const done = (tracks: Record<string, Span[]> | null) => {
              clearTimeout(timer);
              stop();
              resolve(tracks);
            };
            const timer = setTimeout(() => done(null), INDEX_WAIT_MS);
            const stop = shell.subscribe((m) => {
              if (m.type === 'player-subtitle-index') done(m.tracks);
            });
            send('player-subtitle-index');
          }),
    thumbnails: external
      ? undefined
      : ({ url, headers }, onThumbnail) => ({
          want: (positionMs, showingMs) =>
            shell.send({
              type: 'player-thumbnail',
              url,
              headers,
              positionMs,
              showingMs,
            }),
          prepare: () => shell.send({ type: 'player-thumbnail', url, headers }),
          stop: shell.subscribe((m) => {
            if (m.type !== 'player-thumbnail' || m.url !== url) return;
            onThumbnail(
              m.src ? { positionMs: m.positionMs ?? 0, src: m.src } : null
            );
          }),
        }),
    subtitleFiles: {
      types: SUBTITLE_TYPES,
      add: async (picked) => {
        checkSubtitleFile(picked, SUBTITLE_TYPES);
        const data = await base64(picked);
        // A file only the player can read just isn't synced.
        await readSubtitleFile(picked).then(
          ({ text }) => added.set(picked.name.slice(0, NAME_LENGTH), text),
          () => {}
        );
        send('subtitle-file', { name: picked.name, data });
      },
    },
    get stats() {
      return playsWithExoPlayer()
        ? exoPlayerStats
        : { pages: statsPages(), draw: showOverlay };
    },
    picksTracks: true,
    ownSubtitles: true,
    ownVolume: external,
    fits: !external,
    sound: !external,
    external: launched?.name,
    closeWindow: external
      ? () => {
          clearTimeout(linger);
          shell.send({ type: 'external-close' });
        }
      : undefined,
    queueNext: external
      ? (next) => {
          if (moved || (!next && !queued)) return;
          queued = next;
          if (next) load(next, true);
          else send('player-unqueue');
        }
      : undefined,
  };
};

/** mpv's words for a link that gave it no video, which the other engine can't play either. */
const LINK_FAILURES = new Set([
  // eslint-disable-next-line lingui/no-unlocalized-strings -- mpv's words
  'loading failed',
  // eslint-disable-next-line lingui/no-unlocalized-strings -- mpv's words
  'unrecognized file format',
]);

let engine: string | null = null;

export function setEngine(name: string): void {
  engine = name;
}

/** Whether the Android app plays with ExoPlayer, which has none of mpv's own options or stats. */
export const playsWithExoPlayer = () =>
  appBridge()?.platform === 'android' && engine === 'exoplayer';

function statusMeaning(status: number): string | undefined {
  if (status === 401 || status === 403) return t`refused`;
  if (status === 404 || status === 410) return t`not found`;
  if (status === 429) return t`too many requests`;
  return status >= 500 ? t`server error` : undefined;
}

function failure(
  error: string | null,
  status?: number,
  cause?: string
): string {
  if (status) {
    const meaning = statusMeaning(status);
    return meaning
      ? t`the link answered HTTP ${status} (${meaning})`
      : t`the link answered HTTP ${status}`;
  }
  if (cause) {
    const text = cause.replace(/^error: /, '');
    return text.charAt(0).toLowerCase() + text.slice(1);
  }
  // What a link answering with a web page fails as.
  // eslint-disable-next-line lingui/no-unlocalized-strings -- mpv's words
  if (error === 'unrecognized file format')
    return t`the link returned something other than a video`;
  return error ?? t`the player could not play this version`;
}

/** The user's subtitle style in the units mpv and libass share. */
function subtitleLook(style: SubtitleStyle, height: number) {
  return {
    scale: subtitleScale(style),
    bold: style.bold,
    color: mpvColor(style.textColor),
    outlineColor: mpvColor(style.outlineColor),
    outlineSize: MPV_OUTLINE[style.outline],
    shadowSize: style.shadow ? MPV_SHADOW : 0,
    font: style.font === 'default' ? undefined : style.font,
    backColor: mpvColor(style.backgroundColor, style.backgroundOpacity),
    box: style.backgroundOpacity > 0,
    override: style.overrideStyled ? 'force' : 'scale',
    position: 100 - height,
  };
}

/** This device's player settings, which each app applies its own way. */
export function playerSettings() {
  const android = appBridge()?.platform === 'android';
  const { video, audio } = settings;
  return {
    hardwareDecoding: video.hardwareDecoding.read(),
    audioChannels: audio.channels.read(),
    ...passthroughFormats(),
    audioDelayMs: audio.delayMs.read(),
    dolbyVision: video.dolbyVision.read(),
    dialogueBoost: audio.dialogueBoost.read(),
    nightMode: audio.nightMode.read(),
    ac3Encode: audio.ac3Encode.read(),
    cacheMb: Number(settings.player.cacheSize.read()) || 0,
    upscaling: upscalingOn(),
    ...(android
      ? {
          frameRate: video.frameRate.read(),
          tunneling: video.tunneling.read(),
        }
      : { audioDevice: audio.device.read() }),
  };
}
