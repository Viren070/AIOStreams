import { Readable } from 'node:stream';
import {
  resolveRange,
  type FsByteRange,
  type FsFileHandle,
  type FsNode,
  type FsOpenedStream,
  type FsRemoveOutcome,
  type SharedFilesystem,
} from '@viren070/fsmux';
import { ShareError, assertNever } from './errors.js';
import { openShareFileHandle } from './handle.js';
import { shareNodeStat } from './stat.js';
import { lookupShareChild, resolveShareNodePath } from './tree.js';
import type {
  ShareCollection,
  ShareContext,
  ShareFile,
  ShareNode,
} from './types.js';

const SHARE = Symbol('shareNode');

type TreeFsNode = FsNode & { [SHARE]: ShareNode };

function fsNode(node: ShareNode): TreeFsNode {
  const stat = shareNodeStat(node);
  return {
    kind: node.kind === 'collection' ? 'dir' : node.kind,
    path: node.path,
    name: node.name,
    id: stat.id,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    modified: stat.modified,
    target: node.kind === 'link' ? node.target : undefined,
    removable: node.remove !== undefined,
    etag: node.kind === 'file' ? node.etag : undefined,
    contentType: node.kind === 'file' ? node.contentType : undefined,
    [SHARE]: node,
  };
}

function shareOf(node: FsNode): ShareNode {
  const share = (node as TreeFsNode)[SHARE];
  if (!share) throw new Error('not a share tree node');
  return share;
}

/**
 * The share tree as the filesystem the protocol servers export, for one
 * session identity. A protocol with no login of its own passes the
 * configured identity; the peer address is carried per open so streams are
 * still attributed to the machine reading them.
 */
export function shareFilesystem(ctx: ShareContext): SharedFilesystem {
  async function fileFor(
    file: FsNode,
    peer: string | undefined
  ): Promise<ShareFile> {
    const node =
      peer && peer !== ctx.clientIp
        ? await resolveShareNodePath(file.path, { ...ctx, clientIp: peer })
        : shareOf(file);
    if (!node || node.kind !== 'file') {
      throw new ShareError('NotFound', 'file is gone');
    }
    return node;
  }

  return {
    async resolve(path) {
      const node = await resolveShareNodePath(path, ctx);
      return node && fsNode(node);
    },
    async lookup(dir, name) {
      const parent = shareOf(dir);
      if (parent.kind !== 'collection') return undefined;
      const child = await lookupShareChild(parent, name, ctx);
      return child && fsNode(child);
    },
    async readdir(dir) {
      const parent = shareOf(dir) as ShareCollection;
      return (await parent.children()).map(fsNode);
    },
    async open(file, opts): Promise<FsFileHandle> {
      return openShareFileHandle(await fileFor(file, opts?.peer));
    },
    async openStream(file, range, signal, opts): Promise<FsOpenedStream> {
      const { body } = await fileFor(file, opts?.peer);
      switch (body.type) {
        case 'inline': {
          const bytes = Buffer.from(body.text);
          const { start, end } = resolveRange(
            range as FsByteRange,
            bytes.length
          );
          return {
            stream: Readable.from([bytes.subarray(start, end)]),
            size: bytes.length,
            start,
            end,
          };
        }
        case 'stream': {
          const opened = await body.open(range, signal);
          return {
            stream: opened.stream,
            size: opened.size,
            start: opened.start,
            end: opened.end,
          };
        }
        default:
          return assertNever(body);
      }
    },
    async remove(node): Promise<FsRemoveOutcome> {
      const share = shareOf(node);
      return share.remove ? share.remove() : 'denied';
    },
  };
}
