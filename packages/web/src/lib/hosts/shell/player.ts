import React from 'react';
import { storage } from '../../storage';
import { subtitleUrl, textSubtitles } from '../../subtitles/tracks';
import { fullTitle } from '../../format';
import { base64, checkSubtitleFile } from '../../subtitles/files';
import { sameLanguage } from '../../languages';
import { parseChapters, type Chapter } from '../../playback/chapters';
import { settings, useSetting, type SubtitleStyle } from '../../settings';
import {
  audioLanguages,
  ORIGINAL_LANGUAGE,
  subtitleLanguages,
  type PlaybackPrefs,
} from '../../user-config';
import type { SourceInfo } from '../../types';
import {
  clampDelay,
  savedSubtitleDelay,
  saveSubtitleDelay,
} from '../../subtitles/delay';
import { parseSubtitleLines } from '../../subtitles/cues';
import {
  MPV_OUTLINE,
  mpvColor,
  subtitleHeight,
  subtitleScale,
} from '../../subtitles/style';
import {
  initialState,
  ownTrackLabel,
  storedVolume,
  trackLabel,
  VOLUME_KEY,
  type NativePlayerOptions,
  type PlayerController,
  type PlayerState,
  type QueuedEpisode,
  type Track,
} from '../../playback/controller';
import { usePlayheadWriter } from '../../playback/playhead';
import { useLatest } from '../../use-latest';
import { currentHost } from '..';
import { appBridge } from './bridge';

interface MpvTrack {
  id: number;
  type: 'video' | 'audio' | 'sub';
  title?: string;
  lang?: string;
  external?: boolean;
  'external-filename'?: string;
  selected?: boolean;
  codec?: string;
}

const IMAGE_SUBTITLE_CODECS = new Set([
  'hdmv_pgs_subtitle',
  'dvd_subtitle',
  'dvb_subtitle',
]);

