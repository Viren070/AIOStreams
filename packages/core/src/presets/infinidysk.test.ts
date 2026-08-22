import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import {
  buildFailoverOrderBody,
  getFailoverOrderEndpoint,
  getInfiniDyskFailoverId,
  getInfiniDyskIndexer,
  getInfiniDyskInLibrary,
  getInfiniDyskMessage,
  mergeInfiniDyskLanguages,
  parseInfiniDyskManifestUrl,
  reportFailoverOrder,
} from './infinidysk-helpers.js';

const presetManagerSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'presetManager.ts'),
  'utf8'
);

let mockAgent: MockAgent | undefined;
let previousDispatcher: ReturnType<typeof getGlobalDispatcher> | undefined;

afterEach(async () => {
  if (previousDispatcher) {
    setGlobalDispatcher(previousDispatcher);
    previousDispatcher = undefined;
  }
  await mockAgent?.close();
  mockAgent = undefined;
});

test('registers InfiniDysk in PresetManager without requiring services', () => {
  assert.match(presetManagerSource, /from '\.\/infinidysk\.js'/);
  assert.match(presetManagerSource, /'infinidysk'/);
  assert.match(
    presetManagerSource,
    /case 'infinidysk':\s*return InfiniDyskPreset/
  );
});

test('validates InfiniDysk manifest URLs', () => {
  assert.equal(
    parseInfiniDyskManifestUrl(
      'My InfiniDysk',
      'https://infinidysk.example/adapters/addon/profile-token/manifest.json'
    ),
    'https://infinidysk.example/adapters/addon/profile-token/manifest.json'
  );
  assert.throws(
    () =>
      parseInfiniDyskManifestUrl(
        'My InfiniDysk',
        'ftp://infinidysk.example/manifest.json'
      ),
    /invalid Manifest URL/
  );
  assert.throws(
    () =>
      parseInfiniDyskManifestUrl(
        'My InfiniDysk',
        'https://infinidysk.example/not-a-manifest'
      ),
    /invalid Manifest URL/
  );
  assert.throws(
    () =>
      parseInfiniDyskManifestUrl('My InfiniDysk', '/relative/manifest.json'),
    /invalid Manifest URL/
  );
  assert.throws(
    () =>
      parseInfiniDyskManifestUrl(
        'My InfiniDysk',
        'http://127.0.0.1/adapters/addon/profile-token/manifest.json'
      ),
    /invalid Manifest URL/
  );
  assert.throws(
    () =>
      parseInfiniDyskManifestUrl(
        'My InfiniDysk',
        'http://[::1]/adapters/addon/profile-token/manifest.json'
      ),
    /invalid Manifest URL/
  );
  assert.doesNotThrow(() =>
    parseInfiniDyskManifestUrl(
      'My InfiniDysk',
      'https://infinidysk.example/adapters/addon/profile-token/manifest.json'
    )
  );
});

test('parses direct-play streams and optional InfiniDysk metadata', () => {
  const stream = {
    name: 'Example.Release.2026.1080p',
    url: 'https://infinidysk.example/adapters/addon/profile-token/play/id.mkv',
    failoverId: 'direct-failover-id',
    behaviorHints: {
      filename: 'Example.Release.2026.1080p.mkv',
      videoSize: 1234567890,
      notWebReady: true,
    },
    meta: {
      indexer: 'NZBGeek',
      inLibrary: true,
      availability: 'available',
      languages: ['en', 'German'],
    },
  };

  assert.equal(getInfiniDyskIndexer(stream), 'NZBGeek');
  assert.equal(getInfiniDyskInLibrary(stream), true);
  assert.equal(getInfiniDyskMessage(stream), 'Ready · Verified');
  assert.equal(getInfiniDyskFailoverId(stream), 'direct-failover-id');
  assert.deepEqual(
    mergeInfiniDyskLanguages([], stream.meta.languages, (value) => {
      if (value === 'en') return 'English';
      if (value === 'German') return 'German';
      return undefined;
    }),
    ['English', 'German']
  );
  assert.equal(stream.url.endsWith('.mkv'), true);
  assert.equal(stream.behaviorHints.notWebReady, true);
  assert.equal(stream.behaviorHints.videoSize, 1234567890);
});

