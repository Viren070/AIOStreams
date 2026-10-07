import type { BaseItemDto, SourceInfo } from '../types';

export type DownloadState =
  | 'finding'
  | 'needs-version'
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'failed'
  | 'done'
  /** Handed to an app that downloads on its own and reports nothing back. */
  | 'sent';

/** A file for the host to fetch, at a path relative to its downloads folder. */
export interface HostFile {
  url: string;
  path: string;
  kind: 'video' | 'subtitle' | 'image';
}

/** What the host needs to fetch a download, without the page. */
export interface HostJob {
  id: string;
  title: string;
  versionId: string;
  files: HostFile[];
  /** Files the page writes itself, such as the item's details. */
  texts: { path: string; text: string }[];
}

export interface Download {
  id: string;
  base: string;
  userId: string;
  item: BaseItemDto;
  /** Added together, as a season or show is. */
  batch?: string;
  /** Its version's binge group is the one the rest of its batch follows. */
  leader?: boolean;
  /** The binge group to match; null matches none, undefined waits on the leader. */
  group?: string | null;
  version?: { id: string; label: string; size?: number };
  state: DownloadState;
  bytes: number;
  total?: number;
  error?: string;
  /** Set once a version is chosen. */
  job?: HostJob;
  /** The version without its addresses, to play the file from. */
  source?: SourceInfo;
  /** The `Index` of each subtitle stream saved, in the order the host lists their files. */
  subtitleStreams?: number[];
  /** Where the host saved the video and subtitles, once done. */
  local?: { video: string; subtitles: string[] };
  addedAt: number;
}

export type HostEvent =
  | {
      type: 'state';
      folder: string;
      jobs: {
        id: string;
        state: 'queued' | 'downloading' | 'paused' | 'failed' | 'done';
        bytes: number;
        total: number | null;
        error: string | null;
        video?: string | null;
        subtitles?: string[];
      }[];
    }
  | {
      type: 'progress';
      id: string;
      bytes: number;
      total: number | null;
      speed: number;
    };

/** An app that fetches files for the page and keeps them on the device. */
export interface DownloadsHost {
  add(jobs: HostJob[]): void;
  control(id: string, action: 'pause' | 'resume' | 'retry'): void;
  remove(id: string, files: boolean): void;
  /** Asks for a `state` event. */
  list(): void;
  configure(opts: { concurrent: number }): void;
  subscribe(listener: (event: HostEvent) => void): () => void;
  /** Picks and shows the folder; the folder's own name comes in `state`. */
  folder?: { choose(): void; open(id?: string): void };
  /** Takes downloads over entirely, with a screen of its own to show them. */
  handsOff?: { open(): void };
}
