import { t } from '@lingui/core/macro';
import { formatBytes } from '@aiostreams/ui/core/format';
import { fullTitle } from '../../format';
import {
  base64,
  checkSubtitleFile,
  readSubtitleFile,
} from '../../subtitles/files';
import { settings, type SubtitleStyle } from '../../settings';
import { subtitleLanguages } from '../../user-config';
import {
  MPV_OUTLINE,
  MPV_SHADOW,
  mpvColor,
  subtitleHeight,
  subtitleScale,
} from '../../subtitles/style';
import { parseChapters } from '../../playback/chapters';
import type { Span } from '../../subtitles/align';
import {
  ownTrackLabel,
  type QueuedItem,
  type Track,
} from '../../playback/controller';
import type {
  EngineFactory,
  EngineFile,
  EngineState,
  EngineTrack,
} from '../../playback/engine';
import { audioCodes } from '../../playback/track-picks';
import { currentHost } from '..';
import { appBridge, type AppTrack, type ShellMessage } from './bridge';
import { passthroughFormats } from './sound';

const statsPages = (): Track[] => [
  { id: '1', label: t`Playback` },
  { id: '2', label: t`Frame timings` },
  { id: '3', label: t`Cache` },
  { id: '5', label: t`Tracks` },
];

/** ExoPlayer draws no statistics, so the page asks for its numbers while they show. */
const exoStats = (): Track[] => [{ id: 'exo', label: t`Playback` }];
const STATS_MS = 1000;

/* eslint-disable lingui/no-unlocalized-strings -- a technical readout, as mpv's own is */
const CODECS: Record<string, string> = {
  'video/avc': 'H.264',
  'video/hevc': 'HEVC',
  'video/av01': 'AV1',
  'video/x-vnd.on2.vp9': 'VP9',
  'audio/mp4a-latm': 'AAC',
  'audio/ac3': 'AC-3',
  'audio/eac3': 'E-AC-3',
  'audio/eac3-joc': 'E-AC-3 Atmos',
  'audio/true-hd': 'TrueHD',
  'audio/vnd.dts': 'DTS',
  'audio/vnd.dts.hd': 'DTS-HD',
  'audio/vnd.dts.uhd;profile=p2': 'DTS:X',
  'audio/ac4': 'AC-4',
  'audio/opus': 'Opus',
  'audio/flac': 'FLAC',
  'audio/raw': 'PCM',
};

/** Media3's C.COLOR_TRANSFER_* values. */
const TRANSFERS: Record<number, string> = { 6: 'HDR10 (PQ)', 7: 'HLG' };
/** Media3's C.COLOR_SPACE_BT2020. */
const BT2020 = 6;

const HEVC_PROFILES: Record<string, string> = {
  '1': 'Main',
  '2': 'Main 10',
  '3': 'Main Still',
};
const AVC_PROFILES: Record<string, string> = {
  '42': 'Baseline',
  '4D': 'Main',
  '64': 'High',
  '6E': 'High 10',
};

/** The profile a codec string names, as `hvc1.2.4.L153` or `dvhe.08.06` do. */
function profileOf(codecs: string | undefined): string | undefined {
  const [kind = '', a = '', b = ''] = codecs?.split('.') ?? [];
  if (/^(dvhe|dvh1|dav1|dva1|dvav)$/.test(kind))
    return `Dolby Vision profile ${Number(a)}, level ${Number(b)}`;
  if (kind === 'hvc1' || kind === 'hev1')
    return HEVC_PROFILES[a.replace(/^[A-C]/, '')];
  if (kind === 'avc1' || kind === 'avc3')
    return AVC_PROFILES[a.slice(0, 2).toUpperCase()];
  return undefined;
}

/** Android's display HDR types. */
const HDR_TYPES: Record<number, string> = {
  1: 'Dolby Vision',
  2: 'HDR10',
  3: 'HLG',
  4: 'HDR10+',
};

