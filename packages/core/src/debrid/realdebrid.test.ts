import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { mapRealDebridStatus, RealDebridService } from './realdebrid.js';
import { DebridError } from './base.js';
import { initDb } from '../db/index.js';
import { initialiseConfig } from '../config/index.js';

// resolve() uses the shared Cache / DistributedLock and runtime config, which
// need a database and an initialised config. Set both up once, on a throwaway
// SQLite DB, before the resolve test runs.
before(async () => {
  const dbFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'aiostreams-rd-test-')),
    'test.db'
  );
  await initDb(`sqlite://${dbFile}`);
  await initialiseConfig();
});

test('mapRealDebridStatus maps RealDebrid torrent status to DebridDownload status', () => {
  const cases: Array<[string, string]> = [
    ['downloaded', 'downloaded'],
    ['downloading', 'downloading'],
    ['queued', 'queued'],
    ['magnet_conversion', 'processing'],
    ['waiting_files_selection', 'queued'],
    ['compressing', 'downloading'],
    ['uploading', 'uploading'],
    ['magnet_error', 'failed'],
    ['error', 'failed'],
    ['virus', 'failed'],
    ['dead', 'failed'],
    ['something_unexpected', 'unknown'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(
      mapRealDebridStatus(input),
      expected,
      `expected ${input} -> ${expected}`
    );
  }
});

// --- Mock RealDebrid REST server ---------------------------------------------

interface RecordedRequest {
  method: string;
  path: string;
  auth?: string;
  body: string;
}

type Route = (req: RecordedRequest, res: http.ServerResponse) => void;

function startMockRd(routes: Record<string, Route>): Promise<{
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        auth: req.headers['authorization'] as string | undefined,
        body: Buffer.concat(chunks).toString('utf-8'),
      };
      requests.push(recorded);
      // Match by "METHOD /path" with a trailing "/*" wildcard fallback.
      const exact = `${recorded.method} ${url.pathname}`;
      const route =
        routes[exact] ??
        routes[
          Object.keys(routes).find((k) => {
            const [m, p] = k.split(' ');
            return (
              m === recorded.method &&
              p.endsWith('/*') &&
              url.pathname.startsWith(p.slice(0, -1))
            );
          }) ?? ''
        ];
      if (!route) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found', error_code: 7 }));
        return;
      }
      route(recorded, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

test('getMagnet maps torrents/info into a DebridDownload with per-file links', async () => {
  const mock = await startMockRd({
    'GET /rest/1.0/torrents/info/*': (_req, res) =>
      json(res, 200, {
        id: 'ABC123',
        hash: 'aabbccddeeff',
        filename: 'My.Show.S01',
        bytes: 3000,
        original_bytes: 4000,
        status: 'downloaded',
        progress: 100,
        added: '2024-01-01T00:00:00.000Z',
        files: [
          { id: 1, path: '/My.Show.S01/ep1.mkv', bytes: 1000, selected: 1 },
          { id: 2, path: '/My.Show.S01/sample.mkv', bytes: 500, selected: 0 },
          { id: 3, path: '/My.Show.S01/ep2.mkv', bytes: 2000, selected: 1 },
        ],
        // One link per SELECTED file, in file order.
        links: ['https://rd/d/LINK1', 'https://rd/d/LINK3'],
      }),
  });

  const svc = new RealDebridService({
    baseUrl: mock.baseUrl,
    token: 'tok',
  });

  const dl = await svc.getMagnet('ABC123');
  await mock.close();

  assert.equal(dl.id, 'ABC123');
  assert.equal(dl.hash, 'aabbccddeeff');
  assert.equal(dl.status, 'downloaded');
  assert.equal(dl.size, 4000);

  // Only selected files carry links, paired in order.
  const selected = (dl.files ?? []).filter((f) => f.link);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].index, 0); // file id 1 -> 0-based index 0
  assert.equal(selected[0].link, 'https://rd/d/LINK1');
  assert.equal(selected[0].name, 'ep1.mkv');
  assert.equal(selected[0].size, 1000);
  assert.equal(selected[1].index, 2); // file id 3 -> 0-based index 2
  assert.equal(selected[1].link, 'https://rd/d/LINK3');

  // Auth header is sent.
  assert.equal(mock.requests[0].auth, 'Bearer tok');
});

