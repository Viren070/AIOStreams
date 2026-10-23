import type { SubtitleStyle, VideoFit } from '../settings';
import type { Span } from '../subtitles/align';
import type { BaseItemDto, MediaStream, SourceInfo } from '../types';
import type { PlaybackPrefs } from '../user-config';
import type { Chapter } from './chapters';
import type { PlayerState, QueuedItem, Track } from './controller';
import type { TimeRange } from './playhead';

/** One of the server's external subtitles, which an engine loads once picked. */
export interface ServerSubtitle extends Track {
  url: string;
  stream: MediaStream;
}

export interface EngineTrack extends Track {
  type: 'audio' | 'subtitle';
  title?: string;
  codec?: string;
  forced?: boolean;
  hearingImpaired?: boolean;
  visualImpaired?: boolean;
  default?: boolean;
  /** Added from outside the file. */
  external?: boolean;
  /** The server subtitle's id, for one loaded from it. */
  server?: string;
  unplayable?: boolean;
}

export interface EngineFile {
  url: string;
  headers?: Record<string, string>;
  startMs: number;
  /** Opens without playing. */
  paused?: boolean;
  item: BaseItemDto;
  source: SourceInfo;
  prefs: PlaybackPrefs;
  subtitles: ServerSubtitle[];
  subtitleDelayMs: number;
  /** Null for an engine that keeps the device's own. */
  volume: { volume: number; muted: boolean } | null;
}

export interface EngineStyle {
  subtitleStyle?: SubtitleStyle;
  fit: VideoFit;
  /** The share of the height the controls cover. */
  lift: number;
}

export type EngineState = Partial<
  Pick<
    PlayerState,
    | 'started'
    | 'loaded'
    | 'paused'
    | 'waiting'
    | 'durationMs'
    | 'volume'
    | 'maxVolume'
    | 'muted'
    | 'rate'
    | 'fullscreen'
    | 'audio'
    | 'subtitle'
    | 'pictureInPicture'
    | 'passthrough'
  >
>;

export type EngineEvent =
  | { type: 'state'; state: EngineState }
  | { type: 'position'; positionMs?: number; buffered?: readonly TimeRange[] }
  | { type: 'tracks'; tracks: EngineTrack[] }
  | { type: 'chapters'; chapters: Chapter[] }
  /** The file's tracks are listed, so the user's picks can apply. */
  | { type: 'loaded' }
  | { type: 'ended' }
  | { type: 'failed'; error: string; retry?: { label: string; run(): void } }
  | { type: 'advanced'; next: QueuedItem }
  /** The user closed the player's own window. */
  | { type: 'closed' }
  | { type: 'subtitle-text'; text: string }
  | { type: 'stats-text'; text: string | undefined };

/** A picture of the keyframe at `positionMs`, for the seek bar. */
export interface Thumbnail {
  positionMs: number;
  src: string;
}

/** A stretch the page offers to skip; `auto` when it skips it unasked. */
export interface PlannedSkip {
  startMs: number;
  endMs: number;
  auto: boolean;
}

/** A player the page drives; the shared player hook does the rest. */
export interface PlayerEngine {
  load(file: EngineFile): void;
  close(): void;
  setPaused(paused: boolean): void;
  /** May land on a keyframe up to `snapMs` away. */
  seek(ms: number, snapMs?: number): void;
  setVolume(volume: number, muted: boolean): void;
  setRate?(rate: number): void;
  setAudio(id: string): void;
  /** One of its own tracks, or a server subtitle. */
  setSubtitle(id: string | null): void;
  setSubtitleDelay?(ms: number): void;
  /** Stretches the page skips, which a player fetching ahead can leave out, or offers to, which it can fetch past early. */
  skipAhead?(skips: PlannedSkip[]): void;
  setStyle?(style: EngineStyle): void;
  toggleFullscreen?(): void;
  /** The text of a subtitle file it was given, null for one it can't read; server ones are read from their address. */
  ownText?(id: string): string | null;
  /** Reports when the lines of one of the file's own subtitles show, as it reads them, until stopped. */
  watchLines?(id: string, onLines: (lines: Span[]) => void): () => void;
  /** Every one of the file's own subtitles' lines from its index, by track; null when it has none. */
  subtitleIndex?(): Promise<Record<string, Span[]> | null>;
  /** Pictures of the keyframes at or before positions asked for, newest asked first; null once the file has none. `prepare` reads the file's index ahead of the first. */
  thumbnails?(
    file: { url: string; headers?: Record<string, string> },
    onThumbnail: (thumbnail: Thumbnail | null) => void
  ): {
    /** `showingMs` is the keyframe of the picture on screen, which isn't sent again. */
    want(ms: number, showingMs?: number): void;
    prepare(): void;
    stop(): void;
  };
  subtitleFiles?: { types: readonly string[]; add(file: File): Promise<void> };
  stats?: { pages: Track[]; show(page: string | null): void };
  /** Picks tracks from the user's settings as the file opens. */
  picksTracks?: boolean;
  /** Lists the file's own subtitles, so the server's copies of them are left out. */
  ownSubtitles?: boolean;
  /** Keeps the device's volume, which the page neither stores nor restores. */
  ownVolume?: boolean;
  /** Follows the page's video fit. */
  fits?: boolean;
  /** The app's sound settings apply. */
  sound?: boolean;
  /** The player in its own window it drives. */
  external?: string;
  closeWindow?(): void;
  queueNext?(next: QueuedItem | null): void;
}

export type EngineFactory = (
  emit: (event: EngineEvent) => void,
  opts: { launched?: { id: string; name: string } }
) => PlayerEngine;
