import type {
  BaseItemDto,
  MediaSourceInfo,
  SessionInfoDto,
  UserDto,
} from '@jellyfin/sdk/lib/generated-client/models';
import type { AiostreamsSourceExtension } from '@aiostreams/core';

export type {
  AuthenticationResult,
  BaseItemDto,
  BaseItemDtoQueryResult,
  BaseItemPerson,
  MediaSegmentDto,
  MediaSegmentDtoQueryResult,
  MediaStream,
  PlaybackInfoResponse,
  QuickConnectResult,
  SessionInfoDto,
  UserDto,
} from '@jellyfin/sdk/lib/generated-client/models';

/** A media source with the parsed stream details this server adds. */
export type SourceInfo = MediaSourceInfo & {
  aiostreams?: AiostreamsSourceExtension;
};

export interface HistoryCounts {
  played: number;
  movies: number;
  episodes: number;
  inProgress: number;
  favorites: number;
  lastAt: number | null;
}

export interface WebUser {
  user: UserDto;
  avatar: string | null;
  hidden: boolean;
  locked: boolean;
  /** The user whose history this one reads and writes. */
  historyOf: string;
  /** Null when the history belongs to another user. */
  counts: HistoryCounts | null;
}

/** The configuration's own name and logo, where it has them. */
export interface Branding {
  name: string | null;
  logo: string | null;
}

/** A user the picker offers, and what switching to it asks for. */
export interface PickableUser {
  user: UserDto;
  avatar: string | null;
  hidden: boolean;
  /** `password-pin` is sent as `<password>/<pin>`. */
  needs: 'pin' | 'password' | 'password-pin' | null;
}

export interface WebActivity {
  users: WebUser[];
  sessions: SessionInfoDto[];
}

export interface HistoryEntry {
  userId: string;
  itemKey: string;
  kind: 'movie' | 'series' | 'episode';
  played: boolean;
  playCount: number;
  positionMs: number;
  durationMs: number;
  favorite: boolean;
  lastPlayedAt: number | null;
  sortAt: number;
  /** Null where the server does not say. */
  origin: 'local' | 'import' | null;
  tracker: string | null;
  item: BaseItemDto;
}

export interface HistoryPage {
  items: HistoryEntry[];
  cursor: string | null;
}
