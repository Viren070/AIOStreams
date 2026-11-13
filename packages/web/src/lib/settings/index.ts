import { storage } from '@/lib/storage';
import { CACHE_CATEGORIES } from '@/lib/cache/store';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { readQuickFilters, type QuickFilter } from '@/lib/versions';
import { readBadgeSettings, type BadgeSettings } from '@/lib/badges';
import {
  type Setting,
  device,
  deviceLists,
  group,
  record,
  synced,
  syncedChoice,
  syncedColor,
  syncedFlag,
  syncedList,
  syncedNumber,
  syncedText,
} from './store';

export {
  onSettingsChange,
  signedIn,
  syncPreferences,
  useSetting,
  type Setting,
} from './store';

/** A source the home page features from: `resume`, `next-up` or `view:<library id>`. */
export type FeaturedSource = string;

/** An empty list features nothing. */
export type Featured = 'auto' | FeaturedSource[];

export const MAX_FEATURED = 4;

export type PosterSize = 'small' | 'medium' | 'large';

export type PosterLine = 'title' | 'year';

export const EPISODE_LAYOUTS = ['auto', 'row', 'list'] as const;
export type EpisodeLayout = (typeof EPISODE_LAYOUTS)[number];

export const HERO_MODES = ['rotate', 'follow', 'corner'] as const;
export type HeroMode = (typeof HERO_MODES)[number];
export const HERO_SECONDS = [5, 7, 9, 12, 15, 20, 30] as const;

export const CARD_PREVIEWS = ['open', 'pop', 'off'] as const;
export type CardPreview = (typeof CARD_PREVIEWS)[number];

export const TRAILER_SPOTS = ['cards', 'hero', 'item'] as const;
export type TrailerSpot = (typeof TRAILER_SPOTS)[number];

export const TOUCH_NAVIGATIONS = ['rail', 'bar', 'top'] as const;
export type TouchNavigation = (typeof TOUCH_NAVIGATIONS)[number];

export const TIME_FORMATS = ['auto', '12', '24'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export const START_PAGES = [
  'home',
  'discover',
  'live',
  'favourites',
  'calendar',
  'activity',
  'downloads',
] as const;
export type StartPage = (typeof START_PAGES)[number];

export const TV_NAVIGATIONS = ['rail', 'top'] as const;
export type TvNavigation = (typeof TV_NAVIGATIONS)[number];

export const DESKTOP_NAVIGATIONS = ['sidebar', 'top'] as const;
export type DesktopNavigation = (typeof DESKTOP_NAVIGATIONS)[number];

export const RAIL_SHAPES = ['docked', 'floating', 'corner'] as const;
export type RailShape = (typeof RAIL_SHAPES)[number];

export const RAIL_NAMES = ['auto', 'always', 'never'] as const;
export type RailNames = (typeof RAIL_NAMES)[number];

export const TOP_BARS = ['pill', 'bar', 'fade'] as const;
export type TopBar = (typeof TOP_BARS)[number];

export const TAB_NAMES = ['shown', 'hidden'] as const;
export type TabNames = (typeof TAB_NAMES)[number];

export const GLASS_SURFACES = ['solid', 'frosted', 'liquid'] as const;
export type GlassSurface = (typeof GLASS_SURFACES)[number];

const POSTER_LINES: PosterLine[] = ['title', 'year'];

/** Every setting's value by its path in `settings`, this device's and the user's, for a report. */
export function settingsSnapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (node: object, path: string) => {
    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') continue;
      if ('read' in value && typeof value.read === 'function')
        out[path + key] = (value as Setting<unknown>).read();
      else walk(value, `${path}${key}.`);
    }
  };
  walk(settings, '');
  return out;
}

export const MAX_CUSTOM_CSS = 20_000;

export const CUSTOM_CSS_OFF = new URLSearchParams(window.location.search).has(
  'safe'
);

export interface ThemeColors {
  accent?: string;
  background?: string;
}

export const VIDEO_FITS = ['fit', 'crop', 'stretch'] as const;
export type VideoFit = (typeof VIDEO_FITS)[number];

export const SEEK_STEPS = [5, 10, 15, 30] as const;