test('getMagnet pairs links to selected files by ascending file id even when files arrive out of order', async () => {
  const mock = await startMockRd({
    'GET /rest/1.0/torrents/info/*': (_req, res) =>
      json(res, 200, {
        id: 'OOO',
        hash: 'aa',
        filename: 'Show',
        bytes: 3000,
        original_bytes: 3000,
        status: 'downloaded',
        // Deliberately unsorted; a compatible server may not sort by id.
        files: [
          { id: 3, path: '/Show/ep2.mkv', bytes: 2000, selected: 1 },
          { id: 1, path: '/Show/ep1.mkv', bytes: 1000, selected: 1 },
          { id: 2, path: '/Show/sample.mkv', bytes: 500, selected: 0 },
        ],
        // links[] correspond to selected files in ascending-id order:
        // id 1 -> LINK1, id 3 -> LINK3.
        links: ['https://rd/d/LINK1', 'https://rd/d/LINK3'],
      }),
  });
  const svc = new RealDebridService({ baseUrl: mock.baseUrl, token: 'tok' });
  const dl = await svc.getMagnet('OOO');
  await mock.close();

  const byIndex = Object.fromEntries((dl.files ?? []).map((f) => [f.index, f]));
  assert.equal(byIndex[0].link, 'https://rd/d/LINK1'); // id 1
  assert.equal(byIndex[2].link, 'https://rd/d/LINK3'); // id 3
  assert.equal(byIndex[1].link, undefined); // id 2 not selected
});

test('addMagnet adds the magnet, selects files, and returns the download', async () => {
  const mock = await startMockRd({
    'POST /rest/1.0/torrents/addMagnet': (req, res) => {
      assert.match(req.body, /magnet=/);
      json(res, 201, { id: 'NEWID', uri: '/rest/1.0/torrents/info/NEWID' });
    },
    'POST /rest/1.0/torrents/selectFiles/*': (req, res) => {
      assert.equal(req.body, 'files=all');
      res.writeHead(204);
      res.end();
    },
    'GET /rest/1.0/torrents/info/*': (_req, res) =>
      json(res, 200, {
        id: 'NEWID',
        hash: 'ffee',
        filename: 'movie.mkv',
        bytes: 100,
        original_bytes: 100,
        status: 'downloading',
        files: [{ id: 1, path: '/movie.mkv', bytes: 100, selected: 1 }],
        links: [],
      }),
  });

  const svc = new RealDebridService({ baseUrl: mock.baseUrl, token: 'tok' });
  const dl = await svc.addMagnet('magnet:?xt=urn:btih:ffee&dn=movie');
  await mock.close();

  assert.equal(dl.id, 'NEWID');
  assert.equal(dl.status, 'downloading');

  const methodsAndPaths = mock.requests.map((r) => `${r.method} ${r.path}`);
  // Order matters: add, then select, then info.
  assert.deepEqual(methodsAndPaths, [
    'POST /rest/1.0/torrents/addMagnet',
    'POST /rest/1.0/torrents/selectFiles/NEWID',
    'GET /rest/1.0/torrents/info/NEWID',
  ]);
});

test('generateTorrentLink unrestricts a link and returns the direct download URL', async () => {
  const mock = await startMockRd({
    'POST /rest/1.0/unrestrict/link': (req, res) => {
      assert.match(req.body, /link=/);
      json(res, 200, {
        id: 'X',
        filename: 'ep1.mkv',
        filesize: 1000,
        download: 'https://rd/dl/direct/ep1.mkv',
        streamable: 1,
      });
    },
  });
  const svc = new RealDebridService({ baseUrl: mock.baseUrl, token: 'tok' });
  const url = await svc.generateTorrentLink('https://rd/d/LINK1');
  await mock.close();
  assert.equal(url, 'https://rd/dl/direct/ep1.mkv');
});

test('removeMagnet issues a DELETE for the torrent', async () => {
  const mock = await startMockRd({
    'DELETE /rest/1.0/torrents/delete/*': (_req, res) => {
      res.writeHead(204);
      res.end();
    },
  });
  const svc = new RealDebridService({ baseUrl: mock.baseUrl, token: 'tok' });
  await svc.removeMagnet('ABC123');
  await mock.close();
  assert.equal(mock.requests[0].method, 'DELETE');
  assert.equal(mock.requests[0].path, '/rest/1.0/torrents/delete/ABC123');
});

