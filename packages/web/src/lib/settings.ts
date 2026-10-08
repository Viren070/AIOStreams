import React from 'react';
import type { JellyfinClient } from './client';
import { storage } from './storage';
import { CACHE_CATEGORIES } from './cache/store';

/** A source the home page features from: `resume`, `next-up` or `view:<library id>`. */
export type FeaturedSource = string;

/** An empty list features nothing. */
export type Featured = 'auto' | FeaturedSource[];

export const MAX_FEATURED = 4;

export type PosterSize = 'small' | 'medium' | 'large';

export type PosterLine = 'title' | 'year';

export const EPISODE_LAYOUTS = ['auto', 'row', 'list'] as const;
export type EpisodeLayout = (typeof EPISODE_LAYOUTS)[number];

export type HeroMode = 'rotate' | 'follow';

export const TOUCH_NAVIGATIONS = ['rail', 'bar'] as const;
export type TouchNavigation = (typeof TOUCH_NAVIGATIONS)[number];

export const TV_NAVIGATIONS = ['rail', 'sidebar', 'top'] as const;
export type TvNavigation = (typeof TV_NAVIGATIONS)[number];

export const TV_TOP_BARS = ['pill', 'bar', 'fade'] as const;
export type TvTopBar = (typeof TV_TOP_BARS)[number];

export const GLASS_STYLES = ['frosted', 'liquid'] as const;
export type GlassStyle = (typeof GLASS_STYLES)[number];

const POSTER_LINES: PosterLine[] = ['title', 'year'];

