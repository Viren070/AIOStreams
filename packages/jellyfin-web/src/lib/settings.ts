import React from 'react';
import type { JellyfinClient } from './client';
import { storage } from './storage';

/** A source the home page features from: `resume`, `next-up` or `view:<library id>`. */
export type FeaturedSource = string;

/** An empty list features nothing. */
export type Featured = 'auto' | FeaturedSource[];

export const MAX_FEATURED = 4;

export type PosterSize = 'small' | 'medium' | 'large';

export type PosterLine = 'title' | 'year';

export type EpisodeLayout = 'auto' | 'row' | 'list';

export type HeroMode = 'rotate' | 'follow';

const POSTER_LINES: PosterLine[] = ['title', 'year'];

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
const EPISODE_LAYOUT_KEY = 'aiostreams-web-episode-layout';

const cacheKey = (userId: string) => `aiostreams-web-prefs:${userId}`;
const listeners = new Set<() => void>();
let current: Synced = {};
let session: { client: JellyfinClient; userId: string } | null = null;
let generation = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce() {
  listeners.forEach((l) => l());
}

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
    if (mine === generation) session = null;
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

function readFeatured(): string {
  return current.featured ?? 'auto';
}

export function useFeatured(): [Featured, (value: Featured) => void] {
  const raw = React.useSyncExternalStore(subscribe, readFeatured);
  const value = React.useMemo<Featured>(
    () =>
      raw === 'auto'
        ? 'auto'
        : raw === 'none'
          ? []
          : raw.split(',').filter(Boolean).slice(0, MAX_FEATURED),
    [raw]
  );
  const set = React.useCallback((next: Featured) => {
    update(
      'featured',
      next === 'auto' ? undefined : next.length ? next.join(',') : 'none'
    );
  }, []);
  return [value, set];
}

function readPosterSize(): PosterSize {
  const value = current.posterSize;
  return value === 'small' || value === 'large' ? value : 'medium';
}

export function usePosterSize(): [PosterSize, (value: PosterSize) => void] {
  const value = React.useSyncExternalStore(subscribe, readPosterSize);
  const set = React.useCallback((next: PosterSize) => {
    update('posterSize', next === 'medium' ? undefined : next);
  }, []);
  return [value, set];
}

function readPosterLines(): string {
  return current.posterText ?? 'title,year';
}

export function usePosterLines(): [
  PosterLine[],
  (value: PosterLine[]) => void,
] {
  const raw = React.useSyncExternalStore(subscribe, readPosterLines);
  const value = React.useMemo(
    () => POSTER_LINES.filter((line) => raw.split(',').includes(line)),
    [raw]
  );
  const set = React.useCallback((next: PosterLine[]) => {
    const lines = POSTER_LINES.filter((line) => next.includes(line));
    update(
      'posterText',
      lines.length === POSTER_LINES.length
        ? undefined
        : lines.length
          ? lines.join(',')
          : 'none'
    );
  }, []);
  return [value, set];
}

function readMergeNextUp(): boolean {
  return current.mergeNextUp === '1';
}

export function useMergeNextUp(): [boolean, (value: boolean) => void] {
  const value = React.useSyncExternalStore(subscribe, readMergeNextUp);
  const set = React.useCallback((next: boolean) => {
    update('mergeNextUp', next ? '1' : undefined);
  }, []);
  return [value, set];
}

function readHeroMode(): HeroMode {
  return current.heroMode === 'follow' ? 'follow' : 'rotate';
}

export function useHeroMode(): [HeroMode, (value: HeroMode) => void] {
  const value = React.useSyncExternalStore(subscribe, readHeroMode);
  const set = React.useCallback((next: HeroMode) => {
    update('heroMode', next === 'rotate' ? undefined : next);
  }, []);
  return [value, set];
}

export interface ThemeColors {
  accent?: string;
  background?: string;
}

function readAccent(): string | undefined {
  return current.accentColor;
}

function readBackground(): string | undefined {
  return current.backgroundColor;
}

/** Unset colours keep the stylesheet's own. */
export function useThemeColors(): [ThemeColors, (value: ThemeColors) => void] {
  const accent = React.useSyncExternalStore(subscribe, readAccent);
  const background = React.useSyncExternalStore(subscribe, readBackground);
  const value = React.useMemo(
    () => ({ accent, background }),
    [accent, background]
  );
  const set = React.useCallback((next: ThemeColors) => {
    update('accentColor', next.accent);
    update('backgroundColor', next.background);
  }, []);
  return [value, set];
}

export const MAX_CUSTOM_CSS = 20_000;

function readCustomCss(): string {
  return current.customCss ?? '';
}

export function useCustomCss(): [string, (value: string) => void] {
  const value = React.useSyncExternalStore(subscribe, readCustomCss);
  const set = React.useCallback((next: string) => {
    update(
      'customCss',
      next.trim() ? next.slice(0, MAX_CUSTOM_CSS) : undefined
    );
  }, []);
  return [value, set];
}

