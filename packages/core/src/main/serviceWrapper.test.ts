import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Addon, ParsedStream, UserData } from '../db/schemas.js';
import type { StreamContext } from '../streams/context.js';

// A stand-in StremThru that fails every request, or never answers.
let mode: 'error' | 'hang' = 'error';
const hanging: http.ServerResponse[] = [];
const server = http.createServer((_req, res) => {
  if (mode === 'hang') {
    hanging.push(res);
    return;
  }
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'store unavailable' } }));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.BUILTIN_STREMTHRU_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// Import after the env var is set so the config picks up the fake StremThru.
await import('../index.js');
const { settingsStore } = await import('../config/index.js');
const { SettingsRepository } = await import('../db/repositories/settings.js');
const { resolveServiceWrappedStreams } = await import('./serviceWrapper.js');

mock.method(SettingsRepository, 'getAll', async () => []);
mock.method(SettingsRepository, 'getVersion', async () => 0);
await settingsStore.initialise();

const context = {
  id: 'tt0000001',
  parsedId: {},
  getMetadata: async () => undefined,
} as unknown as StreamContext;

function makeP2PStream(i: number): ParsedStream {
  return {
    id: `p2p-${i}`,
    type: 'p2p',
    addon: {
      name: 'Torrentio',
      preset: { id: 'torrentio', type: 'torrentio', options: {} },
      manifestUrl: 'http://localhost/manifest.json',
      enabled: true,
      timeout: 10000,
    },
    torrent: { infoHash: String(i).repeat(40), sources: [] },
    filename: `Test.Movie.2020.1080p.WEB-DL.${i}.mkv`,
  } as unknown as ParsedStream;
}

function makeUserData(
  serviceWrap: NonNullable<UserData['serviceWrap']>
): UserData {
  return {
    services: [
      { id: 'torbox', enabled: true, credentials: { apiKey: 'test-key' } },
    ],
    serviceWrap: { enabled: true, ...serviceWrap },
  } as unknown as UserData;
}

const streams = [makeP2PStream(1), makeP2PStream(2)];
const addons: Addon[] = [];

describe('resolveServiceWrappedStreams when every service fails', () => {
  before(() => {
    mode = 'error';
  });

  it('drops the wrapped results by default', async () => {
    const result = await resolveServiceWrappedStreams(
      streams,
      context,
      makeUserData({}),
      addons
    );
    assert.equal(result.streams.length, 0);
    assert.ok(result.errors.length > 0);
  });

  it('returns the original P2P results with onServiceFailure "p2p"', async () => {
    const result = await resolveServiceWrappedStreams(
      streams,
      context,
      makeUserData({ onServiceFailure: 'p2p' }),
      addons
    );
    assert.deepEqual(
      result.streams.map((s) => s.id),
      ['p2p-1', 'p2p-2']
    );
    assert.ok(result.errors.length > 0);
  });
});

describe('resolveServiceWrappedStreams with a service timeout', () => {
  before(() => {
    mode = 'hang';
  });
  after(() => {
    for (const res of hanging) res.destroy();
    server.close();
  });

  it('gives up on a hanging service and falls back to P2P', async () => {
    const start = Date.now();
    const result = await resolveServiceWrappedStreams(
      streams,
      context,
      makeUserData({ onServiceFailure: 'p2p', timeout: 300 }),
      addons
    );
    assert.ok(Date.now() - start < 2000, 'should not wait for the API');
    assert.equal(result.streams.length, 2);
    assert.ok(
      result.errors.some((e) => e.description.includes('300ms')),
      'reports the timeout'
    );
  });
});