function exoStatsText(
  stats: Record<string, unknown>,
  cpu: number | undefined
): string {
  const num = (key: string) =>
    typeof stats[key] === 'number' ? (stats[key] as number) : undefined;
  const str = (key: string) =>
    typeof stats[key] === 'string' ? (stats[key] as string) : undefined;
  const list = (key: string) =>
    Array.isArray(stats[key]) ? (stats[key] as number[]) : [];
  const codec = (mime?: string) => (mime && (CODECS[mime] ?? mime)) || '?';
  const rate = (bits?: number) =>
    bits && bits > 0 ? ` · ${(bits / 1e6).toFixed(1)} Mbps` : '';
  const lines = ['Engine     ExoPlayer'];
  if (str('videoMime')) {
    const fps = num('frameRate');
    // A Dolby Vision track played as its base layer comes out as plain HEVC.
    const profile = profileOf(str('dolbyVisionCodecs') ?? str('videoCodecs'));
    const vision = profile?.startsWith('Dolby');
    lines.push(
      `Video      ${codec(str('videoMime'))}${profile && !vision ? ` ${profile}` : ''} ${num('width')}×${num('height')}${fps && fps > 0 ? ` ${fps.toFixed(3)} fps` : ''}${rate(num('videoBitrate'))}`,
      `Colour     ${[vision && profile, TRANSFERS[num('colorTransfer') ?? -1] ?? (vision ? undefined : 'SDR'), num('colorSpace') === BT2020 && 'BT.2020'].filter(Boolean).join(' · ')}`,
      `Decoder    ${str('videoDecoder') ?? 'none'}`
    );
    const route = str('dolbyVisionRoute');
    if (route) lines.push(`Plays as   ${route}`);
  }
  const hdr = list('hdrTypes')
    .map((type) => HDR_TYPES[type])
    .filter(Boolean);
  const profiles = list('dolbyVisionProfiles');
  lines.push(
    `Display    ${hdr.length ? hdr.join(', ') : 'SDR'}`,
    `DV decoder ${profiles.length ? `profiles ${profiles.join(', ')}` : 'none'}`
  );
  if (str('audioMime')) {
    const hz = num('sampleRate');
    lines.push(
      `Audio      ${codec(str('audioMime'))} ${num('channels') ?? '?'} ch${hz && hz > 0 ? ` ${hz / 1000} kHz` : ''}${rate(num('audioBitrate'))}`,
      `Decoder    ${str('audioDecoder') ?? 'passthrough'}`
    );
    const output = str('outputMime');
    const outputs = num('outputChannels') ?? 0;
    const inputs = num('channels') ?? 0;
    if (output === 'audio/raw')
      lines.push(
        `Output     PCM ${outputs} ch${inputs > outputs ? `, mixed from ${inputs}` : ''}`
      );
    else if (output === 'audio/ac3' && str('audioMime') !== output)
      lines.push(`Output     AC-3 ${outputs} ch, re-encoded`);
    else if (output)
      lines.push(
        `Output     ${codec(output)} passthrough (sound settings don't apply)`
      );
  }
  const buffered = num('bufferedMs');
  if (buffered !== undefined)
    lines.push(`Buffered   ${(buffered / 1000).toFixed(1)} s`);
  const ahead = num('cacheAhead');
  if (ahead !== undefined) {
    const aheadMs = num('cacheAheadMs');
    const behindMs = num('cacheBehindMs');
    const speed = num('linkSpeed') ?? 0;
    const ratio = num('linkRatio');
    lines.push(
      `Cache      ${behindMs !== undefined ? `${Math.round(behindMs / 1000)} s behind · ` : ''}${aheadMs !== undefined ? `${Math.round(aheadMs / 1000)} s` : formatBytes(ahead)} ahead · ${formatBytes(num('cacheBytes'))} of ${formatBytes(num('cacheBudget'))}${speed > 0 ? ` · link ${formatBytes(speed)}/s${ratio ? ` (${ratio.toFixed(1)}× the file)` : ''}` : ''}`
    );
  }
  const shown = num('renderedFrames');
  if (shown !== undefined)
    lines.push(
      `Frames     ${shown} shown · ${num('droppedFrames') ?? 0} dropped`
    );
  const javaHeap = num('javaHeap');
  const nativeHeap = num('nativeHeap');
  if (javaHeap !== undefined && nativeHeap !== undefined)
    lines.push(
      `Memory     Java ${formatBytes(javaHeap)} · native ${formatBytes(nativeHeap)}`
    );
  if (cpu !== undefined) lines.push(`App CPU    ${Math.round(cpu)}% of a core`);
  return lines.join('\n');
}
/* eslint-enable lingui/no-unlocalized-strings */