function readEpisodeLayout(): EpisodeLayout {
  const value = storage.get<string>(EPISODE_LAYOUT_KEY);
  return value === 'row' || value === 'list' ? value : 'auto';
}

/** Kept on the device, since a phone and a TV want different layouts. */
export function useEpisodeLayout(): [
  EpisodeLayout,
  (value: EpisodeLayout) => void,
] {
  const value = React.useSyncExternalStore(subscribe, readEpisodeLayout);
  const set = React.useCallback((next: EpisodeLayout) => {
    if (next === 'auto') storage.remove(EPISODE_LAYOUT_KEY);
    else storage.set(EPISODE_LAYOUT_KEY, next);
    announce();
  }, []);
  return [value, set];
}

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

type Valid<T> = readonly T[] | ((value: T) => boolean);

function isValid<T>(value: T, valid?: Valid<T>): boolean {
  if (!valid) return true;
  return typeof valid === 'function' ? valid(value) : valid.includes(value);
}

/** A setting kept on this device; `fallback` is also what clears it. */
function useDeviceSetting<T extends string | number | boolean>(
  key: string,
  fallback: T,
  valid?: Valid<T>
): [T, (value: T) => void] {
  const read = React.useCallback(
    () => readDeviceSetting(key, fallback, valid),
    [key, fallback, valid]
  );
  const value = React.useSyncExternalStore(subscribe, read);
  const set = React.useCallback(
    (next: T) => {
      if (next === fallback) storage.remove(key);
      else storage.set(key, next);
      announce();
    },
    [key, fallback]
  );
  return [value, set];
}

function readDeviceSetting<T>(key: string, fallback: T, valid?: Valid<T>): T {
  const stored = storage.get<T>(key);
  if (stored === null || typeof stored !== typeof fallback) return fallback;
  return isValid(stored, valid) ? stored : fallback;
}

export const VIDEO_FITS = ['fit', 'crop', 'stretch'] as const;
export type VideoFit = (typeof VIDEO_FITS)[number];
const VIDEO_FIT_KEY = 'aiostreams-web-video-fit';
/** How the picture fills a screen of another shape; kept for this device's screen. */
export const useVideoFit = () =>
  useDeviceSetting<VideoFit>(VIDEO_FIT_KEY, 'fit', VIDEO_FITS);

export const SEEK_STEPS = [5, 10, 15, 30] as const;
const SEEK_STEP_KEY = 'aiostreams-web-seek-step';
export const useSeekStep = () =>
  useDeviceSetting<number>(SEEK_STEP_KEY, 10, SEEK_STEPS);

export const SUBTITLE_SIZES = ['small', 'normal', 'large', 'huge'] as const;
export type SubtitleSize = (typeof SUBTITLE_SIZES)[number];
export const SUBTITLE_OUTLINES = ['none', 'thin', 'normal', 'thick'] as const;
export type SubtitleOutline = (typeof SUBTITLE_OUTLINES)[number];

const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);
const isPercent = (value: number) => value >= 0 && value <= 100;

const SUBTITLE_KEYS = {
  size: 'aiostreams-web-subtitle-size',
  bold: 'aiostreams-web-subtitle-bold',
  textColor: 'aiostreams-web-subtitle-text-color',
  outline: 'aiostreams-web-subtitle-outline',
  outlineColor: 'aiostreams-web-subtitle-outline-color',
  backgroundColor: 'aiostreams-web-subtitle-background-color',
  backgroundOpacity: 'aiostreams-web-subtitle-background-opacity',
  overrideStyled: 'aiostreams-web-subtitle-override-styled',
} as const;

export const useSubtitleSize = () =>
  useDeviceSetting<SubtitleSize>(SUBTITLE_KEYS.size, 'normal', SUBTITLE_SIZES);
export const useSubtitleBold = () =>
  useDeviceSetting<boolean>(SUBTITLE_KEYS.bold, false);
export const useSubtitleTextColor = () =>
  useDeviceSetting<string>(SUBTITLE_KEYS.textColor, '#ffffff', isHex);
export const useSubtitleOutline = () =>
  useDeviceSetting<SubtitleOutline>(
    SUBTITLE_KEYS.outline,
    'normal',
    SUBTITLE_OUTLINES
  );
export const useSubtitleOutlineColor = () =>
  useDeviceSetting<string>(SUBTITLE_KEYS.outlineColor, '#000000', isHex);
export const useSubtitleBackgroundColor = () =>
  useDeviceSetting<string>(SUBTITLE_KEYS.backgroundColor, '#000000', isHex);
export const useSubtitleBackgroundOpacity = () =>
  useDeviceSetting<number>(SUBTITLE_KEYS.backgroundOpacity, 0, isPercent);