test('listMagnets maps the torrents list', async () => {
  const mock = await startMockRd({
    'GET /rest/1.0/torrents': (_req, res) =>
      json(res, 200, [
        {
          id: 'A',
          hash: 'h1',
          filename: 'a',
          bytes: 1,
          status: 'downloaded',
        },
        {
          id: 'B',
          hash: 'h2',
          filename: 'b',
          bytes: 2,
          status: 'downloading',
        },
      ]),
  });
  const svc = new RealDebridService({ baseUrl: mock.baseUrl, token: 'tok' });
  const list = await svc.listMagnets();
  await mock.close();
  assert.equal(list.length, 2);
  assert.equal(list[0].hash, 'h1');
  assert.equal(list[0].status, 'downloaded');
  assert.equal(list[0].library, true);
});

test('checkMagnets reports cached only for hashes already downloaded in the library', async () => {
  const mock = await startMockRd({
    'GET /rest/1.0/torrents': (_req, res) =>
      json(res, 200, [
        {
          id: 'A',
          hash: 'aaaa',
          filename: 'a',
          bytes: 1,
          status: 'downloaded',
        },
        {
          id: 'B',
          hash: 'bbbb',
          filename: 'b',
          bytes: 2,
          status: 'downloading',
        },
      ]),
  });
  const svc = new RealDebridService({ baseUrl: mock.baseUrl, token: 'tok' });
  const results = await svc.checkMagnets(['aaaa', 'bbbb', 'cccc']);
  await mock.close();

  const byHash = Object.fromEntries(results.map((r) => [r.hash, r.status]));
  assert.equal(byHash['aaaa'], 'cached'); // downloaded in library
  assert.notEqual(byHash['bbbb'], 'cached'); // present but still downloading
  assert.notEqual(byHash['cccc'], 'cached'); // not in library at all
});

test('resolve adds a magnet, selects the file by index, and returns a playback link', async () => {
  const mock = await startMockRd({
    'POST /rest/1.0/torrents/addMagnet': (_req, res) =>
      json(res, 201, { id: 'RID', uri: '/rest/1.0/torrents/info/RID' }),
    'POST /rest/1.0/torrents/selectFiles/*': (_req, res) => {
      res.writeHead(204);
      res.end();
    },
    'GET /rest/1.0/torrents/info/*': (_req, res) =>
      json(res, 200, {
        id: 'RID',
        hash: 'deadbeef',
        filename: 'Show.S01',
        bytes: 3000,
        original_bytes: 3000,
        status: 'downloaded',
        files: [
          { id: 1, path: '/Show.S01/ep1.mkv', bytes: 1000, selected: 1 },
          { id: 2, path: '/Show.S01/ep2.mkv', bytes: 2000, selected: 1 },
        ],
        links: ['https://rd/d/L1', 'https://rd/d/L2'],
      }),
    'POST /rest/1.0/unrestrict/link': (req, res) => {
      // Should unrestrict the SECOND file's link (fileIndex 1).
      assert.match(decodeURIComponent(req.body), /https:\/\/rd\/d\/L2/);
      json(res, 200, { download: 'https://rd/dl/ep2.mkv' });
    },
  });

  const svc = new RealDebridService({ baseUrl: mock.baseUrl, token: 'tok' });
  const link = await svc.resolve(
    {
      type: 'torrent',
      hash: 'deadbeef',
      sources: [],
      fileIndex: 1,
    } as any,
    'ep2.mkv',
    true
  );
  await mock.close();
  assert.equal(link, 'https://rd/dl/ep2.mkv');
});

test('request errors are converted to DebridError with a mapped code', async () => {
  const mock = await startMockRd({
    'GET /rest/1.0/torrents/info/*': (_req, res) =>
      json(res, 401, { error: 'bad_token', error_code: 8 }),
  });
  const svc = new RealDebridService({ baseUrl: mock.baseUrl, token: 'bad' });
  await assert.rejects(
    () => svc.getMagnet('ABC'),
    (err: unknown) => {
      assert.ok(err instanceof DebridError);
      assert.equal((err as DebridError).code, 'UNAUTHORIZED');
      assert.equal((err as DebridError).statusCode, 401);
      return true;
    }
  );
  await mock.close();
});
