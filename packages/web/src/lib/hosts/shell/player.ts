import React from 'react';
import { storage } from '../../storage';
import { subtitleUrl, textSubtitles } from '../../subtitles/tracks';
import { fullTitle } from '../../format';
import { base64, checkSubtitleFile } from '../../subtitles/files';
import { sameLanguage } from '../../languages';
import { parseChapters, type Chapter } from '../../playback/chapters';
import { settings, useSetting, type SubtitleStyle } from '../../settings';
import { ORIGINAL_LANGUAGE, type PlaybackPrefs } from '../../user-config';
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
    ...initialState(source, startMs),
    fullscreen: !external && !!currentHost().fullscreen?.active(),
  }));
  const [tracks, setTracks] = React.useState<MpvTrack[]>([]);
  const [chapters, setChapters] = React.useState<Chapter[]>([]);
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
      } else if (m.type === 'mpv-ended' && m.reason === 'error')
        patch({ error: failure(m.error, m.cause) });
      else if (m.type === 'external-ended' && external) {
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
    audioTracks: tracks.filter((t) => t.type === 'audio').map(toTrack),
    subtitleTracks: [
      ...tracks.filter((t) => t.type === 'sub' && !fromServer(t)).map(toTrack),
      ...externals.map(({ id, label, lang }) => ({ id, label, lang })),
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
    stats: playsWithExoPlayer()
      ? undefined
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
  };
}

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
  const audio =
    prefs.AudioLanguagePreference === ORIGINAL_LANGUAGE
      ? source.MediaStreams?.find(
          (s) =>
            s.Type === 'Audio' && s.Index === source.DefaultAudioStreamIndex
        )?.Language
      : prefs.AudioLanguagePreference;
  if (audio) options.push(`alang=${audio}`);
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
  const hwdec =
    appBridge()?.platform === 'android'
      ? 'mediacodec,mediacodec-copy'
      : 'auto-safe';
  setProp('hwdec', hardwareDecoding.read() ? hwdec : 'no');
  setProp('audio-channels', channels === 'auto' ? 'auto-safe' : channels);
  setProp('audio-spdif', passthrough.read() ? 'ac3,eac3,dts-hd,truehd' : '');
}
