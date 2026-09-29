import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { DebridError } from '../base.js';
import type { ByteRangeRequest, OpenedByteStream } from '../../shares/types.js';
import { createLogger } from '../../utils/index.js';
import { QBittorrentClient } from './client.js';
import { computeFileAvailability } from './availability.js';
import { QbittorrentStreamToken, decodeQbittorrentStreamToken } from './tokens.js';

const logger = createLogger('debrid:qbittorrent');

const AVAILABILITY_POLL_MS = 2_000;
const AVAILABILITY_WAIT_MS = 30_000;

interface Snapshot {
  complete: boolean;
  contiguousFrom: (start: number) => number;
  rangeAvailable: (start: number, end: number) => boolean;
}

async function snapshot(
  client: QBittorrentClient,
  token: QbittorrentStreamToken,
  signal?: AbortSignal
): Promise<Snapshot> {
  const torrent = await client.getTorrent(token.hash, signal);
  if (!torrent) {
    throw new DebridError('qBittorrent no longer has this torrent', {
      statusCode: 404,
      statusText: 'Not Found',
      code: 'NOT_FOUND',
      type: 'api_error',
      headers: {},
    });
  }
  const files = await client.getFiles(token.hash, signal);
  const file = files.find((f) => f.index === token.fileIndex);
  if (!file) {
    throw new DebridError('Torrent no longer contains the selected file', {
      statusCode: 400,
      statusText: 'Bad Request',
      code: 'NO_MATCHING_FILE',
      type: 'api_error',
      headers: {},
    });
  }
  const [pieceSize, pieceStates] = await Promise.all([
    client.getPieceSize(token.hash, signal),
    client.getPieceStates(token.hash, signal),
  ]);
  const availability = computeFileAvailability({
    files,
    fileIndex: token.fileIndex,
    pieceStates,
    pieceSize,
  });
  return {
    complete: availability.complete,
    contiguousFrom: (start) => availability.contiguousFrom(start),
    rangeAvailable: (start, end) => availability.rangeAvailable(start, end),
  };
}

 * Open a byte range on a possibly still-downloading file. Full size is
 * always advertised, unwritten regions are never read.
export async function openQbittorrentStream(opts: {
  token: string;
  range?: ByteRangeRequest;
  signal?: AbortSignal;
}): Promise<OpenedByteStream> {
  opts.signal?.throwIfAborted();
  const token = decodeQbittorrentStreamToken(opts.token);
  if (!token) {
    throw new DebridError('invalid or tampered qBittorrent stream token', {
      statusCode: 400,
      statusText: 'Bad Request',
      code: 'BAD_REQUEST',
      headers: {},
      body: null,
      type: 'api_error',
    });
  }

  const client = new QBittorrentClient(token.credential);
  let state = await snapshot(client, token, opts.signal);

  const start = opts.range?.suffixLength
    ? Math.max(0, token.fileSize - opts.range.suffixLength)
    : (opts.range?.start ?? 0);
  let end = opts.range?.endExclusive ?? token.fileSize;
  end = Math.min(end, token.fileSize);

  if (!state.complete) {
    if (!state.rangeAvailable(start, end)) {
      const contiguous = state.contiguousFrom(start);
      if (contiguous > start) {
        end = contiguous;
      } else {
        const deadline = Date.now() + AVAILABILITY_WAIT_MS;
        while (Date.now() < deadline && !opts.signal?.aborted) {
          await new Promise((resolve) =>
            setTimeout(resolve, AVAILABILITY_POLL_MS)
          );
          state = await snapshot(client, token, opts.signal);
          if (state.complete || state.rangeAvailable(start, end)) break;
          const frontier = state.contiguousFrom(start);
          if (frontier > start) {
            end = frontier;
            break;
          }
        }
        if (!state.complete && !state.rangeAvailable(start, end) && end <= start) {
          if (!opts.range) {
            throw new DebridError(
              'qBittorrent has not downloaded any of this file yet',
              {
                statusCode: 503,
                statusText: 'Service Unavailable',
                code: 'SERVICE_UNAVAILABLE',
                type: 'api_error',
                headers: {},
              }
            );
          }
          // An empty stream whose size is the downloaded prefix makes
          // serveRangeStream answer with a standards-shaped 416.
          return {
            stream: Readable.from([]),
            size: Math.max(0, state.contiguousFrom(0)),
            start,
            end: start,
            filename: token.filename,
            etag: `"qbit-${token.hash}-${token.fileIndex}-${token.fileSize}"`,
            lastModified: new Date(token.addedAt * 1000),
          };
        }
      }
    }
  }

  const stream = createReadStream(token.filePath, { start, end: end - 1 });
  return {
    stream,
    size: token.fileSize,
    start,
    end,
    filename: token.filename,
    // Stable while the file grows, which a content hash would not be.
    etag: `"qbit-${token.hash}-${token.fileIndex}-${token.fileSize}"`,
    lastModified: new Date(token.addedAt * 1000),
  };
}
