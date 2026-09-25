import React from 'react';
import { storage } from './storage';
import type { JellyfinClient } from './client';
import type { Chapter } from './chapters';
import type { SubtitleStyle } from './settings';
import type { SubtitleLine } from './subtitle-lines';
import type { PlaybackPrefs } from './user-config';
import type { BaseItemDto, MediaStream, SourceInfo } from './types';

export interface Track {
  id: string;
  label: string;
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
  muted: boolean;
  rate: number;
  fullscreen: boolean;
  audio: string | null;
  subtitle: string | null;
  /** Positive shows subtitles later. */
  subtitleDelayMs: number;
  error: string | null;
}

/** One set of controls over whichever player the page runs in. */
export interface PlayerController {
  state: PlayerState;
  audioTracks: Track[];
  subtitleTracks: Track[];
  togglePlay(): void;
  seek(ms: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  setRate(rate: number): void;
  setAudio(id: string): void;
  setSubtitle(id: string | null): void;
  /** Missing where the player cannot shift subtitles. */
  setSubtitleDelay?: (ms: number) => void;
  /** The shown subtitle's lines, or null when the player cannot read them. */
  subtitleLines?: () => Promise<SubtitleLine[] | null>;
  /** Whether `subtitleLines` can read this subtitle; every one when missing. */
  canReadSubtitle?: (id: string) => boolean;
  toggleFullscreen(): void;
  /** The file's chapters, where the player reads them. */
  chapters?: Chapter[];
  /** Where the player draws playback statistics over the video. */
  stats?: {
    pages: Track[];
    page: string | null;
    show(page: string | null): void;
  };
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
}

export const VOLUME_KEY = 'aiostreams-web-volume';

export function storedVolume(): { volume: number; muted: boolean } {
  const saved = storage.get<{ volume: number; muted: boolean }>(VOLUME_KEY);
  return {
    volume: Math.min(1, Math.max(0, saved?.volume ?? 1)),
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
    ...storedVolume(),
  };
}

export function useLatest<T>(value: T) {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

export function trackLabel(stream: MediaStream, n: number): string {
  return stream.DisplayTitle || stream.Title || stream.Language || `Track ${n}`;
}

export function ofType(source: SourceInfo, type: MediaStream['Type']) {
  return (source.MediaStreams ?? []).filter((s) => s.Type === type);
}
