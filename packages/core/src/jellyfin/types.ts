import type { ParsedFile } from '../db/schemas.js';

/**
 * What a Jellyfin item id stands for. `t` is always the Stremio type used
 * for meta requests; `i` the meta id; `v` the exact video id for episodes.
 */
export type JellyfinDescriptor =
  | { k: 'view'; t: string; c: string }
  | { k: 'genre'; t: string; c: string; g: string }
  | { k: 'movie'; t: string; i: string; p?: string }
  | { k: 'series'; t: string; i: string }
  | { k: 'boxset'; t: string; i: string }
  | { k: 'season'; t: string; i: string; s: number }
  | { k: 'episode'; t: string; i: string; s: number; e: number; v: string }
  | { k: 'person'; n: string }
  | { k: 'source'; h: string };

export type ContentDescriptor = Extract<
  JellyfinDescriptor,
  { k: 'movie' | 'series' | 'boxset' | 'season' | 'episode' }
>;

export interface SubtitleTrack {
  id: string;
  url: string;
  lang: string;
  source: 'stream' | 'addon';
}

/** Additive extension object for AIOStreams-aware clients. */
export interface AiostreamsSourceExtension {
  name: string;
  description: string;
  addon: string;
  service?: string;
  cached?: boolean;
  proxied?: boolean;
  resolution?: string;
  quality?: string;
  encode?: string;
  visualTags: string[];
  audioTags: string[];
  audioChannels: string[];
  languages: string[];
  size?: number;
  seeders?: number;
  age?: number;
  releaseGroup?: string;
  indexer?: string;
  mediaInfoQuality?: string;
  filename?: string;
  type: string;
}

export interface MediaSourceRecord {
  msid: string;
  url: string;
  requestHeaders?: Record<string, string>;
  filename?: string;
  container: string;
  size?: number;
  bitrate?: number;
  durationMs?: number;
  label: string;
  parsedFile?: ParsedFile;
  subtitles: SubtitleTrack[];
  subtitlesEnriched?: boolean;
  videoHash?: string;
  live: boolean;
  extension: AiostreamsSourceExtension;
}

export interface PlaybackMemo {
  uuid: string;
  encryptedPassword: string;
  itemId: string;
  descriptor: ContentDescriptor;
  /** Stremio type and id used for the stream request. */
  type: string;
  videoId: string;
  psid: string;
  sources: MediaSourceRecord[];
  addonSubtitles: SubtitleTrack[];
  runtimeMs?: number;
  createdAt: number;
}

export interface MemoPointer {
  uuid: string;
  encryptedPassword: string;
  itemId: string;
}

export type ImageKind = 'Primary' | 'Backdrop' | 'Logo' | 'Thumb';
export type ItemImages = Partial<Record<ImageKind, string>>;

export interface UserItemDataDto {
  PlaybackPositionTicks: number;
  PlayCount: number;
  IsFavorite: boolean;
  Played: boolean;
  LastPlayedDate?: string;
  PlayedPercentage?: number;
  UnplayedItemCount?: number;
  Key: string;
  ItemId: string;
}

export interface QueryResult<T> {
  Items: T[];
  TotalRecordCount: number;
  StartIndex: number;
}

/** Only the fields we populate; everything else stays absent. */
export interface JellyfinItem {
  Id: string;
  Name: string;
  ServerId: string;
  Type: string;
  IsFolder: boolean;
  [key: string]: unknown;
}

export interface JellyfinMediaStream {
  Index: number;
  Type: 'Video' | 'Audio' | 'Subtitle';
  [key: string]: unknown;
}

export interface JellyfinMediaSource {
  Id: string;
  Name: string;
  Path: string;
  Protocol: string;
  MediaStreams: JellyfinMediaStream[];
  [key: string]: unknown;
}

export interface DeviceProfile {
  SubtitleProfiles?: { Format?: string; Method?: string }[];
  [key: string]: unknown;
}