/** A stored value; `read` returns the same reference until it changes. */
export interface Setting<T> {
  read(): T;
  write(value: T): void;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce() {
  listeners.forEach((l) => l());
}

export function useSetting<T>(setting: Setting<T>): [T, (value: T) => void] {
  return [React.useSyncExternalStore(subscribe, setting.read), setting.write];
}

export function onSettingsChange(listener: () => void): () => void {
  return subscribe(listener);
}

/*
 * Settings that follow the user, kept in Jellyfin's display preferences on the
 * server. The device holds a copy so a page never waits on them; the server's
 * wins once it answers.
 */
interface Synced {
  featured?: string;
  posterSize?: string;
  posterText?: string;
  mergeNextUp?: string;
  combineSearch?: string;
  heroMode?: string;
  accentColor?: string;
  backgroundColor?: string;
  customCss?: string;
}

const SYNCED_KEYS: (keyof Synced)[] = [
  'featured',
  'posterSize',
  'posterText',
  'mergeNextUp',
  'combineSearch',
  'heroMode',
  'accentColor',
  'backgroundColor',
  'customCss',
];

const PREFS_ID = 'aiostreams-web';
/** Set on every save, so preferences reset to their defaults still count as saved. */
const SAVED_MARK = 'saved';
const LEGACY_KEYS = {
  featured: 'aiostreams-web-featured',
  posterSize: 'aiostreams-web-poster-size',
} as const;
const CATALOG_KEY = 'aiostreams-web-catalog';

const cacheKey = (userId: string) => `aiostreams-web-prefs:${userId}`;
let current: Synced = {};
let session: { client: JellyfinClient; userId: string } | null = null;
let generation = 0;

function known(prefs: Record<string, unknown> | null | undefined): Synced {
  const out: Synced = {};
  for (const key of SYNCED_KEYS) {
    const value = prefs?.[key];
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
}

/** What this device kept before settings followed the user. */
function legacy(): Synced {
  return known({
    featured: storage.get<string>(LEGACY_KEYS.featured),
    posterSize: storage.get<string>(LEGACY_KEYS.posterSize),
  });
}

function publish(next: Synced) {
  current = next;
  if (session) storage.set(cacheKey(session.userId), next);
  announce();
}

function push(prefs: Synced, target = session) {
  if (!target) return;
  const { client, userId } = target;
  void client
    .post(
      `/DisplayPreferences/${PREFS_ID}`,
      {
        Id: PREFS_ID,
        Client: PREFS_ID,
        CustomPrefs: { ...prefs, [SAVED_MARK]: '1' },
      },
      { client: PREFS_ID, userId }
    )
    .catch(() => undefined);
}

/** A user with nothing saved yet takes this device's settings. */
export function syncPreferences(
  client: JellyfinClient,
  userId: string
): () => void {
  const mine = ++generation;
  session = { client, userId };
  current = storage.get<Synced>(cacheKey(userId)) ?? legacy();
  announce();
  void client
    .get<{
      CustomPrefs?: Record<string, string | null>;
    }>(`/DisplayPreferences/${PREFS_ID}`, { client: PREFS_ID, userId })
    .then((remote) => {
      if (mine !== generation) return;
      if (remote.CustomPrefs?.[SAVED_MARK]) publish(known(remote.CustomPrefs));
      else if (Object.keys(current).length) push(current);
    })
    .catch(() => undefined);
  return () => {
    if (mine === generation) {
      session = null;
      publish({});
    }
  };
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;

function update(key: keyof Synced, value: string | undefined) {
  const next = { ...current };
  if (value) next[key] = value;
  else delete next[key];
  publish(next);
  // A dragged colour or typed CSS saves once it settles.
  clearTimeout(pushTimer);
  const target = session;
  pushTimer = setTimeout(() => push(next, target), 500);
}

/** A setting that follows the user; `format` returns undefined for the default. */
function synced<T>(
  key: keyof Synced,
  parse: (raw: string | undefined) => T,
  format: (value: T) => string | undefined
): Setting<T> {
  let raw: string | undefined;
  let value = parse(undefined);
  return {
    read() {
      if (current[key] !== raw) {
        raw = current[key];
        value = parse(raw);
      }
      return value;
    },
    write: (next) => update(key, format(next)),
  };
}

const syncedFlag = (key: keyof Synced) =>
  synced<boolean>(
    key,
    (raw) => raw === '1',
    (value) => (value ? '1' : undefined)
  );

const syncedText = (key: keyof Synced) =>
  synced<string | undefined>(
    key,
    (raw) => raw,
    (value) => value
  );

type Valid<T> = readonly T[] | ((value: T) => boolean);

/** A setting kept on this device; `fallback` is also what clears it. */
function device<T extends string | number | boolean>(
  key: string,
  fallback: T,
  valid?: Valid<T>
): Setting<T> {
  return {
    read() {
      const stored = storage.get<T>(key);
      if (stored === null || typeof stored !== typeof fallback) return fallback;
      if (!valid) return stored;
      const ok =
        typeof valid === 'function' ? valid(stored) : valid.includes(stored);
      return ok ? stored : fallback;
    },
    write(value) {
      if (value === fallback) storage.remove(key);
      else storage.set(key, value);
      announce();
    },
  };
}

/** Lists of strings by name, kept on this device; an empty record clears it. */
function deviceLists(key: string): Setting<Record<string, string[]>> {
  let seen: string | undefined;
  let value: Record<string, string[]> = {};
  return {
    read() {
      const stored = storage.get<unknown>(key);
      const text = JSON.stringify(stored);
      if (text !== seen) {
        seen = text;
        const entries =
          stored && typeof stored === 'object' ? Object.entries(stored) : [];
        value = Object.fromEntries(
          entries.filter(
            (entry): entry is [string, string[]] =>
              Array.isArray(entry[1]) &&
              entry[1].every((item) => typeof item === 'string')
          )
        );
      }
      return value;
    },
    write(next) {
      if (Object.keys(next).length) storage.set(key, next);
      else storage.remove(key);
      announce();
    },
  };
}

type Values<G> = { [K in keyof G]: G[K] extends Setting<infer T> ? T : never };

function group<G extends Record<string, Setting<unknown>>>(
  members: G
): Setting<Values<G>> {
  let value: Values<G> | undefined;
  return {
    read() {
      const next = {} as Values<G>;
      let changed = !value;
      for (const key in members) {
        next[key] = members[key].read() as Values<G>[typeof key];
        if (!Object.is(next[key], value?.[key])) changed = true;
      }
      if (changed) value = next;
      return value!;
    },
    write(next) {
      for (const key in members) members[key].write(next[key]);
    },
  };
}

function record<K extends string, V>(
  keys: readonly K[],
  make: (key: K) => V
): Record<K, V> {
  return Object.fromEntries(keys.map((key) => [key, make(key)])) as Record<
    K,
    V
  >;
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

export const SEGMENT_TYPES = [
  'Intro',
  'Recap',
  'Outro',
  'Preview',
  'Commercial',
] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];
export const SEGMENT_ACTIONS = ['ask', 'skip', 'none'] as const;
export type SegmentAction = (typeof SEGMENT_ACTIONS)[number];

export const SUBTITLE_SIZES = ['small', 'normal', 'large', 'huge'] as const;
export type SubtitleSize = (typeof SUBTITLE_SIZES)[number];
export const SUBTITLE_OUTLINES = ['none', 'thin', 'normal', 'thick'] as const;
export type SubtitleOutline = (typeof SUBTITLE_OUTLINES)[number];
export const SUBTITLE_POSITION_MAX = 30;

export interface SubtitleStyle {
  size: SubtitleSize;
  bold: boolean;
  textColor: string;
  outline: SubtitleOutline;
  outlineColor: string;
  backgroundColor: string;
  /** 0 to 100; 0 draws no background. */
  backgroundOpacity: number;
  overrideStyled: boolean;
  /** Percent of the height to raise subtitles by. */
  position: number;
}

const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);
const isPercent = (value: number) => value >= 0 && value <= 100;

export const AUDIO_CHANNELS = ['auto', 'stereo', '5.1', '7.1'] as const;
export type AudioChannels = (typeof AUDIO_CHANNELS)[number];

/** What plays versions inside the Android app. */
export const PLAYER_ENGINES = ['auto', 'mpv', 'exoplayer'] as const;
export type PlayerEngine = (typeof PLAYER_ENGINES)[number];

/** `installed` follows the channel this copy of the desktop app came from. */
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

const subtitle = {
  size: device<SubtitleSize>(
    'aiostreams-web-subtitle-size',
    'normal',
    SUBTITLE_SIZES
  ),
  bold: device<boolean>('aiostreams-web-subtitle-bold', false),
  textColor: device<string>(
    'aiostreams-web-subtitle-text-color',
    '#ffffff',
    isHex
  ),
  outline: device<SubtitleOutline>(
    'aiostreams-web-subtitle-outline',
    'normal',
    SUBTITLE_OUTLINES
  ),
  outlineColor: device<string>(
    'aiostreams-web-subtitle-outline-color',
    '#000000',
    isHex
  ),
  backgroundColor: device<string>(
    'aiostreams-web-subtitle-background-color',
    '#000000',
    isHex
  ),
  backgroundOpacity: device<number>(
    'aiostreams-web-subtitle-background-opacity',
    0,
    isPercent
  ),
  overrideStyled: device<boolean>(
    'aiostreams-web-subtitle-override-styled',
    false
  ),
  position: device<number>(
    'aiostreams-web-subtitle-position',
    0,
    (v) => v >= 0 && v <= SUBTITLE_POSITION_MAX
  ),
};

const subtitleStyle: Setting<SubtitleStyle> = group(subtitle);

/** Unset colours keep the stylesheet's own. */
const themeColors: Setting<ThemeColors> = group({
  accent: syncedText('accentColor'),
  background: syncedText('backgroundColor'),
});

const segment = record(SEGMENT_TYPES, (type) =>
  device<SegmentAction>(
    `aiostreams-web-segment-${type.toLowerCase()}`,
    'ask',
    SEGMENT_ACTIONS
  )
);

const discord = record(DISCORD_EVENTS, (event) =>
  device<boolean>(
    event === 'playing'
      ? 'aiostreams-desktop-discord'
      : `aiostreams-desktop-discord-${event}`,
    event === 'playing'
  )
);

export const settings = {
  featured: synced<Featured>(
    'featured',
    (raw = 'auto') =>
      raw === 'auto'
        ? 'auto'
        : raw === 'none'
          ? []
          : raw.split(',').filter(Boolean).slice(0, MAX_FEATURED),
    (value) =>
      value === 'auto' ? undefined : value.length ? value.join(',') : 'none'
  ),
  posterSize: synced<PosterSize>(
    'posterSize',
    (raw) => (raw === 'small' || raw === 'large' ? raw : 'medium'),
    (value) => (value === 'medium' ? undefined : value)
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
  heroMode: synced<HeroMode>(
    'heroMode',
    (raw) => (raw === 'follow' ? 'follow' : 'rotate'),
    (value) => (value === 'rotate' ? undefined : value)
  ),
  themeColors,
  customCss: synced<string>(
    'customCss',
    (raw) => raw ?? '',
    (value) => (value.trim() ? value.slice(0, MAX_CUSTOM_CSS) : undefined)
  ),
  /** Kept on the device, since a phone and a TV want different layouts. */
  episodeLayout: device<EpisodeLayout>(
    'aiostreams-web-episode-layout',
    'auto',
    EPISODE_LAYOUTS
  ),
  /** Where a touch screen wide enough for the sidebar keeps the navigation. */
  touchNavigation: device<TouchNavigation>(
    'aiostreams-web-touch-navigation',
    'rail',
    TOUCH_NAVIGATIONS
  ),
  /** How a TV shows the navigation. */
  tvNavigation: device<TvNavigation>(
    'aiostreams-web-tv-navigation',
    'rail',
    TV_NAVIGATIONS
  ),
  /** What holds a TV's top tabs over the page. */
  tvTopBar: device<TvTopBar>('aiostreams-web-tv-top-bar', 'pill', TV_TOP_BARS),
  /** The material of the bars that float over the page. */
  glass: device<GlassStyle>('aiostreams-web-glass', 'frosted', GLASS_STYLES),
  /** How the picture fills a screen of another shape; kept for this device's screen. */
  videoFit: device<VideoFit>('aiostreams-web-video-fit', 'fit', VIDEO_FITS),
  autoPlayFirst: device<boolean>('aiostreams-web-skip-versions', false),
  /** `app`, a player's id, or `custom` for `playerLink`. */
  player: device<string>('aiostreams-web-player', 'app'),
  playerLink: device<string>('aiostreams-web-player-link', ''),
  seekStep: device<number>('aiostreams-web-seek-step', 10, SEEK_STEPS),
  volumeStep: device<number>('aiostreams-web-volume-step', 5, VOLUME_STEPS),
  /** Keys changed from the defaults, by action. */
  shortcuts: deviceLists('aiostreams-web-shortcuts'),
  segment,
  segmentActions: group(segment),
  subtitle,
  subtitleStyle,
  desktop: {
    updateChannel: device<UpdateChannelSetting>(
      'aiostreams-desktop-update-channel',
      'installed',
      UPDATE_CHANNELS
    ),
    hardwareDecoding: device<boolean>('aiostreams-desktop-hwdec', true),
    audioChannels: device<AudioChannels>(
      'aiostreams-desktop-audio-channels',
      'auto',
      AUDIO_CHANNELS
    ),
    passthrough: device<boolean>('aiostreams-desktop-passthrough', false),
    /** Read by the page only; the app itself never needs it. */
    chapterSkips: device<boolean>('aiostreams-desktop-chapter-skips', true),
  },
  android: {
    pip: device<boolean>('aiostreams-android-pip', true),
    background: device<boolean>('aiostreams-android-background', false),
    engine: device<PlayerEngine>(
      'aiostreams-android-engine',
      'auto',
      PLAYER_ENGINES
    ),
    frameRate: device<boolean>('aiostreams-android-frame-rate', false),
    tunneling: device<boolean>('aiostreams-android-tunneling', false),
  },
  discord,
  discordEvents: group(discord),
  next: {
    prompt: device<NextPrompt>(
      'aiostreams-web-next-prompt',
      'credits',
      NEXT_PROMPTS
    ),
    /** Seconds before the end the prompt shows when there are no credits to go by. */
    lead: device<number>('aiostreams-web-next-lead', 30, NEXT_LEADS),
    countdown: device<number>(
      'aiostreams-web-next-countdown',
      15,
      NEXT_COUNTDOWNS
    ),
    fallbackFirst: device<boolean>('aiostreams-web-next-fallback-first', true),
    stillWatching: device<number>(
      'aiostreams-web-still-watching',
      3,
      STILL_WATCHING_AFTER
    ),
    skipFillers: device<boolean>('aiostreams-web-skip-fillers', true),
    skipRecaps: device<boolean>('aiostreams-web-skip-recaps', true),
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
      'aiostreams-web-download-searches',
      3,
      DOWNLOAD_SEARCHES
    ),
    subtitles: device<boolean>('aiostreams-web-download-subtitles', true),
    wifiOnly: device<boolean>('aiostreams-web-download-wifi-only', true),
  },
};

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