/** How long a player in its own window waits for the next episode's page. */
const LINGER_MS = 10_000;
let linger: ReturnType<typeof setTimeout> | undefined;
/** What a launched player moved on to by itself, which the next page takes over. */
let advanced: { itemId: string; sourceId: string } | null = null;

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
  let stopExoStats = () => {};

  const load = (played: PlayedFile, append: boolean) => {
    const prefs = file?.prefs ?? {};
    send('player-load', {
      url: played.url,
      headers: played.headers,
      startMs: played.startMs,
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
      server: file?.subtitles.find((s) => s.url === t.url)?.id,
    }));

  const showExoStats = (page: string | null) => {
    stopExoStats();
    if (!page) return emit({ type: 'stats-text', text: undefined });
    let last: { cpuMs: number; atMs: number } | undefined;
    const stop = shell.subscribe((m) => {
      if (m.type !== 'player-stats') return;
      const cpu =
        last && m.atMs > last.atMs
          ? ((m.cpuMs - last.cpuMs) / (m.atMs - last.atMs)) * 100
          : undefined;
      last = m;
      emit({ type: 'stats-text', text: exoStatsText(m.stats, cpu) });
    });
    const ask = () => shell.send({ type: 'player-stats' });
    ask();
    const timer = setInterval(ask, STATS_MS);
    stopExoStats = () => {
      clearInterval(timer);
      stop();
      stopExoStats = () => {};
    };
  };

  const showOverlay = (page: string | null) => {
    statsPage = page;
    send('player-stats-overlay', { page });
  };

  return {
    load(next) {
      unsubscribe();
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
          case 'pip':
            return report({ pictureInPicture: m.value });
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
      stopExoStats();
      if (statsPage) showOverlay(null);
      if (!external) return send('player-stop');
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
      const loaded = tracks.find((t) => t.url === server.url);
      send('player-subtitle-add', {
        url: server.url,
        title: server.label,
        language: server.lang ?? '',
        ...(loaded && { replace: Number(loaded.id) }),
      });
    },
    setSubtitleDelay: (subtitleDelayMs) =>
      send('player-set', { subtitleDelayMs }),
    skipAhead: external
      ? undefined
      : (skips) => send('player-skips', { segments: skips }),
    // The user's own player keeps its own look.
    setStyle({ subtitleStyle, fit, lift }) {
      if (external || !subtitleStyle) return;
      shell.send({
        type: 'player-style',
        fit,
        subtitles: subtitleLook(subtitleStyle, lift),
      });
    },
    toggleFullscreen: external
      ? () => send('player-set', { fullscreen: !fullscreen })
      : () => shell.send({ type: 'fullscreen' }),
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
        ? { pages: exoStats(), show: showExoStats }
        : { pages: statsPages(), show: showOverlay };
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
function subtitleLook(style: SubtitleStyle, lift: number) {
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
    position: 100 - subtitleHeight(style, lift),
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
    ...(android
      ? {
          frameRate: video.frameRate.read(),
          tunneling: video.tunneling.read(),
        }
      : { audioDevice: audio.device.read() }),
  };
}