export const useSubtitleOverrideStyled = () =>
  useDeviceSetting<boolean>(SUBTITLE_KEYS.overrideStyled, false);

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
}

export function useSubtitleStyle(): SubtitleStyle {
  const [size] = useSubtitleSize();
  const [bold] = useSubtitleBold();
  const [textColor] = useSubtitleTextColor();
  const [outline] = useSubtitleOutline();
  const [outlineColor] = useSubtitleOutlineColor();
  const [backgroundColor] = useSubtitleBackgroundColor();
  const [backgroundOpacity] = useSubtitleBackgroundOpacity();
  const [overrideStyled] = useSubtitleOverrideStyled();
  return React.useMemo(
    () => ({
      size,
      bold,
      textColor,
      outline,
      outlineColor,
      backgroundColor,
      backgroundOpacity,
      overrideStyled,
    }),
    [
      size,
      bold,
      textColor,
      outline,
      outlineColor,
      backgroundColor,
      backgroundOpacity,
      overrideStyled,
    ]
  );
}

export const AUDIO_CHANNELS = ['auto', 'stereo', '5.1', '7.1'] as const;
export type AudioChannels = (typeof AUDIO_CHANNELS)[number];

/** `installed` follows the channel this copy of the desktop app came from. */
export const UPDATE_CHANNELS = ['installed', 'stable', 'nightly'] as const;
export type UpdateChannelSetting = (typeof UPDATE_CHANNELS)[number];

const DESKTOP_KEYS = {
  updateChannel: 'aiostreams-desktop-update-channel',
  hardwareDecoding: 'aiostreams-desktop-hwdec',
  audioChannels: 'aiostreams-desktop-audio-channels',
  passthrough: 'aiostreams-desktop-passthrough',
  escExitsFullscreen: 'aiostreams-desktop-esc-fullscreen',
} as const;

export interface DesktopSettings {
  updateChannel: UpdateChannelSetting;
  hardwareDecoding: boolean;
  audioChannels: AudioChannels;
  passthrough: boolean;
  escExitsFullscreen: boolean;
}

export function readDesktopSettings(): DesktopSettings {
  return {
    updateChannel: readDeviceSetting<UpdateChannelSetting>(
      DESKTOP_KEYS.updateChannel,
      'installed',
      UPDATE_CHANNELS
    ),
    hardwareDecoding: readDeviceSetting(DESKTOP_KEYS.hardwareDecoding, true),
    audioChannels: readDeviceSetting<AudioChannels>(
      DESKTOP_KEYS.audioChannels,
      'auto',
      AUDIO_CHANNELS
    ),
    passthrough: readDeviceSetting(DESKTOP_KEYS.passthrough, false),
    escExitsFullscreen: readDeviceSetting(
      DESKTOP_KEYS.escExitsFullscreen,
      true
    ),
  };
}

export const useUpdateChannel = () =>
  useDeviceSetting<UpdateChannelSetting>(
    DESKTOP_KEYS.updateChannel,
    'installed',
    UPDATE_CHANNELS
  );
export const useHardwareDecoding = () =>
  useDeviceSetting<boolean>(DESKTOP_KEYS.hardwareDecoding, true);
export const useAudioChannels = () =>
  useDeviceSetting<AudioChannels>(
    DESKTOP_KEYS.audioChannels,
    'auto',
    AUDIO_CHANNELS
  );
export const usePassthrough = () =>
  useDeviceSetting<boolean>(DESKTOP_KEYS.passthrough, false);
export const useEscExitsFullscreen = () =>
  useDeviceSetting<boolean>(DESKTOP_KEYS.escExitsFullscreen, true);

export function onSettingsChange(listener: () => void): () => void {
  return subscribe(listener);
}

export const NEXT_PROMPTS = ['credits', 'end', 'off'] as const;
export type NextPrompt = (typeof NEXT_PROMPTS)[number];
export const NEXT_LEADS = [15, 30, 45, 60, 90, 120] as const;
export const NEXT_COUNTDOWNS = [5, 10, 15, 30] as const;

const NEXT_KEYS = {
  prompt: 'aiostreams-web-next-prompt',
  lead: 'aiostreams-web-next-lead',
  countdown: 'aiostreams-web-next-countdown',
  fallbackFirst: 'aiostreams-web-next-fallback-first',
} as const;

export const useNextPrompt = () =>
  useDeviceSetting<NextPrompt>(NEXT_KEYS.prompt, 'credits', NEXT_PROMPTS);
/** Seconds before the end the prompt shows when there are no credits to go by. */
export const useNextLead = () =>
  useDeviceSetting<number>(NEXT_KEYS.lead, 30, NEXT_LEADS);
export const useNextCountdown = () =>
  useDeviceSetting<number>(NEXT_KEYS.countdown, 15, NEXT_COUNTDOWNS);
export const useNextFallbackFirst = () =>
  useDeviceSetting<boolean>(NEXT_KEYS.fallbackFirst, true);