test('accepts released streams without optional metadata', () => {
  const stream = {
    name: 'Example.Release.2026.1080p',
    url: 'https://infinidysk.example/adapters/addon/profile-token/play/id.mkv',
    failoverId: 'legacy-failover-id',
    meta: { indexer: 'Newshosting' },
  };

  assert.equal(getInfiniDyskIndexer(stream), 'Newshosting');
  assert.equal(getInfiniDyskInLibrary(stream), false);
  assert.equal(getInfiniDyskMessage(stream), undefined);
  assert.equal(getInfiniDyskFailoverId(stream), 'legacy-failover-id');
  assert.deepEqual(
    mergeInfiniDyskLanguages([], undefined, () => undefined),
    []
  );
});

test('reports final stream order to the sibling failover endpoint', async () => {
  previousDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  const manifestUrl =
    'http://infinidysk.test/adapters/addon/profile-token/manifest.json';
  const streams = [
    { filename: 'Second choice', extra: { failoverId: 'second' } },
    { filename: 'Ignored choice' },
    { filename: 'First choice', extra: { failoverId: 'first' } },
  ];
  const body = buildFailoverOrderBody(streams);
  assert.deepEqual(body, {
    streams: [
      { name: 'Second choice', failoverId: 'second' },
      { name: 'First choice', failoverId: 'first' },
    ],
  });
  assert.equal(
    getFailoverOrderEndpoint(manifestUrl),
    'http://infinidysk.test/adapters/addon/profile-token/failover_order'
  );

  let reportReceived!: () => void;
  const reported = new Promise<void>((resolve) => {
    reportReceived = resolve;
  });
  mockAgent
    .get('http://infinidysk.test')
    .intercept({
      path: '/adapters/addon/profile-token/failover_order',
      method: 'POST',
      body: JSON.stringify(body),
    })
    .reply(() => {
      reportReceived();
      return { statusCode: 200, data: { ok: true } };
    });

  await reportFailoverOrder(
    streams,
    getFailoverOrderEndpoint(manifestUrl)!,
    'InfiniDysk-Test'
  );

  await reported;
  mockAgent.assertNoPendingInterceptors();
});

test('refuses an unsafe failover endpoint without sending stream metadata', async () => {
  previousDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  const failures: string[] = [];
  await assert.doesNotReject(() =>
    reportFailoverOrder(
      [{ extra: { failoverId: 'first' } }],
      'http://127.0.0.1/adapters/addon/profile-token/failover_order',
      'InfiniDysk-Test',
      {
        onFailure: () => {
          failures.push('Failed to report InfiniDysk failover order');
        },
      }
    )
  );
  assert.deepEqual(failures, ['Failed to report InfiniDysk failover order']);
});

test('failover callback rejects redirects without failing the stream response', async () => {
  previousDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  mockAgent
    .get('http://infinidysk.test')
    .intercept({
      path: '/adapters/addon/profile-token/failover_order',
      method: 'POST',
    })
    .reply({
      statusCode: 302,
      headers: { location: 'http://127.0.0.1/internal' },
    });

  const failures: string[] = [];
  await assert.doesNotReject(() =>
    reportFailoverOrder(
      [{ extra: { failoverId: 'first' } }],
      'http://infinidysk.test/adapters/addon/profile-token/failover_order',
      'InfiniDysk-Test',
      {
        onFailure: () => {
          failures.push('Failed to report InfiniDysk failover order');
        },
      }
    )
  );
  assert.deepEqual(failures, ['Failed to report InfiniDysk failover order']);
});
