import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Only the fetch is under test. The rest of the route's imports load the
// whole core, which needs a configured environment.
vi.mock('@aiostreams/core', () => ({
  Cache: { getInstance: () => ({}) },
  createLogger: () => ({ debug: () => undefined }),
  readBodyCapped: async (res: Response) => Buffer.from(await res.arrayBuffer()),
  convertSubtitle: vi.fn(),
  externalSubtitleFor: vi.fn(),
  subtitleExtensionOf: vi.fn(),
}));
vi.mock('./context.js', () => ({
  jfOptional: (handler: unknown) => handler,
  param: vi.fn(),
}));
vi.mock('./playback.js', () => ({
  ensureMemo: vi.fn(),
  locate: vi.fn(),
  pickSource: vi.fn(),
}));

const { fetchSubtitle } = await import('./subtitles.js');

let provider: Server;
let base: string;

beforeAll(async () => {
  provider = createServer((req, res) => {
    const status = Number(req.url?.slice(1)) || 200;
    res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.end(status === 200 ? '1\n00:00:01,000 --> 00:00:02,000\nHi\n' : '');
  });
  await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
});

afterAll(() => {
  provider.close();
});

describe('fetchSubtitle', () => {
  it('returns the file', async () => {
    const fetched = await fetchSubtitle(`${base}/200`);
    expect(fetched).toMatchObject({ cacheable: true });
    expect('raw' in fetched && fetched.raw).toContain('Hi');
  });

  // A client retries a 5xx, and these answers won't change on a retry.
  for (const status of [401, 403, 404, 410]) {
    it(`answers 404 when the provider answers ${status}`, async () => {
      expect(await fetchSubtitle(`${base}/${status}`)).toEqual({ status: 404 });
    });
  }

  for (const status of [408, 429, 500, 503]) {
    it(`answers 502 when the provider answers ${status}`, async () => {
      expect(await fetchSubtitle(`${base}/${status}`)).toEqual({ status: 502 });
    });
  }

  it('answers 502 when the provider is unreachable', async () => {
    expect(await fetchSubtitle('http://127.0.0.1:1/x.srt')).toEqual({
      status: 502,
    });
  });
});
