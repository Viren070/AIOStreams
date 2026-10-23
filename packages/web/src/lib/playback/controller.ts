import { t } from '@lingui/core/macro';
import { storage } from '../storage';
import type { JellyfinClient } from '../client';
import type { Chapter } from './chapters';
import type { SubtitleStyle } from '../settings';
import type { SubtitleLine } from '../subtitles/cues';
import type { SubtitleFacts } from '../subtitles/tracks';
import type { Playhead } from './playhead';
import type { ThumbnailFeed } from './thumbnails';
import type { PlannedSkip } from './engine';
import type { PlaybackPrefs } from '../user-config';
import type { BaseItemDto, MediaStream, SourceInfo } from '../types';

export interface Track {
  id: string;
  label: string;
  lang?: string;
  /** One of the file's own, rather than one loaded beside it. */
  file?: boolean;
  /** A subtitle's title and flags, which its type is read from. */
  facts?: SubtitleFacts;
}

export interface PlayerState {
  /** The first frame has played. */
  started: boolean;
  /** The file is open and its tracks known, whether or not it plays yet. */
  loaded: boolean;
  paused: boolean;
  waiting: boolean;
  durationMs: number;
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
  /** The sound goes out undecoded, which a change of speed can't stretch. */
  passthrough?: boolean;
}

/** What some players add to what a browser's video can do. */
export type PlayerFeature = 'audio' | 'chapters' | 'stats' | 'headers';

/** Engines that list a file's audio tracks let the page's own video switch them. */
export const browserFeatures: readonly PlayerFeature[] =
  'audioTracks' in HTMLMediaElement.prototype ? ['audio'] : [];

/** What lining an added subtitle up with the file's own found; `asked` when the user asked for it. */
export type SyncOutcome = { asked: boolean } & (
  | { delayMs: number; movedMs: number; first: boolean; retimed: boolean }
  | { failed: 'unmatched' | 'speed' }
);

export type SyncStatus = 'hand' | 'synced' | 'retimed' | 'unmatched' | 'speed';

/** One set of controls over whichever player the page runs in. */
export interface PlayerController {
  state: PlayerState;
  playhead: Playhead;
  audioTracks: Track[];
  subtitleTracks: Track[];
  togglePlay(): void;
  setPaused(paused: boolean): void;
  seek(ms: number, snapMs?: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  /** Missing where the player plays at one speed. */
  setRate?: (rate: number) => void;
  setAudio(id: string): void;
  setSubtitle(id: string | null): void;
  /** Missing where the player cannot shift subtitles. */
  setSubtitleDelay?: (ms: number) => void;
  skipAhead?: (skips: PlannedSkip[]) => void;
  /** Keeps the subtitles above this share of the height, which the controls cover; 0 when they hide. */
  liftSubtitles?: (share: number) => void;
  /** The shown subtitle's lines, or null when the player cannot read them. */
  subtitleLines?: () => Promise<SubtitleLine[] | null>;
  /** Whether `subtitleLines` can read this subtitle; every one when missing. */
  canReadSubtitle?: (id: string) => boolean;
  /** Lines the shown subtitle up with the file's own, for an added one the player can. */
  autoSync?: {
    run(): void;
    /** A run the user asked for waits on the file's lines. */
    waiting: boolean;
    /** A new object each time a run finds something. */
    outcome: SyncOutcome | null;
    /** How the shown subtitle's delay was set, once known. */
    status?: SyncStatus;
  };
  /** The subtitle the page draws, for a player that draws none itself. */
  subtitleText?: string;
  /** Missing where the player has no pictures for the seek bar. */
  thumbnails?: ThumbnailFeed;
  /** Missing where the page always fills the screen. */
  toggleFullscreen?: () => void;
  /** The file's chapters, where the player reads them. */
  chapters?: Chapter[];
  /** Playback statistics over the video, as `text` the page draws for a player that draws none. */
  stats?: {
    pages: Track[];
    page: string | null;
    show(page: string | null): void;
    text?: string;
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
  /** Puts what plays next after this in the player's own playlist, in place of what it held. */
  queueNext?: (next: QueuedItem | null) => void;
  /** Whether the app's sound settings apply, which they do to its own player. */
  sound?: boolean;
  /** Whether the picture follows the page's fit setting. */
  fit?: boolean;
  /** Plays the file again after it failed, from where it stopped or on another engine. */
  retry?: { label: string; run(): void };
  /** Others watch along, so nothing acts on its own, like skipping or speeding up. */
  shared?: boolean;
}

export interface QueuedItem {
  itemId: string;
  source: SourceInfo;
  startMs: number;
  url: string;
  headers?: Record<string, string>;
  /** The playlist it plays on through. */
  playlist?: string;
}

export interface PlayerOptions {
  client: JellyfinClient;
  item: BaseItemDto;
  source: SourceInfo;
  url: string;
  headers?: Record<string, string>;
  startMs: number;
  onEnded(): void;
  prefs?: PlaybackPrefs;
  subtitleStyle?: SubtitleStyle;
  /** Where an external subtitle is, when not the server's address, as for a download. */
  subtitleUrl?: (stream: MediaStream) => string | null;
  /** Plays in this player's own window instead. */
  launched?: { id: string; name: string };
  /** The user closed that window. */
  onClosed?: () => void;
  /** That player moved on to what it was given with `queueNext`. */
  onAdvance?: (next: QueuedItem) => void;
  startPaused?: boolean;
}

export const VOLUME_KEY = 'aiostreams-web-volume';

export function storedVolume(max = 1): { volume: number; muted: boolean } {
  const saved = storage.get<{ volume: number; muted: boolean }>(VOLUME_KEY);
  return {
    volume: Math.min(max, Math.max(0, saved?.volume ?? 1)),
    muted: saved?.muted ?? false,
  };
}

export function initialState(source: SourceInfo): PlayerState {
  return {
    started: false,
    loaded: false,
    paused: false,
    waiting: true,
    durationMs: source.RunTimeTicks ? source.RunTimeTicks / 10_000 : 0,
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
  return (
    stream.DisplayTitle || stream.Title || stream.Language || t`Track ${n}`
  );
}

/** A track as the player itself lists it. */
export function ownTrackLabel(
  title: string | undefined,
  lang: string | undefined,
  n: number
): string {
  return (
    [title, lang?.toUpperCase()].filter(Boolean).join(' · ') || t`Track ${n}`
  );
}

export function ofType(source: SourceInfo, type: MediaStream['Type']) {
  return (source.MediaStreams ?? []).filter((s) => s.Type === type);
}
