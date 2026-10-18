import React from 'react';
import type { JellyfinClient } from './client';
import { storage } from './storage';
import { CACHE_CATEGORIES } from './cache/store';
import { appBridge } from './hosts/shell/bridge';
import { readQuickFilters, type QuickFilter } from './versions';
import { readBadgeSettings, type BadgeSettings } from './badges';

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

export const TOUCH_NAVIGATIONS = ['rail', 'bar'] as const;
export type TouchNavigation = (typeof TOUCH_NAVIGATIONS)[number];

export const TV_NAVIGATIONS = ['rail', 'top'] as const;
export type TvNavigation = (typeof TV_NAVIGATIONS)[number];

export const RAIL_SHAPES = ['docked', 'floating', 'corner'] as const;
export type RailShape = (typeof RAIL_SHAPES)[number];

export const RAIL_NAMES = ['auto', 'always', 'never'] as const;
export type RailNames = (typeof RAIL_NAMES)[number];

export const TV_TOP_BARS = ['pill', 'bar', 'fade'] as const;
export type TvTopBar = (typeof TV_TOP_BARS)[number];

export const BAR_BACKGROUNDS = ['solid', 'frosted', 'liquid'] as const;
export type BarBackground = (typeof BAR_BACKGROUNDS)[number];

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

/** An older key of a setting, with a reader where the value's shape changed. */
type Was<T> = string | { key: string; read: (old: unknown) => T | undefined };

const wasKey = (old: Was<unknown>) => (typeof old === 'string' ? old : old.key);

function readWas<T>(was: Was<T>[]): { value: unknown } | null {
  for (const old of was) {
    const stored = storage.get<unknown>(wasKey(old));
    if (stored === null) continue;
    return { value: typeof old === 'string' ? stored : old.read(stored) };
  }
  return null;
}

function forget(was: Was<unknown>[]) {
  for (const old of was) storage.remove(wasKey(old));
}

/*
 * Settings that follow the user, kept in Jellyfin's display preferences on the
 * server. The device holds a copy so a page never waits on them; the server's
 * wins once it answers.
 */
type Synced = Record<string, string>;

const SYNCED_KEYS = new Set<string>();

/** Settings this device kept before they followed the user. */
const moved = new Map<
  string,
  { was: Was<unknown>[]; format: (value: never) => string | undefined }
>();

const PREFS_ID = 'aiostreams-web';
/** Set on every save, so preferences reset to their defaults still count as saved. */
const SAVED_MARK = 'saved';
const CATALOG_KEY = 'aiostreams-web-catalog';

const cacheKey = (userId: string) => `aiostreams-web-prefs:${userId}`;
const movedKey = (userId: string) => `aiostreams-web-prefs-moved:${userId}`;
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

