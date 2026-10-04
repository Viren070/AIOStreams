import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Readable } from 'node:stream';

export interface FileReader {
  size: number;
  /** Bytes `[start, end)`. */
  open(start: number, end: number, signal: AbortSignal): Promise<Readable>;
  onRead?(bytes: number): void;
}

function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | null | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    return { start: Math.max(0, size - Number(match[2])), end: size };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(size, Number(match[2]) + 1) : size;
  return start < end ? { start, end } : null;
}

async function serve(
  file: FileReader,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const range = parseRange(req.headers.range, file.size);
  if (range === null) {
    res.writeHead(416, { 'Content-Range': `bytes */${file.size}` }).end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? file.size;
  res.writeHead(range ? 206 : 200, {
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start),
    ...(range
      ? { 'Content-Range': `bytes ${start}-${end - 1}/${file.size}` }
      : {}),
  });
  if (req.method === 'HEAD' || start === end) {
    res.end();
    return;
  }
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  const stream = await file.open(start, end, abort.signal);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  if (file.onRead) {
    stream.on('data', (chunk: Buffer) => file.onRead?.(chunk.length));
  }
}

/**
 * Serve one file over HTTP on a random loopback port and path while `use`
 * runs, so ffprobe can seek in it.
 */
export async function withLoopbackUrl<T>(
  file: FileReader,
  use: (url: string) => Promise<T>
): Promise<T> {
  const path = `/${randomBytes(16).toString('hex')}`;
  const server = createServer((req, res) => {
    if (req.url !== path || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404).end();
      return;
    }
    serve(file, req, res).catch(() => {
      if (res.headersSent) res.destroy();
      else res.writeHead(502).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = server.address() as AddressInfo;
    return await use(`http://127.0.0.1:${port}${path}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