/** Percentages. */
export const VOLUME_STEPS = [1, 2, 5, 10] as const;

export const HOLD_RATES = [1.5, 2, 3] as const;

/* eslint-disable lingui/no-unlocalized-strings -- Jellyfin's segment kinds */
export const SEGMENT_TYPES = [
  'Intro',
  'Recap',
  'Outro',
  'Preview',
  'Commercial',
] as const;
/* eslint-enable lingui/no-unlocalized-strings */
export type SegmentType = (typeof SEGMENT_TYPES)[number];
export const SEGMENT_ACTIONS = ['ask', 'skip', 'none'] as const;
export type SegmentAction = (typeof SEGMENT_ACTIONS)[number];

export const SUBTITLE_SIZES = ['small', 'normal', 'large', 'huge'] as const;
export type SubtitleSize = (typeof SUBTITLE_SIZES)[number];
/** `default` keeps the player's own font. */
export const SUBTITLE_FONTS = [
  'default',
  'sans-serif',
  'serif',
  'monospace',
  'serif-monospace',
  'casual',
  'cursive',
] as const;
export type SubtitleFont = (typeof SUBTITLE_FONTS)[number];
export const SUBTITLE_OUTLINES = ['none', 'thin', 'normal', 'thick'] as const;
export type SubtitleOutline = (typeof SUBTITLE_OUTLINES)[number];
/** Where mpv's usual line, 3% up, meets the bottom edge. */
export const SUBTITLE_POSITION_MIN = -3;
export const SUBTITLE_POSITION_MAX = 30;

export interface SubtitleStyle {
  size: SubtitleSize;
  font: SubtitleFont;
  bold: boolean;
  textColor: string;
  outline: SubtitleOutline;
  outlineColor: string;
  /** Drawn in the outline's colour. */
  shadow: boolean;
  backgroundColor: string;
  /** 0 to 100; 0 draws no background. */
  backgroundOpacity: number;
  overrideStyled: boolean;
  /** Percent of the height to raise subtitles by. */
  position: number;
}

const isPercent = (value: number) => value >= 0 && value <= 100;

export const AUDIO_CHANNELS = ['auto', 'stereo', '5.1', '7.1'] as const;
export type AudioChannels = (typeof AUDIO_CHANNELS)[number];

/** What plays versions inside the Android app. */
/** `auto` is the browser's own player in a browser. */
export const PLAYER_ENGINES = [
  'auto',
  'mpv',
  'exoplayer',
  'webgpu',
  'browser',
] as const;
export type PlayerEngine = (typeof PLAYER_ENGINES)[number];
/** A browser's picture-in-picture: a window with the player in it, or its own of the video alone. */
export const PIP_WINDOWS = ['player', 'video'] as const;
export type PipWindow = (typeof PIP_WINDOWS)[number];
/** What Back does in the player: stop, or play on in the mini player. */
export const PLAYER_BACKS = ['stop', 'minimise'] as const;
export type PlayerBack = (typeof PLAYER_BACKS)[number];
export const MINI_CORNERS = [
  'top-start',
  'top-end',
  'bottom-start',
  'bottom-end',
] as const;
export type MiniCorner = (typeof MINI_CORNERS)[number];
/** Megabytes, or `auto` to size it from the device's memory. */
export const PARTY_REACTIONS = ['👍', '😂', '😮', '😢', '❤️', '🔥'] as const;

export const CACHE_SIZES = ['auto', '128', '256', '512', '1000'] as const;
export type CacheSize = (typeof CACHE_SIZES)[number];

/** The most a stream may take in bits per second, which a server converts down to; 0 is the file as it is. */
export const QUALITIES = [
  0, 20_000_000, 10_000_000, 8_000_000, 4_000_000, 2_000_000, 1_000_000,
] as const;

/** `auto` asks the output what it decodes, which only the Android app can. */
export const PASSTHROUGH = ['off', 'auto', 'always'] as const;
export type Passthrough = (typeof PASSTHROUGH)[number];

/** mpv's names for the formats that can pass through. */
export const PASSTHROUGH_FORMATS = [
  'ac3',
  'eac3',
  'dts',
  'dts-hd',
  'truehd',
] as const;
export type PassthroughFormat = (typeof PASSTHROUGH_FORMATS)[number];