function fromDevice(): Synced {
  const out: Synced = {};
  for (const [key, { was, format }] of moved) {
    const found = readWas(was);
    if (!found || found.value === undefined) continue;
    try {
      const text = format(found.value as never);
      if (text) out[key] = text;
    } catch {}
  }
  return out;
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

/**
 * A user with nothing saved yet takes this device's settings. Moved settings
 * fill an account's gaps once, or a reset elsewhere would keep coming back.
 */
export function syncPreferences(
  client: JellyfinClient,
  userId: string
): () => void {
  const mine = ++generation;
  session = { client, userId };
  const folded = storage.get<unknown>(movedKey(userId));
  const older = Object.fromEntries(
    Object.entries(fromDevice()).filter(
      ([key]) => !(Array.isArray(folded) && folded.includes(key))
    )
  );
  current = { ...older, ...(storage.get<Synced>(cacheKey(userId)) ?? {}) };
  announce();
  void client
    .get<{
      CustomPrefs?: Record<string, string | null>;
    }>(`/DisplayPreferences/${PREFS_ID}`, { client: PREFS_ID, userId })
    .then((remote) => {
      if (mine !== generation) return;
      if (remote.CustomPrefs?.[SAVED_MARK]) {
        const theirs = known(remote.CustomPrefs);
        publish({ ...older, ...theirs });
        if (Object.keys(older).some((key) => !(key in theirs))) push(current);
      } else if (Object.keys(current).length) push(current);
      storage.set(movedKey(userId), [...moved.keys()]);
    })
    .catch(() => undefined);
  return () => {
    if (mine === generation) {
      session = null;
      publish({});
    }
  };
}

/** Whether a user's settings apply, rather than the defaults of nobody signed in. */
export function signedIn(): boolean {
  return session !== null;
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;

function update(key: string, value: string | undefined) {
  const was = moved.get(key)?.was;
  if (was) forget(was);
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
  key: string,
  parse: (raw: string | undefined) => T,
  format: (value: T) => string | undefined,
  was: Was<T>[] = []
): Setting<T> {
  SYNCED_KEYS.add(key);
  if (was.length) moved.set(key, { was, format });
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

const syncedFlag = (key: string, fallback = false, was: Was<boolean>[] = []) =>
  synced<boolean>(
    key,
    (raw) => (raw === undefined ? fallback : raw === '1'),
    (value) => (value === fallback ? undefined : value ? '1' : '0'),
    was
  );

function syncedChoice<T extends string | number>(
  key: string,
  options: readonly T[],
  fallback: T,
  was: Was<T>[] = []
): Setting<T> {
  return synced<T>(
    key,
    (raw) => options.find((o) => String(o) === raw) ?? fallback,
    (value) => (value === fallback ? undefined : String(value)),
    was
  );
}

const syncedColor = (key: string, fallback: string, was: Was<string>[] = []) =>
  synced<string>(
    key,
    (raw) => (raw && isHex(raw) ? raw : fallback),
    (value) => (value === fallback ? undefined : value),
    was
  );

function syncedNumber(
  key: string,
  fallback: number,
  valid: (value: number) => boolean,
  was: Was<number>[] = []
): Setting<number> {
  return synced<number>(
    key,
    (raw) => {
      const value = Number(raw);
      return raw && Number.isFinite(value) && valid(value) ? value : fallback;
    },
    (value) => (value === fallback ? undefined : String(value)),
    was
  );
}

const syncedText = (key: string) =>
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
  valid?: Valid<T>,
  was: Was<T>[] = []
): Setting<T> {
  const ok = (value: unknown): value is T =>
    typeof value === typeof fallback &&
    (!valid ||
      (typeof valid === 'function'
        ? valid(value as T)
        : valid.includes(value as T)));
  return {
    read() {
      const stored = storage.get<unknown>(key);
      const value = stored === null ? readWas(was)?.value : stored;
      return ok(value) ? value : fallback;
    },
    write(value) {
      forget(was);
      if (value === fallback) storage.remove(key);
      else storage.set(key, value);
      announce();
    },
  };
}

/** Lists of strings by name, kept on this device; an empty record clears it. */
function deviceLists(
  key: string,
  was: string[] = []
): Setting<Record<string, string[]>> {
  let seen: string | undefined;
  let value: Record<string, string[]> = {};
  return {
    read() {
      const stored = storage.get<unknown>(key) ?? readWas(was)?.value;
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
      forget(was);
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

const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);
const isPercent = (value: number) => value >= 0 && value <= 100;

export const AUDIO_CHANNELS = ['auto', 'stereo', '5.1', '7.1'] as const;
export type AudioChannels = (typeof AUDIO_CHANNELS)[number];

/** What plays versions inside the Android app. */
export const PLAYER_ENGINES = ['auto', 'mpv', 'exoplayer'] as const;
export type PlayerEngine = (typeof PLAYER_ENGINES)[number];
/** Megabytes, or `auto` to size it from the device's memory. */
export const CACHE_SIZES = ['auto', '128', '256', '512', '1000'] as const;
export type CacheSize = (typeof CACHE_SIZES)[number];

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
    (v) => v >= 0 && v <= SUBTITLE_POSITION_MAX,
    ['aiostreams-web-subtitle-position']
  ),
};

const segment = record(SEGMENT_TYPES, (type) =>
  syncedChoice<SegmentAction>(`segment${type}`, SEGMENT_ACTIONS, 'ask', [
    `aiostreams-web-segment-${type.toLowerCase()}`,
  ])
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
    heroMode: syncedChoice<HeroMode>('heroMode', HERO_MODES, 'rotate'),
    episodeLayout: device<EpisodeLayout>(
      'aiostreams-web-interface-episode-layout',
      'auto',
      EPISODE_LAYOUTS,
      ['aiostreams-web-episode-layout']
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
    /** How a TV's top tabs sit over the page. */
    tvTopBar: device<TvTopBar>(
      'aiostreams-web-interface-tv-top-bar',
      'pill',
      TV_TOP_BARS,
      ['aiostreams-web-tv-top-bar']
    ),
    /** What the navigation bars over the page sit on. */
    barBackground: device<BarBackground>(
      'aiostreams-web-interface-bar-background',
      'frosted',
      BAR_BACKGROUNDS,
      ['aiostreams-web-bar-background']
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
  },
  playback: {
    autoPlayFirst: syncedFlag('autoPlayFirst', false, [
      'aiostreams-web-skip-versions',
    ]),
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
  },
  party: {
    /** What other members send shows over the video. */
    messages: syncedFlag('partyMessages', true),
    reactions: syncedFlag('partyReactions', true),
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
