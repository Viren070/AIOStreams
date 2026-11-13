import { t } from '@lingui/core/macro';
import { storage } from '@/lib/storage';
import type { JellyfinClient } from '@/lib/jellyfin/client';
import type { Chapter } from './chapters';
import type { Live } from '@/lib/live-value';
import type { SubtitleStyle, VideoFit } from '@/lib/settings';
import type { SubtitleLine } from '@/lib/subtitles/cues';
import { subtitleType, type SubtitleFacts } from '@/lib/subtitles/tracks';
import { tagName } from '@/lib/languages';
import type { Playhead } from './playhead';
import type { Open, ThumbnailFeed } from './thumbnails';
import type { PlannedSkip, StatsRow, VideoFrame } from './engine';
import type { PlaybackPrefs } from '@/lib/jellyfin/user-config';
import type {
  BaseItemDto,
  MediaStream,
  SourceInfo,
} from '@/lib/jellyfin/types';

export interface Track {
  id: string;
  label: string;
  /** A smaller line under the label. */
  detail?: string;
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
  reconnecting?: boolean;
  /** The sound goes out undecoded, which a change of speed can't stretch. */
  passthrough?: boolean;
  /** The server's conversion that plays in place of the file, which reports name. */
  stream?: { playSessionId: string | null; liveStreamId?: string };
  /** In the engine's own picture-in-picture window, not on the page. */
  pictureInPicture?: boolean;
}

/** What some players add to what a browser's video can do. */
/** `anyFormat`: opens any container and codec. */
export type PlayerFeature =
  'audio' | 'chapters' | 'stats' | 'headers' | 'upscaling' | 'anyFormat';

/** Engines that list a file's audio tracks let the page's own video switch them. */
export const browserFeatures: readonly PlayerFeature[] =
  'audioTracks' in HTMLMediaElement.prototype ? ['audio'] : [];

export const webGpuFeatures: readonly PlayerFeature[] = [
  'audio',
  'stats',
  'upscaling',
];

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
  subtitleText: Live<string | undefined>;
  /** The share `liftSubtitles` last asked for, which the page's own subtitle slides to. */
  subtitleLift: Live<number>;
  /** Missing where the player has no pictures for the seek bar. */
  thumbnails?: ThumbnailFeed;
  /** Missing where the page always fills the screen. */
  toggleFullscreen?: () => void;
  togglePictureInPicture?: () => void;
  setPictureInPicture?: (open: boolean) => void;
  setFrame?: (frame: VideoFrame | null) => void;
  /** The file's chapters, where the player reads them. */
  chapters?: Chapter[];
  /** `rows` are the shown page's, for a player that doesn't draw its own. */
  stats?: {
    pages: Track[];
    page: string | null;
    show(page: string | null): void;
    rows: Live<StatsRow[] | undefined>;
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
  /** Joins a live source at its edge again, after a pause left it behind. */
  goLive?: () => void;
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
  /** Moves on from a live source that kept failing; false when there is nothing else to play. */
  onLiveFailed?: () => Promise<boolean>;
  startPaused?: boolean;
  fit?: VideoFit;
  /** Kept from the saved volume, which it leaves alone. */
  muted?: boolean;
  thumbnails?: boolean;
  /** The title's chapters, for an engine that reads none from the file. */
  chapters?: Chapter[];
  /** Seek bar pictures that need no read of the file, taken over the engine's own. */
  pictures?: Open | null;
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

interface RowFacts extends SubtitleFacts {
  lang?: string | null;
}

export function trackRow(
  track: RowFacts,
  kind: 'audio' | 'subtitle',
  fallback: string
): Pick<Track, 'label' | 'detail'> {
  const language = track.lang ? tagName(track.lang) : undefined;
  const title = track.title?.trim();
  const own =
    title &&
    ![language, track.lang].some(
      (name) => name?.toLowerCase() === title.toLowerCase()
    )
      ? title
      : undefined;
  const type = kind === 'subtitle' ? subtitleType(track) : undefined;
  const typeLabel =
    type === 'sdh'
      ? t`SDH`
      : type === 'forced'
        ? t`Forced`
        : type === 'signs'
          ? t`Signs and songs`
          : type === 'commentary'
            ? t`Commentary`
            : undefined;
  return {
    label: [language ?? t`Unknown language`, typeLabel]
      .filter(Boolean)
      .join(' · '),
    detail: own ?? (language ? undefined : fallback),
  };
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
