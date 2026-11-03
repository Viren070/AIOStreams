import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The media lookups find a source with one external subtitle, whose URL each
// test sets. Loading the real core needs a configured environment.
vi.mock('@aiostreams/core', () => ({
  Cache: {
    getInstance: () => ({
      get: async () => undefined,
      set: async () => undefined,
    }),
  },
  createLogger: () => ({ debug: () => undefined }),
  readBodyCapped: async (res: Response) => Buffer.from(await res.arrayBuffer()),
  convertSubtitle: (raw: string) => ({ body: raw, contentType: 'text/plain' }),
  externalSubtitleFor: vi.fn(),
  subtitleExtensionOf: () => 'srt',
}));
vi.mock('./context.js', () => ({
  jfOptional: (handler: unknown) => handler,
  param: (req: { params: Record<string, string> }, name: string) =>
    req.params[name] ?? '',
}));
vi.mock('./playback.js', () => ({
  ensureMemo: async () => ({}),
  locate: async () => ({}),
  pickSource: () => ({}),
}));

const core = await import('@aiostreams/core');
const { default: router, fetchSubtitle } = await import('./subtitles.js');

let provider: Server;
let base: string;
let aio: Server;
let route: string;

const listen = async (server: Server) => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

beforeAll(async () => {
  provider = createServer((req, res) => {
    const status = Number(req.url?.slice(1)) || 200;
    res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.end(status === 200 ? '1\n00:00:01,000 --> 00:00:02,000\nHi\n' : '');
  });
  base = await listen(provider);
  aio = createServer(express().use(router));
  route = `${await listen(aio)}/Videos/item/source/Subtitles/1000/Stream.srt`;
});

afterAll(() => {
  provider.close();
  aio.close();
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

describe('subtitle route', () => {
  const request = (providerStatus: number) => {
    vi.mocked(core.externalSubtitleFor).mockReturnValue({
      url: `${base}/${providerStatus}`,
    } as never);
    return fetch(route);
  };

  it('sends the subtitle', async () => {
    const res = await request(200);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Hi');
  });

  it('answers 404 when the provider answers 401', async () => {
    expect((await request(401)).status).toBe(404);
  });

  it('answers 502 when the provider answers 503', async () => {
    expect((await request(503)).status).toBe(502);
  });
});
