import { formatBytes } from '@aiostreams/ui/core/format';
import { fullTitle } from '../../format';
import { base64, checkSubtitleFile } from '../../subtitles/files';
import { settings, type SubtitleStyle } from '../../settings';
import { subtitleLanguages, type PlaybackPrefs } from '../../user-config';
import type { SourceInfo } from '../../types';
import {
  MPV_OUTLINE,
  mpvColor,
  subtitleHeight,
  subtitleScale,
} from '../../subtitles/style';
import { parseChapters } from '../../playback/chapters';
import {
  ownTrackLabel,
  type QueuedEpisode,
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
import { appBridge } from './bridge';
import { passthroughValue } from './sound';

interface MpvTrack {
  id: number;
  type: 'video' | 'audio' | 'sub';
  title?: string;
  lang?: string;
  external?: boolean;
  'external-filename'?: string;
  selected?: boolean;
  codec?: string;
  forced?: boolean;
  'hearing-impaired'?: boolean;
  'visual-impaired'?: boolean;
  default?: boolean;
}

const IMAGE_SUBTITLE_CODECS = new Set([
  'hdmv_pgs_subtitle',
  'dvd_subtitle',
  'dvb_subtitle',
]);

const STATS_PAGES: Track[] = [
  { id: '1', label: 'Playback' },
  { id: '2', label: 'Frame timings' },
  { id: '3', label: 'Cache' },
  { id: '5', label: 'Tracks' },
];

/** ExoPlayer draws no statistics, so the page asks for its numbers while they show. */
const EXO_STATS: Track[] = [{ id: 'exo', label: 'Playback' }];
const STATS_MS = 1000;

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

/** How long a player in its own window waits for the next episode's page. */
const LINGER_MS = 10_000;
let linger: ReturnType<typeof setTimeout> | undefined;
/** The episode a launched player moved on to by itself, which the next page takes over. */
let advanced: { itemId: string; sourceId: string } | null = null;

const SUBTITLE_TYPES = ['srt', 'vtt', 'ass', 'ssa', 'sub', 'sup'];

type PlayedFile = Pick<QueuedEpisode, 'url' | 'source' | 'startMs' | 'headers'>;

/**
 * The AIOStreams apps' player, drawn beneath the page, or with `launched`,
 * the user's own player in its own window. The server's subtitles are
 * downloaded only once picked: a version can carry dozens.
 */
export const appEngine: EngineFactory = (emit, { launched }) => {
  const external = !!launched;
  const shell = appBridge()!;
  const target = external ? { external: true } : {};
  const set = (name: string, value: unknown) =>
    shell.send({ type: 'mpv-set-prop', name, value, ...target });
  const command = (...args: unknown[]) =>
    shell.send({ type: 'mpv-command', args, ...target });
  const report = (state: EngineState) => emit({ type: 'state', state });

  let file: EngineFile | null = null;
  let tracks: MpvTrack[] = [];
  let sid: string | null = null;
  let style: SubtitleStyle | undefined;
  let imageSubtitle = false;
  let queued: QueuedEpisode | null = null;
  let moved = false;
  // Offered once per file.
  let retried = false;
  let unsubscribe = () => {};
  let statsPage: string | null = null;
  let stopExoStats = () => {};

  const loadFile = (played: PlayedFile, flags: 'replace' | 'append') =>
    shell.send({
      type: 'mpv-command',
      args: [
        'loadfile',
        played.url,
        flags,
        -1,
        [
          ...(played.startMs
            ? [`start=${(played.startMs / 1000).toFixed(3)}`]
            : []),
          ...trackOptions(file?.prefs ?? {}, played.source),
        ].join(','),
      ],
      headers: played.headers,
      ...target,
    });

  const syncSubtitleScale = () => {
    const track = tracks.find((t) => t.type === 'sub' && String(t.id) === sid);
    const image = IMAGE_SUBTITLE_CODECS.has(track?.codec ?? '');
    if (external || image === imageSubtitle || !style) return;
    imageSubtitle = image;
    set('sub-scale', image ? 1 : subtitleScale(style));
  };

  const engineTracks = (): EngineTrack[] =>
    tracks.flatMap((t) =>
      t.type === 'video'
        ? []
        : [
            {
              id: String(t.id),
              type: t.type === 'audio' ? 'audio' : 'subtitle',
              label: ownTrackLabel(t.title, t.lang, t.id),
              lang: t.lang,
              title: t.title,
              forced: t.forced,
              hearingImpaired: t['hearing-impaired'],
              visualImpaired: t['visual-impaired'],
              default: t.default,
              external: t.external,
              server: file?.subtitles.find(
                (s) => s.url === t['external-filename']
              )?.id,
            },
          ]
    );

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

  const showMpvStats = (page: string | null) => {
    if (statsPage) command('script-binding', 'stats/display-stats-toggle');
    if (page) command('script-binding', `stats/display-page-${page}-toggle`);
    statsPage = page;
  };

  return {
    load(next) {
      unsubscribe();
      file = next;
      tracks = [];
      sid = null;
      moved = false;
      retried = false;
      let cache = false;
      let seeking = false;
      // Set while the launched player may already play this version, until it says whether it is idle.
      let adopting =
        external &&
        advanced?.itemId === next.item.Id &&
        advanced?.sourceId === next.source.Id;
      let adopted = false;
      advanced = null;

      const onProp = (name: string, data: unknown) => {
        const num = typeof data === 'number' ? data : null;
        switch (name) {
          case 'time-pos':
            if (num !== null)
              emit({ type: 'position', positionMs: num * 1000 });
            break;
          case 'duration':
            if (num !== null) report({ durationMs: num * 1000 });
            break;
          case 'demuxer-cache-time':
            if (num !== null)
              emit({ type: 'position', bufferedMs: num * 1000 });
            break;
          case 'pause':
            report({ paused: data === true });
            break;
          case 'paused-for-cache':
          case 'seeking':
            if (name === 'seeking') seeking = data === true;
            else cache = data === true;
            report({ waiting: cache || seeking });
            break;
          case 'idle-active':
            if (!adopting) break;
            adopting = false;
            if (data === true) loadFile(next, 'replace');
            else {
              report({ started: true, waiting: false });
              command('playlist-clear');
              adopted = true;
            }
            break;
          case 'volume':
            if (num !== null) report({ volume: num / 100 });
            break;
          case 'volume-max':
            if (num !== null) report({ maxVolume: num / 100 });
            break;
          case 'mute':
            report({ muted: data === true });
            break;
          case 'speed':
            if (num !== null) report({ rate: num });
            break;
          case 'fullscreen':
            if (external) report({ fullscreen: data === true });
            break;
          case 'aid':
          case 'sid': {
            const id =
              typeof data === 'string' && /^\d+$/.test(data) ? data : null;
            report(name === 'aid' ? { audio: id } : { subtitle: id });
            if (name === 'sid') {
              sid = id;
              syncSubtitleScale();
            }
            break;
          }
          case 'track-list':
            tracks = Array.isArray(data) ? (data as MpvTrack[]) : [];
            emit({ type: 'tracks', tracks: engineTracks() });
            syncSubtitleScale();
            if (adopted) {
              adopted = false;
              emit({ type: 'loaded' });
            }
            break;
          case 'chapter-list':
            emit({ type: 'chapters', chapters: parseChapters(data) });
            break;
        }
      };

      unsubscribe = shell.subscribe((m) => {
        const fromMpv =
          m.type === 'mpv-prop' ||
          m.type === 'mpv-event' ||
          m.type === 'mpv-ended';
        const toLaunched = 'external' in m && m.external === true;
        if (fromMpv && (moved || toLaunched !== external)) return;
        if (m.type === 'mpv-prop') onProp(m.name, m.data);
        else if (m.type === 'fullscreen' && !external)
          report({ fullscreen: m.value });
        else if (m.type === 'pip') report({ pictureInPicture: m.value });
        else if (m.type === 'error') console.warn(m.message);
        // The next file it starts is the queued episode.
        else if (m.type === 'mpv-event' && m.name === 'start-file') {
          if (!queued) return;
          moved = true;
          advanced = { itemId: queued.itemId, sourceId: queued.source.Id! };
          emit({ type: 'advanced', episode: queued });
        } else if (m.type === 'mpv-event' && m.name === 'playback-restart')
          report({ started: true, waiting: false });
        else if (m.type === 'mpv-event' && m.name === 'file-loaded')
          emit({ type: 'loaded' });
        else if (m.type === 'mpv-ended' && m.reason === 'eof') {
          if (!queued) emit({ type: 'ended' });
        } else if (m.type === 'mpv-ended' && m.reason === 'error') {
          const other = playsWithExoPlayer() ? 'mpv' : 'exoplayer';
          const offer =
            !retried &&
            !external &&
            !LINK_FAILURES.has(m.error ?? '') &&
            appBridge()?.platform === 'android' &&
            // Automatic has tried both engines before a failure reaches the page.
            settings.android.engine.read() !== 'auto';
          emit({
            type: 'failed',
            error: failure(m.error, m.cause),
            retry: offer
              ? {
                  label:
                    other === 'mpv' ? 'Play with mpv' : 'Play with ExoPlayer',
                  run: () => {
                    retried = true;
                    shell.send({ type: 'player-retry', name: other });
                  },
                }
              : undefined,
          });
        } else if (m.type === 'external-ended' && external) {
          emit(
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
      shell.send({ type: 'mpv-sync', ...target });
      // mpv keeps pause from the last file.
      set('pause', false);
      if (next.volume) {
        set('volume', Math.round(next.volume.volume * 100));
        set('mute', next.volume.muted);
      }
      set('sub-delay', next.subtitleDelayMs / 1000);
      if (!external)
        report({ fullscreen: !!currentHost().fullscreen?.active() });
      if (!adopting) loadFile(next, 'replace');
    },
    close() {
      unsubscribe();
      unsubscribe = () => {};
      stopExoStats();
      if (statsPage) showMpvStats(null);
      if (!external) return command('stop');
      if (!moved) set('pause', true);
      linger = setTimeout(
        () => shell.send({ type: 'external-close' }),
        LINGER_MS
      );
    },
    setPaused: (paused) => set('pause', paused),
    seek: (ms) => command('seek', ms / 1000, 'absolute'),
    setVolume(volume, muted) {
      set('volume', Math.round(volume * 100));
      set('mute', muted);
    },
    setRate: (rate) => set('speed', rate),
    setAudio: (id) => set('aid', Number(id)),
    setSubtitle(id) {
      const server = file?.subtitles.find((s) => s.id === id);
      if (!server) return set('sid', id ? Number(id) : 'no');
      const loaded = tracks.find(
        (t) => t.type === 'sub' && t['external-filename'] === server.url
      );
      if (loaded) set('sid', loaded.id);
      else
        command(
          'sub-add',
          server.url,
          'select',
          server.label,
          server.lang ?? ''
        );
    },
    setSubtitleDelay: (ms) => set('sub-delay', ms / 1000),
    // The user's own player keeps its own look.
    setStyle({ subtitleStyle, fit, lift }) {
      if (external) return;
      style = subtitleStyle;
      set('keepaspect', fit !== 'stretch');
      set('panscan', fit === 'crop' ? 1 : 0);
      set('sub-ass-force-margins', fit === 'crop');
      applySubtitleStyle(subtitleStyle, imageSubtitle);
      set('sub-pos', 100 - subtitleHeight(subtitleStyle, lift));
    },
    toggleFullscreen: external
      ? () => command('cycle', 'fullscreen')
      : () => shell.send({ type: 'fullscreen' }),
    subtitleFiles: {
      types: SUBTITLE_TYPES,
      add: async (added) => {
        checkSubtitleFile(added, SUBTITLE_TYPES);
        const data = await base64(added);
        shell.send({
          type: 'subtitle-file',
          name: added.name,
          data,
          ...target,
        });
      },
    },
    get stats() {
      return playsWithExoPlayer()
        ? { pages: EXO_STATS, show: showExoStats }
        : { pages: STATS_PAGES, show: showMpvStats };
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
      ? (episode) => {
          if (queued) return;
          queued = episode;
          loadFile(episode, 'append');
        }
      : undefined,
  };
};

/** mpv's words for a link that gave it no video, which the other engine can't play either. */
const LINK_FAILURES = new Set(['loading failed', 'unrecognized file format']);

let engine: string | null = null;

export function setEngine(name: string): void {
  engine = name;
}

/** Whether the Android app plays with ExoPlayer, which has none of mpv's own options or stats. */
export const playsWithExoPlayer = () =>
  appBridge()?.platform === 'android' && engine === 'exoplayer';

function statusMeaning(status: number): string | undefined {
  if (status === 401 || status === 403) return 'refused';
  if (status === 404 || status === 410) return 'not found';
  if (status === 429) return 'too many requests';
  return status >= 500 ? 'server error' : undefined;
}

function failure(error: string | null, cause?: string): string {
  const status = Number(cause?.match(/^HTTP error (\d{3})/)?.[1]);
  if (status) {
    const meaning = statusMeaning(status);
    return `the link answered HTTP ${status}${meaning ? ` (${meaning})` : ''}`;
  }
  if (cause) {
    const text = cause.replace(/^error: /, '');
    return text.charAt(0).toLowerCase() + text.slice(1);
  }
  // What a link answering with a web page fails as.
  if (error === 'unrecognized file format')
    return 'the link returned something other than a video';
  return error ?? 'mpv could not play this version';
}

/**
 * The user's languages and subtitle mode as mpv's per-file track choices.
 * mpv matches a language across its two- and three-letter codes.
 */
function trackOptions(prefs: PlaybackPrefs, source: SourceInfo): string[] {
  const options: string[] = [];
  options.push(...listOption('alang', audioCodes(prefs, source)));
  const slang = listOption('slang', subtitleLanguages(prefs));
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

/** Commas separate the options themselves, so each further entry is appended. */
function listOption(name: string, values: string[]): string[] {
  return values.map((v, i) => `${name}${i ? '-append' : ''}=${v}`);
}

function setProp(name: string, value: unknown) {
  appBridge()?.send({ type: 'mpv-set-prop', name, value });
}

/** Image subtitles keep their own size. */
function applySubtitleStyle(
  style: SubtitleStyle | undefined,
  image: boolean
): void {
  if (!style) return;
  setProp('sub-scale', image ? 1 : subtitleScale(style));
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

export function applyPlayerSettings(): void {
  const { hardwareDecoding, audioChannels, audioDevice } = settings.desktop;
  const android = appBridge()?.platform === 'android';
  const channels = audioChannels.read();
  // On Android, auto-safe only tries copying every frame back from MediaCodec.
  // TVs copy them: some draw direct frames wrong, and they have no battery to save.
  const hwdec = !android
    ? 'auto-safe'
    : currentHost().tv
      ? 'mediacodec-copy'
      : 'mediacodec,mediacodec-copy';
  setProp('hwdec', hardwareDecoding.read() ? hwdec : 'no');
  setProp('audio-channels', channels === 'auto' ? 'auto-safe' : channels);
  setProp('audio-spdif', passthroughValue());
  setProp('audio-delay', settings.sound.delayMs.read() / 1000);
  if (!android) setProp('audio-device', audioDevice.read());
}
