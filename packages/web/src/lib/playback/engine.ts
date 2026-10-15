import type { SubtitleStyle, VideoFit } from '../settings';
import type { SubtitleLine } from '../subtitles/cues';
import type { BaseItemDto, MediaStream, SourceInfo } from '../types';
import type { PlaybackPrefs } from '../user-config';
import type { Chapter } from './chapters';
import type { PlayerState, QueuedEpisode, Track } from './controller';

/** One of the server's external subtitles, which an engine loads once picked. */
export interface ServerSubtitle extends Track {
  url: string;
  stream: MediaStream;
}

export interface EngineTrack extends Track {
  type: 'audio' | 'subtitle';
  title?: string;
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
  >
>;

export type EngineEvent =
  | { type: 'state'; state: EngineState }
  | { type: 'position'; positionMs?: number; bufferedMs?: number }
  | { type: 'tracks'; tracks: EngineTrack[] }
  | { type: 'chapters'; chapters: Chapter[] }
  /** The file's tracks are listed, so the user's picks can apply. */
  | { type: 'loaded' }
  | { type: 'ended' }
  | { type: 'failed'; error: string; retry?: { label: string; run(): void } }
  | { type: 'advanced'; episode: QueuedEpisode }
  /** The user closed the player's own window. */
  | { type: 'closed' }
  | { type: 'subtitle-text'; text: string }
  | { type: 'stats-text'; text: string | undefined };

/** A player the page drives; the shared player hook does the rest. */
export interface PlayerEngine {
  load(file: EngineFile): void;
  close(): void;
  setPaused(paused: boolean): void;
  seek(ms: number): void;
  setVolume(volume: number, muted: boolean): void;
  setRate?(rate: number): void;
  setAudio(id: string): void;
  /** One of its own tracks, or a server subtitle. */
  setSubtitle(id: string | null): void;
  setSubtitleDelay?(ms: number): void;
  setStyle?(style: EngineStyle): void;
  toggleFullscreen?(): void;
  /** Lines of one of its own subtitles; server ones are read from their address. */
  ownLines?(id: string): Promise<SubtitleLine[] | null> | null;
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
  queueNext?(episode: QueuedEpisode): void;
}

export type EngineFactory = (
  emit: (event: EngineEvent) => void,
  opts: { launched?: { id: string; name: string } }
) => PlayerEngine;
