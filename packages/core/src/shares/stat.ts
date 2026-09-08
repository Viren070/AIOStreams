import { createHash } from 'node:crypto';
import type { ShareNode } from './types.js';

/** What a POSIX-shaped protocol needs to describe a node. */
export interface ShareStat {
  /** Inode / fileid. */
  id: bigint;
  /** Full `st_mode`, type bits included. */
  mode: number;
  nlink: number;
  size: number;
  modified: Date;
}

/** FUSE requires the root to be inode 1. */
export const SHARE_ROOT_ID = 1n;

// 0644, not 0444: the arrs chmod a read-only *source* before every move
// (RemoveReadOnly), and the mount refuses setattr. Writes are refused by the
// operations themselves, so the write bit grants nothing.
export const SHARE_MODE_FILE = 0o100644;
export const SHARE_MODE_DIR = 0o040555;
export const SHARE_MODE_LINK = 0o120777;

/** 64-bit identity of a path, stable across restarts. */
export function sharePathId(path: string): bigint {
  if (path === '/' || path === '') return SHARE_ROOT_ID;
  const id = createHash('sha1').update(path).digest().readBigUInt64BE(0);
  // 0 and 1 are reserved (invalid inode, root).
  return id < 2n ? id + 2n : id;
}

export function shareNodeId(node: ShareNode): bigint {
  return node.id ?? sharePathId(node.path);
}

export function shareNodeStat(node: ShareNode): ShareStat {
  const id = shareNodeId(node);
  switch (node.kind) {
    case 'collection':
      return {
        id,
        mode: SHARE_MODE_DIR,
        nlink: 2,
        size: 0,
        modified: node.modified,
      };
    case 'file':
      return {
        id,
        mode: SHARE_MODE_FILE,
        nlink: 1,
        size: node.size,
        modified: node.modified,
      };
    case 'link':
      return {
        id,
        mode: SHARE_MODE_LINK,
        nlink: 1,
        size: Buffer.byteLength(node.target),
        modified: node.modified,
      };
  }
}
