import type { Readable } from 'node:stream';

/**
 * The library as a filesystem, independent of the protocol serving it.
 *
 * A provider describes what exists (collections, files, links) and an adapter
 * decides how to express that over the wire. That split matters most for
 * links: WebDAV has no symlink, so the adapter renders one as an `.rclonelink`
 * text file, while NFS or FUSE serve a real one. Nothing above the adapter
 * should know which.
 */

/** A single-range request parsed from an HTTP `Range` header. */
export interface ByteRangeRequest {
  start?: number;
  /** Exclusive end; undefined for open-ended ranges (`bytes=START-`). */
  endExclusive?: number;
  /** Last N bytes (`bytes=-N`); overrides start/end. */
  suffixLength?: number;
}

/** A byte stream opened for one HTTP range response, whatever its source. */
export interface OpenedByteStream {
  /** Readable producing the requested byte range. */
  stream: Readable;
  /** Total size of the file in bytes. */
  size: number;
  /** Inclusive start of the served range. */
  start: number;
  /** Exclusive end of the served range. */
  end: number;
  filename: string;
  /** Strong validator for the resolved file. */
  etag: string;
  lastModified: Date;
}

/**
 * Which providers a caller may see. `library` is the operator's own library
 * behind an operator credential; `user` is reserved for per-configuration
 * trees behind a configuration credential. The two must never share a root.
 */
export type ShareScope = 'library' | 'user';

/** One session's identity, built once by the adapter for the protocol it speaks. */
export interface ShareContext {
  /** Authenticated username; streams are attributed to it. */
  owner: string;
  clientIp?: string;
  /** Defaults to `library`. */
  scope?: ShareScope;
}

/** An open file: positional reads against one held session. */
export interface ShareFileHandle {
  /** Bytes at `[offset, offset + length)`, shorter only at end of file. */
  read(offset: number, length: number, signal?: AbortSignal): Promise<Buffer>;
  /** Like `read`, as views that may carry fsmux release hooks. */
  readv?(
    offset: number,
    length: number,
    signal?: AbortSignal
  ): Promise<Buffer[]>;
  close(): Promise<void>;
}

export type ShareBody =
  | { type: 'inline'; text: string }
  | {
      type: 'stream';
      open(
        range: ByteRangeRequest | undefined,
        signal: AbortSignal
      ): Promise<OpenedByteStream>;
      /** Absent means the tree derives a handle from `open`. */
      openHandle?(signal?: AbortSignal): Promise<ShareFileHandle>;
    };

export type ShareRemoveOutcome = 'removed' | 'missing' | 'denied' | 'failed';

interface ShareNodeBase {
  /** Absolute path within the share root, no trailing slash (`/` for root). */
  path: string;
  name: string;
  modified: Date;
  /** Stable 64-bit identity; defaults to a hash of `path`. */
  id?: bigint;
  /** Present when a client may remove the node. */
  remove?(): Promise<ShareRemoveOutcome>;
}

export interface ShareCollection extends ShareNodeBase {
  kind: 'collection';
  children(): Promise<ShareNode[]>;
  /** One child by name; absent means the tree resolves `path/name` instead. */
  child?(name: string): Promise<ShareNode | undefined>;
}

export interface ShareFile extends ShareNodeBase {
  kind: 'file';
  size: number;
  etag: string;
  contentType: string;
  body: ShareBody;
}

/**
 * A symbolic link to somewhere else in the tree. `target` is the absolute
 * path as the machine reading the mount sees it, not a path within the share:
 * a consumer copies the link into its own library and resolves it there, so a
 * share-relative target would dangle.
 */
export interface ShareLink extends ShareNodeBase {
  kind: 'link';
  target: string;
}

export type ShareNode = ShareCollection | ShareFile | ShareLink;

/** Owns one top-level subtree of the share root (`/<name>/...`). */
export interface ShareProvider {
  name: string;
  /** Defaults to `library`. */
  scope?: ShareScope;
  /** Resolve a path below the provider root; `[]` is the root itself. */
  resolve(
    segments: string[],
    ctx: ShareContext
  ): Promise<ShareNode | undefined>;
}
