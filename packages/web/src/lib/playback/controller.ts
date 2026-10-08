import { storage } from '../storage';
import type { JellyfinClient } from '../client';
import type { Chapter } from './chapters';
import type { SubtitleStyle } from '../settings';
import type { SubtitleLine } from '../subtitles/cues';
import type { PlaybackPrefs } from '../user-config';
import type { BaseItemDto, MediaStream, SourceInfo } from '../types';

export interface Track {
  id: string;
  label: string;
  lang?: string;
}

export interface PlayerState {
  /** The first frame has played. */
  started: boolean;
  paused: boolean;
  waiting: boolean;
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  volume: number;
  /** Above 1 where the player can boost past the file's own level. */
  maxVolume: number;
  muted: boolean;
  rate: number;
  fullscreen: boolean;
  audio: string | null;
  subtitle: string | null;
  /** Positive shows subtitles later. */
  subtitleDelayMs: number;
  error: string | null;
  /** The video plays in a small window of its own, with nothing over it. */
  pictureInPicture?: boolean;
}

/** What some players add to what a browser's video can do. */
export type PlayerFeature = 'audio' | 'chapters' | 'stats';

/** Engines that list a file's audio tracks let the page's own video switch them. */
export const browserFeatures: readonly PlayerFeature[] =
  'audioTracks' in HTMLMediaElement.prototype ? ['audio'] : [];

/** One set of controls over whichever player the page runs in. */
export interface PlayerController {
  state: PlayerState;
  audioTracks: Track[];
  subtitleTracks: Track[];
  togglePlay(): void;
  seek(ms: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  /** Missing where the player plays at one speed. */
  setRate?: (rate: number) => void;
  setAudio(id: string): void;
  setSubtitle(id: string | null): void;
  /** Missing where the player cannot shift subtitles. */
  setSubtitleDelay?: (ms: number) => void;
  /** Keeps the subtitles above this share of the height, which the controls cover; 0 when they hide. */
  liftSubtitles?: (share: number) => void;
  /** The shown subtitle's lines, or null when the player cannot read them. */
  subtitleLines?: () => Promise<SubtitleLine[] | null>;
  /** Whether `subtitleLines` can read this subtitle; every one when missing. */
  canReadSubtitle?: (id: string) => boolean;
  /** The subtitle the page draws, for a player that draws none itself. */
  subtitleText?: string;
  /** Missing where the page always fills the screen. */
  toggleFullscreen?: () => void;
  /** The file's chapters, where the player reads them. */
  chapters?: Chapter[];
  /** Where the player draws playback statistics over the video. */
  stats?: {
    pages: Track[];
    page: string | null;
    show(page: string | null): void;
  };
  /** Loads a subtitle file from this device; `types` are the extensions it reads. */
  subtitleFiles?: {
    types: readonly string[];
    add(file: File): Promise<void>;
  };
  /** The name of the player in its own window that these controls drive. */
  external?: string;
  /** Closes a player in its own window. */
  close?: () => void;
  /** Puts the next episode after this one in the player's own playlist. */
  queueNext?: (episode: QueuedEpisode) => void;
  /** Plays the file again on another engine, after it failed on this one. */
  retry?: { label: string; run(): void };
}

export interface QueuedEpisode {
  itemId: string;
  source: SourceInfo;
  startMs: number;
  url: string;
}

export interface PlayerOptions {
  source: SourceInfo;
  startMs: number;
  onEnded(): void;
  prefs?: PlaybackPrefs;
  subtitleStyle?: SubtitleStyle;
}

/** For players drawn beneath the page, which load the stream themselves. */
export interface NativePlayerOptions extends PlayerOptions {
  client: JellyfinClient;
  item: BaseItemDto;
  url: string;
  /** Where an external subtitle is, when not the server's address, as for a download. */
  subtitleUrl?: (stream: MediaStream) => string | null;
  /** Plays in this player's own window instead. */
  launched?: { id: string; name: string };
  /** The user closed that window. */
  onClosed?: () => void;
  /** That player moved on to the episode it was given with `queueNext`. */
  onAdvance?: (episode: QueuedEpisode) => void;
}

export const VOLUME_KEY = 'aiostreams-web-volume';

export function storedVolume(max = 1): { volume: number; muted: boolean } {
  const saved = storage.get<{ volume: number; muted: boolean }>(VOLUME_KEY);
  return {
    volume: Math.min(max, Math.max(0, saved?.volume ?? 1)),
    muted: saved?.muted ?? false,
  };
}

export function initialState(source: SourceInfo, startMs: number): PlayerState {
  return {
    started: false,
    paused: false,
    waiting: true,
    positionMs: startMs,
    durationMs: source.RunTimeTicks ? source.RunTimeTicks / 10_000 : 0,
    bufferedMs: 0,
    rate: 1,
    fullscreen: false,
    audio: null,
    subtitle: null,
    subtitleDelayMs: 0,
    error: null,
    maxVolume: 1,
    ...storedVolume(),
  };
}

export function trackLabel(stream: MediaStream, n: number): string {
  return stream.DisplayTitle || stream.Title || stream.Language || `Track ${n}`;
}

/** A track as the player itself lists it. */
export function ownTrackLabel(
  title: string | undefined,
  lang: string | undefined,
  n: number
): string {
  return (
    [title, lang?.toUpperCase()].filter(Boolean).join(' · ') || `Track ${n}`
  );
}

export function ofType(source: SourceInfo, type: MediaStream['Type']) {
  return (source.MediaStreams ?? []).filter((s) => s.Type === type);
}