const EXTERNAL = 'ext:';

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
  }
  const buffered = num('bufferedMs');
  if (buffered !== undefined)
    lines.push(`Buffered   ${(buffered / 1000).toFixed(1)} s`);
  const shown = num('renderedFrames');
  if (shown !== undefined)
    lines.push(
      `Frames     ${shown} shown · ${num('droppedFrames') ?? 0} dropped`
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

/**
 * The AIOStreams desktop app's mpv, drawn beneath the page, or with
 * `launched`, the user's own player in its own window. Its tracks are the
 * file's own, plus the server's external subtitles, which mpv downloads only
 * when picked: a version can carry dozens.
 */
export function useShellPlayer(opts: NativePlayerOptions): PlayerController {
  const { item, source, startMs, url, launched } = opts;
  const external = !!launched;
  // The app can be full screen already, from before this player mounted.
  const [state, setState] = React.useState(() => ({
    ...initialState(source),
    fullscreen: !external && !!currentHost().fullscreen?.active(),
  }));
  const playhead = usePlayheadWriter(startMs);
  const [tracks, setTracks] = React.useState<MpvTrack[]>([]);
  const [chapters, setChapters] = React.useState<Chapter[]>([]);
  // Offered once per file.
  const [retryable, setRetryable] = React.useState(false);
  const retried = React.useRef(false);
  const latest = useLatest({ ...opts, state });
  const queued = React.useRef<QueuedEpisode | null>(null);
  const externals = React.useMemo(
    () =>
      textSubtitles(source)
        .filter((s) => s.IsExternal)
        .flatMap((s, i) => {
          const link = opts.subtitleUrl
            ? opts.subtitleUrl(s)
            : subtitleUrl(opts.client, s);
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
    [source, opts.client, opts.subtitleUrl]
  );
  const fromServer = (track: MpvTrack) =>
    externals.some((e) => e.url === track['external-filename']);
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
  const shell = appBridge()!;
  const target = external ? { external: true } : {};
  const set = (name: string, value: unknown) =>
    shell.send({ type: 'mpv-set-prop', name, value, ...target });
  const command = (...args: unknown[]) =>
    shell.send({ type: 'mpv-command', args, ...target });

  const [statsPage, setStatsPage] = React.useState<string | null>(null);
  const exo = playsWithExoPlayer();
  const [exoStats, setExoStats] = React.useState<string>();
  React.useEffect(() => {
    if (!exo || !statsPage) return setExoStats(undefined);
    let last: { cpuMs: number; atMs: number } | undefined;
    const stop = shell.subscribe((m) => {
      if (m.type !== 'player-stats') return;
      const cpu =
        last && m.atMs > last.atMs
          ? ((m.cpuMs - last.cpuMs) / (m.atMs - last.atMs)) * 100
          : undefined;
      last = m;
      setExoStats(exoStatsText(m.stats, cpu));
    });
    const ask = () => shell.send({ type: 'player-stats' });
    ask();
    const timer = setInterval(ask, STATS_MS);
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [exo, statsPage, shell]);
  const shownStats = useLatest(statsPage);
  const showStats = (page: string | null) => {
    if (shownStats.current)
      command('script-binding', 'stats/display-stats-toggle');
    if (page) command('script-binding', `stats/display-page-${page}-toggle`);
    setStatsPage(page);
  };
  React.useEffect(
    () => () => {
      if (shownStats.current)
        command('script-binding', 'stats/display-stats-toggle');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // The user's own player keeps its own look.
  const [fit] = useSetting(settings.videoFit);
  React.useEffect(() => {
    if (external) return;
    set('keepaspect', fit !== 'stretch');
    set('panscan', fit === 'crop' ? 1 : 0);
    set('sub-ass-force-margins', fit === 'crop');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  const imageSubtitle = React.useRef(false);
  const [lift, setLift] = React.useState(0);
  const { subtitleStyle } = opts;
  React.useEffect(() => {
    if (!external) applySubtitleStyle(subtitleStyle, imageSubtitle.current);
  }, [subtitleStyle, external]);
  React.useEffect(() => {
    if (!external)
      setProp('sub-pos', 100 - subtitleHeight(subtitleStyle, lift));
  }, [subtitleStyle, lift, external]);

  React.useEffect(() => {
    // mpv refuses anything above its volume-max.
    const { volume, muted } = storedVolume(Infinity);
    let cache = false;
    let seeking = false;
    let moved = false;
    // Set while the launched player may already play this version, until it says whether it is idle.
    let adopting =
      external &&
      advanced?.itemId === item.Id &&
      advanced?.sourceId === source.Id;
    let preferOnTracks = false;
    advanced = null;
    retried.current = false;
    setRetryable(false);

    let fileTracks: MpvTrack[] = [];
    let sid: string | null = null;
    const syncSubtitleScale = () => {
      const track = fileTracks.find(
        (t) => t.type === 'sub' && String(t.id) === sid
      );
      const image = IMAGE_SUBTITLE_CODECS.has(track?.codec ?? '');
      const style = latest.current.subtitleStyle;
      if (external || image === imageSubtitle.current || !style) return;
      imageSubtitle.current = image;
      set('sub-scale', image ? 1 : subtitleScale(style));
    };
    // An external subtitle when the mode wants one and the file has none of its
    // own in that language or an earlier one; Default only honours the file's.
    const addPreferredSubtitle = () => {
      const prefs = latest.current.prefs ?? {};
      const mode = prefs.SubtitleMode;
      if (mode !== 'Always' && mode !== 'Smart') return;
      const languages = subtitleLanguages(prefs);
      const playing = fileTracks.find((t) => t.type === 'audio' && t.selected);
      if (
        mode === 'Smart' &&
        languages.some((l) => sameLanguage(l, playing?.lang))
      )
        return;
      for (const lang of languages) {
        const own = fileTracks.some(
          (t) => t.type === 'sub' && !t.external && sameLanguage(lang, t.lang)
        );
        if (own) return;
        const external = externals.find((e) => sameLanguage(lang, e.lang));
        if (!external) continue;
        command(
          'sub-add',
          external.url,
          'select',
          external.label,
          external.lang
        );
        return;
      }
    };
    const load = () => {
      const options = [
        ...(startMs ? [`start=${(startMs / 1000).toFixed(3)}`] : []),
        ...trackOptions(latest.current.prefs ?? {}, source),
      ];
      command('loadfile', url, 'replace', -1, options.join(','));
    };
    const onProp = (name: string, data: unknown) => {
      const num = typeof data === 'number' ? data : null;
      switch (name) {
        case 'time-pos':
          if (num !== null) playhead.set({ positionMs: num * 1000 });
          break;
        case 'duration':
          if (num !== null) patch({ durationMs: num * 1000 });
          break;
        case 'demuxer-cache-time':
          if (num !== null) playhead.set({ bufferedMs: num * 1000 });
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
        case 'idle-active':
          if (!adopting) break;
          adopting = false;
          if (data === true) load();
          else {
            patch({ started: true, waiting: false });
            command('playlist-clear');
            preferOnTracks = true;
          }
          break;
        case 'volume':
          if (num !== null) patch({ volume: num / 100 });
          break;
        case 'volume-max':
          if (num !== null) patch({ maxVolume: num / 100 });
          break;
        case 'mute':
          patch({ muted: data === true });
          break;
        case 'speed':
          if (num !== null) patch({ rate: num });
          break;
        case 'fullscreen':
          if (external) patch({ fullscreen: data === true });
          break;
        case 'aid':
        case 'sid': {
          const id =
            typeof data === 'string' && /^\d+$/.test(data) ? data : null;
          patch(name === 'aid' ? { audio: id } : { subtitle: id });
          if (name === 'sid') {
            sid = id;
            syncSubtitleScale();
          }
          break;
        }
        case 'track-list':
          fileTracks = Array.isArray(data) ? (data as MpvTrack[]) : [];
          setTracks(fileTracks);
          syncSubtitleScale();
          if (preferOnTracks) {
            preferOnTracks = false;
            addPreferredSubtitle();
          }
          break;
        case 'chapter-list':
          setChapters(parseChapters(data));
          break;
      }
    };

    const unsubscribe = shell.subscribe((m) => {
      const fromMpv =
        m.type === 'mpv-prop' ||
        m.type === 'mpv-event' ||
        m.type === 'mpv-ended';
      const toLaunched = 'external' in m && m.external === true;
      if (fromMpv && (moved || toLaunched !== external)) return;
      if (m.type === 'mpv-prop') onProp(m.name, m.data);
      else if (m.type === 'fullscreen' && !external)
        patch({ fullscreen: m.value });
      else if (m.type === 'pip') patch({ pictureInPicture: m.value });
      else if (m.type === 'error') console.warn(m.message);
      // The next file it starts is the queued episode.
      else if (m.type === 'mpv-event' && m.name === 'start-file') {
        const next = queued.current;
        if (!next) return;
        moved = true;
        advanced = { itemId: next.itemId, sourceId: next.source.Id! };
        latest.current.onAdvance?.(next);
      } else if (m.type === 'mpv-event' && m.name === 'playback-restart')
        patch({ started: true, waiting: false });
      else if (m.type === 'mpv-event' && m.name === 'file-loaded')
        addPreferredSubtitle();
      else if (m.type === 'mpv-ended' && m.reason === 'eof') {
        if (!queued.current) latest.current.onEnded();
      } else if (m.type === 'mpv-ended' && m.reason === 'error') {
        setRetryable(!retried.current && !LINK_FAILURES.has(m.error ?? ''));
        patch({ error: failure(m.error, m.cause) });
      } else if (m.type === 'external-ended' && external) {
        if (m.error) patch({ error: m.error });
        else latest.current.onClosed?.();
      }
    });
    if (launched) {
      clearTimeout(linger);
      shell.send({
        type: 'external-open',
        player: launched.id,
        title: fullTitle(item),
      });
    }
    shell.send({ type: 'mpv-sync', ...target });
    // mpv keeps pause from the last file.
    set('pause', false);
    if (!external) {
      set('volume', Math.round(volume * 100));
      set('mute', muted);
    }
    const delay = savedSubtitleDelay(source.Id);
    set('sub-delay', delay / 1000);
    patch({ subtitleDelayMs: delay });
    if (!adopting) load();
    return () => {
      unsubscribe();
      if (!external) return command('stop');
      if (!moved) set('pause', true);
      linger = setTimeout(
        () => shell.send({ type: 'external-close' }),
        LINGER_MS
      );
    };
    // Reloading restarts playback, so only a new url or start does it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, startMs]);

  const setVolume = (volume: number, muted = volume === 0) => {
    set('volume', Math.round(volume * 100));
    set('mute', muted);
    if (!external) storage.set(VOLUME_KEY, { volume, muted });
    patch({ volume, muted });
  };

  const toTrack = (t: MpvTrack): Track => ({
    id: String(t.id),
    label: ownTrackLabel(t.title, t.lang, t.id),
    lang: t.lang,
  });
  return {
    state: { ...state, subtitle: subtitleId(state.subtitle) },
    playhead,
    audioTracks: tracks.filter((t) => t.type === 'audio').map(toTrack),
    subtitleTracks: [
      ...tracks.filter((t) => t.type === 'sub' && !fromServer(t)).map(toTrack),
      ...externals.map(({ id, label, lang }) => ({ id, label, lang })),
    ],
    togglePlay: () => set('pause', !latest.current.state.paused),
    seek: (ms) => {
      command('seek', ms / 1000, 'absolute');
      playhead.set({ positionMs: ms });
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
    liftSubtitles: setLift,
    // Only external subtitles can be read; mpv keeps embedded ones to itself.
    canReadSubtitle: (id) => externals.some((e) => e.id === id),
    subtitleLines: async () => {
      const shown = subtitleId(latest.current.state.subtitle);
      const external = externals.find((e) => e.id === shown);
      if (!external) return null;
      const res = await fetch(external.url);
      return res.ok ? parseSubtitleLines(await res.text()) : null;
    },
    subtitleFiles: {
      types: SUBTITLE_TYPES,
      add: async (file) => {
        checkSubtitleFile(file, SUBTITLE_TYPES);
        const data = await base64(file);
        shell.send({ type: 'subtitle-file', name: file.name, data, ...target });
      },
    },
    toggleFullscreen: external
      ? () => command('cycle', 'fullscreen')
      : () => shell.send({ type: 'fullscreen' }),
    chapters,
    stats: exo
      ? {
          pages: EXO_STATS,
          page: statsPage,
          show: setStatsPage,
          text: exoStats,
        }
      : { pages: STATS_PAGES, page: statsPage, show: showStats },
    external: launched?.name,
    close: external
      ? () => {
          clearTimeout(linger);
          shell.send({ type: 'external-close' });
        }
      : undefined,
    queueNext: external
      ? (episode) => {
          if (queued.current) return;
          queued.current = episode;
          const options = [
            ...(episode.startMs
              ? [`start=${(episode.startMs / 1000).toFixed(3)}`]
              : []),
            ...trackOptions(latest.current.prefs ?? {}, episode.source),
          ];
          command('loadfile', episode.url, 'append', -1, options.join(','));
        }
      : undefined,
    retry:
      retryable &&
      !external &&
      appBridge()?.platform === 'android' &&
      // Automatic has tried both engines before a failure reaches the page.
      settings.android.engine.read() !== 'auto'
        ? {
            label: playsWithExoPlayer()
              ? 'Play with mpv'
              : 'Play with ExoPlayer',
            run: () => {
              retried.current = true;
              setRetryable(false);
              patch({ error: null, started: false, waiting: true });
              shell.send({
                type: 'player-retry',
                name: playsWithExoPlayer() ? 'mpv' : 'exoplayer',
              });
            },
          }
        : undefined,
  };
}

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
 * mpv matches a language across its two- and three-letter codes. Original
 * language takes the language of the server's default audio track, as only
 * the server knows it; other servers may not pick that track from the
 * user's settings, so a named language goes to mpv as it is.
 */
function trackOptions(prefs: PlaybackPrefs, source: SourceInfo): string[] {
  const options: string[] = [];
  const original = source.MediaStreams?.find(
    (s) => s.Type === 'Audio' && s.Index === source.DefaultAudioStreamIndex
  )?.Language;
  const alang = audioLanguages(prefs)
    .map((l) => (l === ORIGINAL_LANGUAGE ? original : l))
    .filter(Boolean);
  if (alang.length) options.push(`alang=${alang.join(',')}`);
  const subtitles = subtitleLanguages(prefs);
  const slang = subtitles.length ? [`slang=${subtitles.join(',')}`] : [];
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

export function applyDesktopSettings(): void {
  const { hardwareDecoding, audioChannels, passthrough } = settings.desktop;
  const channels = audioChannels.read();
  // On Android, auto-safe only tries copying every frame back from MediaCodec.
  // TVs copy them: some draw direct frames wrong, and they have no battery to save.
  const hwdec =
    appBridge()?.platform !== 'android'
      ? 'auto-safe'
      : currentHost().tv
        ? 'mediacodec-copy'
        : 'mediacodec,mediacodec-copy';
  setProp('hwdec', hardwareDecoding.read() ? hwdec : 'no');
  setProp('audio-channels', channels === 'auto' ? 'auto-safe' : channels);
  setProp('audio-spdif', passthrough.read() ? 'ac3,eac3,dts-hd,truehd' : '');
}