/** Decibels the centre channel, where films put dialogue, is raised by. */
export const DIALOGUE_BOOSTS: readonly number[] = [0, 3, 6, 9, 12];

export const AUDIO_DELAY_LIMIT_MS = 1000;
export const AUDIO_DELAY_STEP_MS = 50;

/** `installed` follows the channel this copy of the app came from. */
export const UPDATE_CHANNELS = ['installed', 'stable', 'nightly'] as const;
export type UpdateChannelSetting = (typeof UPDATE_CHANNELS)[number];

export const DISCORD_EVENTS = [
  'playing',
  'titles',
  'home',
  'discover',
  'search',
  'calendar',
  'favourites',
  'activity',
] as const;
export type DiscordEvent = (typeof DISCORD_EVENTS)[number];

export const NEXT_PROMPTS = ['credits', 'end', 'off'] as const;
export type NextPrompt = (typeof NEXT_PROMPTS)[number];
export const NEXT_LEADS = [15, 30, 45, 60, 90, 120] as const;
export const NEXT_COUNTDOWNS = [5, 10, 15, 30] as const;
/** Episodes in a row with no input before asking; 0 never asks. */
export const STILL_WATCHING_AFTER = [0, 2, 3, 4, 5, 8] as const;

export const DOWNLOADS_AT_ONCE = [1, 2, 3, 4] as const;
export const DOWNLOAD_SEARCHES = [1, 2, 3, 4, 6, 8] as const;

/** Days a saved page is shown for while online; 0 has no limit. */
export const CACHE_MAX_STALE_DAYS = [1, 3, 7, 14, 30, 0] as const;
export const CACHE_SIZES_MB = [250, 500, 1000, 2000, 5000] as const;

const parseFeatured = (raw = 'auto'): Featured =>
  raw === 'auto'
    ? 'auto'
    : raw === 'none'
      ? []
      : raw.split(',').filter(Boolean).slice(0, MAX_FEATURED);

const subtitleLook = {
  size: syncedChoice<SubtitleSize>('subtitleSize', SUBTITLE_SIZES, 'normal', [
    'aiostreams-web-subtitle-size',
  ]),
  font: syncedChoice<SubtitleFont>('subtitleFont', SUBTITLE_FONTS, 'default'),
  bold: syncedFlag('subtitleBold', false, ['aiostreams-web-subtitle-bold']),
  textColor: syncedColor('subtitleColor', '#ffffff', [
    'aiostreams-web-subtitle-text-color',
  ]),
  outline: syncedChoice<SubtitleOutline>(
    'subtitleOutline',
    SUBTITLE_OUTLINES,
    'normal',
    ['aiostreams-web-subtitle-outline']
  ),
  outlineColor: syncedColor('subtitleOutlineColor', '#000000', [
    'aiostreams-web-subtitle-outline-color',
  ]),
  shadow: syncedFlag('subtitleShadow'),
  backgroundColor: syncedColor('subtitleBackgroundColor', '#000000', [
    'aiostreams-web-subtitle-background-color',
  ]),
  backgroundOpacity: syncedNumber('subtitleBackgroundOpacity', 0, isPercent, [
    'aiostreams-web-subtitle-background-opacity',
  ]),
  overrideStyled: syncedFlag('subtitleOverrideStyled', false, [
    'aiostreams-web-subtitle-override-styled',
  ]),
  position: syncedNumber(
    'subtitlePosition',
    0,
    (v) => v >= SUBTITLE_POSITION_MIN && v <= SUBTITLE_POSITION_MAX,
    ['aiostreams-web-subtitle-position']
  ),
};

const segment = record(SEGMENT_TYPES, (type) =>
  syncedChoice<SegmentAction>(`segment${type}`, SEGMENT_ACTIONS, 'ask', [
    `aiostreams-web-segment-${type.toLowerCase()}`,
  ])
);

const onTv = () => document.documentElement.hasAttribute('data-tv');

// Off on touch screens, where nothing rests on a card.
const trailer = record(TRAILER_SPOTS, (spot) =>
  device<boolean>(
    `aiostreams-web-interface-trailers-${spot}`,
    () => onTv() || matchMedia('(hover: hover) and (pointer: fine)').matches
  )
);

const passthroughFormat = record(PASSTHROUGH_FORMATS, (format) =>
  device<boolean>(
    `aiostreams-web-audio-passthrough-${format}`,
    true,
    undefined,
    [`aiostreams-app-passthrough-${format}`]
  )
);

const discord = record(DISCORD_EVENTS, (event) =>
  device<boolean>(
    `aiostreams-web-app-discord-${event}`,
    event === 'playing',
    undefined,
    [
      event === 'playing'
        ? 'aiostreams-desktop-discord'
        : `aiostreams-desktop-discord-${event}`,
    ]
  )
);

/*
 * Grouped as the settings page lists them. How the user likes to watch
 * follows their account; what suits this device's screen, input, sound or
 * hardware stays on it.
 */
export const settings = {
  interface: {
    /** A catalog's locale, or `auto` for the system's language. */
    language: synced<string>(
      'language',
      (raw) => raw ?? 'auto',
      (value) => (value === 'auto' ? undefined : value),
      ['aiostreams-web-interface-language']
    ),
    /** `auto` follows the device. */
    timeFormat: syncedChoice<TimeFormat>('timeFormat', TIME_FORMATS, 'auto'),
    featured: synced<Featured>(
      'featured',
      parseFeatured,
      (value) =>
        value === 'auto' ? undefined : value.length ? value.join(',') : 'none',
      [
        {
          key: 'aiostreams-web-featured',
          read: (old) =>
            typeof old === 'string' ? parseFeatured(old) : undefined,
        },
      ]
    ),
    posterSize: synced<PosterSize>(
      'posterSize',
      (raw) => (raw === 'small' || raw === 'large' ? raw : 'medium'),
      (value) => (value === 'medium' ? undefined : value),
      ['aiostreams-web-poster-size']
    ),
    posterLines: synced<PosterLine[]>(
      'posterText',
      (raw = 'title,year') =>
        POSTER_LINES.filter((line) => raw.split(',').includes(line)),
      (value) => {
        const lines = POSTER_LINES.filter((line) => value.includes(line));
        if (lines.length === POSTER_LINES.length) return undefined;
        return lines.length ? lines.join(',') : 'none';
      }
    ),
    mergeNextUp: syncedFlag('mergeNextUp'),
    combineSearch: syncedFlag('combineSearch'),
    blurSpoilers: syncedFlag('blurSpoilers'),
    heroMode: syncedChoice<HeroMode>('heroMode', HERO_MODES, 'rotate'),
    heroSeconds: syncedChoice<number>('heroSeconds', HERO_SECONDS, 9),
    episodeLayout: device<EpisodeLayout>(
      'aiostreams-web-interface-episode-layout',
      'auto',
      EPISODE_LAYOUTS,
      ['aiostreams-web-episode-layout']
    ),
    cardPreview: device<CardPreview>(
      'aiostreams-web-interface-card-preview',
      'open',
      CARD_PREVIEWS,
      [
        {
          key: 'aiostreams-web-interface-card-previews',
          read: (old) => (old === false ? 'off' : undefined),
        },
      ]
    ),
    trailer,
    trailers: group(trailer),
    trailerSound: device<boolean>(
      'aiostreams-web-interface-trailer-sound',
      onTv
    ),
    startPage: device<StartPage>(
      'aiostreams-web-interface-start-page',
      'home',
      START_PAGES
    ),
    /** Where a touch screen wide enough for the sidebar keeps the navigation. */
    touchNavigation: device<TouchNavigation>(
      'aiostreams-web-interface-touch-navigation',
      'rail',
      TOUCH_NAVIGATIONS,
      ['aiostreams-web-touch-navigation']
    ),
    /** How a TV shows the navigation. */
    tvNavigation: device<TvNavigation>(
      'aiostreams-web-interface-tv-navigation',
      'rail',
      TV_NAVIGATIONS,
      ['aiostreams-web-tv-navigation']
    ),
    /** Where a mouse-driven screen wide enough for the sidebar keeps the navigation. */
    desktopNavigation: device<DesktopNavigation>(
      'aiostreams-web-interface-desktop-navigation',
      'sidebar',
      DESKTOP_NAVIGATIONS
    ),
    /**
     * How a side rail sits: in a column of its own, floating over the page, or
     * shrunk to the current page's button in the corner.
     */
    railShape: device<RailShape>(
      'aiostreams-web-interface-rail-shape',
      'docked',
      RAIL_SHAPES,
      ['aiostreams-web-rail-shape']
    ),
    /** `auto` names pages under each icon on a touch screen, and on a TV while the rail has focus. */
    railNames: device<RailNames>(
      'aiostreams-web-interface-rail-names',
      'auto',
      RAIL_NAMES,
      ['aiostreams-web-rail-names']
    ),
    /** How the top tabs sit over the page. */
    topBar: device<TopBar>(
      'aiostreams-web-interface-top-bar',
      'pill',
      TOP_BARS,
      ['aiostreams-web-interface-tv-top-bar', 'aiostreams-web-tv-top-bar']
    ),
    tabNames: device<TabNames>(
      'aiostreams-web-interface-tab-names',
      'shown',
      TAB_NAMES
    ),
  },
  theme: {
    /** Unset colours keep the stylesheet's own. */
    colors: group({
      accent: syncedText('accentColor'),
      background: syncedText('backgroundColor'),
    }) as Setting<ThemeColors>,
    customCss: synced<string>(
      'customCss',
      (raw) => raw ?? '',
      (value) => (value.trim() ? value.slice(0, MAX_CUSTOM_CSS) : undefined)
    ),
    serverCss: syncedFlag('serverCss', true),
    /** What the navigation bars and glass panels sit on. */
    glassSurface: device<GlassSurface>(
      'aiostreams-web-theme-glass-surface',
      'frosted',
      GLASS_SURFACES,
      [
        'aiostreams-web-interface-bar-background',
        'aiostreams-web-bar-background',
      ]
    ),
    artBackground: syncedFlag('artBackground'),
    artGlass: device<boolean>('aiostreams-web-theme-art-glass', false),
  },
  playback: {
    autoPlayFirst: syncedFlag('autoPlayFirst', false, [
      'aiostreams-web-skip-versions',
    ]),
    preloadVersions: syncedFlag('preloadVersions'),
    chapterSkips: syncedFlag('chapterSkips', true, [
      'aiostreams-desktop-chapter-skips',
    ]),
    segment,
    segmentActions: group(segment),
    quickFilters: synced<QuickFilter[]>(
      'versionFilters',
      readQuickFilters,
      (value) => (value.length ? JSON.stringify(value) : undefined)
    ),
    badges: synced<BadgeSettings>(
      'versionBadges',
      readBadgeSettings,
      (value) =>
        value.links.length || value.badges.length
          ? JSON.stringify(value)
          : undefined
    ),
  },
  next: {
    prompt: syncedChoice<NextPrompt>('nextPrompt', NEXT_PROMPTS, 'credits', [
      'aiostreams-web-next-prompt',
    ]),
    /** Seconds before the end the prompt shows when there are no credits to go by. */
    lead: syncedChoice<number>('nextLead', NEXT_LEADS, 30, [
      'aiostreams-web-next-lead',
    ]),
    countdown: syncedChoice<number>('nextCountdown', NEXT_COUNTDOWNS, 15, [
      'aiostreams-web-next-countdown',
    ]),
    fallbackFirst: syncedFlag('nextFallbackFirst', true, [
      'aiostreams-web-next-fallback-first',
    ]),
    stillWatching: syncedChoice<number>(
      'stillWatching',
      STILL_WATCHING_AFTER,
      3,
      ['aiostreams-web-still-watching']
    ),
    skipFillers: syncedFlag('skipFillers', true, [
      'aiostreams-web-skip-fillers',
    ]),
    skipRecaps: syncedFlag('skipRecaps', true, ['aiostreams-web-skip-recaps']),
    markUnaired: syncedFlag('markUnaired', true),
  },
  party: {
    /** What other members send shows over the video. */
    messages: syncedFlag('partyMessages', true),
    reactions: syncedFlag('partyReactions', true),
    /** The ones this user sends. */
    reactionSet: syncedList('partyReactionSet', PARTY_REACTIONS),
    speedSync: syncedFlag('partySpeedSync', true),
  },
  controls: {
    seekStep: device<number>(
      'aiostreams-web-controls-seek-step',
      10,
      SEEK_STEPS,
      ['aiostreams-web-seek-step']
    ),
    volumeStep: device<number>(
      'aiostreams-web-controls-volume-step',
      5,
      VOLUME_STEPS,
      ['aiostreams-web-volume-step']
    ),
    /** The speed while a long press or a held key speeds playback up. */
    holdRate: device<number>(
      'aiostreams-web-controls-hold-rate',
      2,
      HOLD_RATES,
      ['aiostreams-web-hold-rate']
    ),
    /** Keys changed from the defaults, by action. */
    shortcuts: deviceLists('aiostreams-web-controls-shortcuts', [
      'aiostreams-web-shortcuts',
    ]),
    thumbnails: device<boolean>('aiostreams-web-controls-thumbnails', true),
    timeLeft: device<boolean>('aiostreams-web-controls-time-left', false),
    clock: device<boolean>('aiostreams-web-controls-clock', true),
    showOnPauseAndSkip: device<boolean>(
      'aiostreams-web-controls-show-on-pause-and-skip',
      true
    ),
  },
  player: {
    /** `app`, a player's id, or `custom` for `link`. */
    choice: device<string>('aiostreams-web-player-choice', 'app', undefined, [
      'aiostreams-web-player',
    ]),
    link: device<string>('aiostreams-web-player-link', ''),
    engine: device<PlayerEngine>(
      'aiostreams-web-player-engine',
      'auto',
      PLAYER_ENGINES,
      ['aiostreams-android-engine']
    ),
    cacheSize: device<CacheSize>(
      'aiostreams-web-player-cache-size',
      'auto',
      CACHE_SIZES
    ),
    quality: device<number>('aiostreams-web-player-quality', 0, QUALITIES),
    back: device<PlayerBack>(
      'aiostreams-web-player-back',
      'stop',
      PLAYER_BACKS
    ),
    pictureInPicture: device<PipWindow>(
      'aiostreams-web-player-picture-in-picture',
      'player',
      PIP_WINDOWS
    ),
    /** Where the mini player was left. */
    miniCorner: device<MiniCorner>(
      'aiostreams-web-mini-corner',
      'bottom-end',
      MINI_CORNERS
    ),
  },
  video: {
    fit: device<VideoFit>('aiostreams-web-video-fit', 'fit', VIDEO_FITS),
    hardwareDecoding: device<boolean>(
      'aiostreams-web-video-hardware-decoding',
      true,
      undefined,
      ['aiostreams-desktop-hwdec']
    ),
    dolbyVision: device<boolean>(
      'aiostreams-web-video-dolby-vision',
      true,
      undefined,
      ['aiostreams-desktop-dolby-vision']
    ),
    frameRate: device<boolean>(
      'aiostreams-web-video-frame-rate',
      false,
      undefined,
      ['aiostreams-android-frame-rate']
    ),
    tunneling: device<boolean>(
      'aiostreams-web-video-tunneling',
      false,
      undefined,
      ['aiostreams-android-tunneling']
    ),
    upscaling: device<boolean>('aiostreams-web-video-upscaling', false),
    hdrOutput: device<boolean>('aiostreams-web-video-hdr-output', false),
  },
  audio: {
    channels: device<AudioChannels>(
      'aiostreams-web-audio-channels',
      'auto',
      AUDIO_CHANNELS,
      ['aiostreams-desktop-audio-channels']
    ),
    /** mpv's name for the output, or `auto` for the system's default. */
    device: device<string>('aiostreams-web-audio-device', 'auto', undefined, [
      'aiostreams-desktop-audio-device',
    ]),
    passthrough: device<Passthrough>(
      'aiostreams-web-audio-passthrough',
      appBridge()?.platform === 'android' ? 'auto' : 'off',
      PASSTHROUGH,
      [
        'aiostreams-android-passthrough',
        {
          key: 'aiostreams-desktop-passthrough',
          read: (on) =>
            on === true ? 'always' : on === false ? 'off' : undefined,
        },
      ]
    ),
    passthroughFormat,
    passthroughFormats: group(passthroughFormat),
    dialogueBoost: device<number>(
      'aiostreams-web-audio-dialogue-boost',
      0,
      DIALOGUE_BOOSTS,
      ['aiostreams-app-dialogue-boost']
    ),
    nightMode: device<boolean>(
      'aiostreams-web-audio-night-mode',
      false,
      undefined,
      ['aiostreams-app-night-mode']
    ),
    /** Positive plays the sound later than the picture. */
    delayMs: device<number>(
      'aiostreams-web-audio-delay',
      0,
      (v) => Math.abs(v) <= AUDIO_DELAY_LIMIT_MS,
      ['aiostreams-app-audio-delay']
    ),
    ac3Encode: device<boolean>(
      'aiostreams-web-audio-ac3-encode',
      false,
      undefined,
      ['aiostreams-app-ac3-encode']
    ),
  },
  subtitle: {
    ...subtitleLook,
    style: group(subtitleLook) as Setting<SubtitleStyle>,
  },
  account: {
    /** Opens on who's watching rather than straight in as the last user. */
    askWho: device<boolean>(
      'aiostreams-web-account-ask-who',
      false,
      undefined,
      ['aiostreams-web-ask-who']
    ),
  },
  app: {
    updateChannel: device<UpdateChannelSetting>(
      'aiostreams-web-app-update-channel',
      'installed',
      UPDATE_CHANNELS,
      ['aiostreams-desktop-update-channel']
    ),
    pip: device<boolean>('aiostreams-web-app-pip', true, undefined, [
      'aiostreams-android-pip',
    ]),
    background: device<boolean>(
      'aiostreams-web-app-background',
      false,
      undefined,
      ['aiostreams-android-background']
    ),
    discord,
    discordEvents: group(discord),
    usageStats: device<boolean>('aiostreams-web-app-usage-stats', true),
    usageStatsNoticed: device<boolean>(
      'aiostreams-web-app-usage-stats-noticed',
      false
    ),
  },
  cache: {
    enabled: device<boolean>('aiostreams-web-cache', true),
    maxStaleDays: device<number>(
      'aiostreams-web-cache-max-stale',
      7,
      CACHE_MAX_STALE_DAYS
    ),
    maxSizeMb: device<number>('aiostreams-web-cache-size', 500, CACHE_SIZES_MB),
    categories: record(CACHE_CATEGORIES, (category) =>
      device<boolean>(`aiostreams-web-cache-${category}`, true)
    ),
  },
  downloads: {
    concurrent: device<number>(
      'aiostreams-web-downloads-at-once',
      2,
      DOWNLOADS_AT_ONCE
    ),
    searches: device<number>(
      'aiostreams-web-downloads-searches',
      3,
      DOWNLOAD_SEARCHES,
      ['aiostreams-web-download-searches']
    ),
    subtitles: device<boolean>(
      'aiostreams-web-downloads-subtitles',
      true,
      undefined,
      ['aiostreams-web-download-subtitles']
    ),
    wifiOnly: device<boolean>(
      'aiostreams-web-downloads-wifi-only',
      true,
      undefined,
      ['aiostreams-web-download-wifi-only']
    ),
  },
};

const CATALOG_KEY = 'aiostreams-web-catalog';

type Catalogs = { last?: string } & Record<string, string | undefined>;

/**
 * The catalog Discover returns to, overall and per type, so switching type and
 * back lands where it was rather than on whichever catalog comes first.
 */
export function rememberCatalog(viewId: string, kind?: string): void {
  const stored = storage.get<Catalogs>(CATALOG_KEY) ?? {};
  storage.set(CATALOG_KEY, {
    ...stored,
    last: viewId,
    ...(kind ? { [kind]: viewId } : {}),
  });
}

export function lastCatalog(kind?: string): string | null {
  const stored = storage.get<Catalogs>(CATALOG_KEY);
  return (kind ? stored?.[kind] : stored?.last) ?? null;
}
