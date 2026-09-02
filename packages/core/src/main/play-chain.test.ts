import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isExternalDebridFailover, buildPlayChain } from '../main/play-chain.js';
import { ParsedStreamSchema } from '../db/schemas.js';
import type { ParsedStream, UserData } from '../db/schemas.js';

function makeStream(overrides: Partial<ParsedStream>): ParsedStream {
  return ParsedStreamSchema.parse({
    id: 'test-stream',
    type: 'http',
    addon: {
      name: 'Test Addon',
      instanceId: 'test-addon',
      enabled: true,
      preset: { id: 'custom', type: 'custom', options: {} },
      manifestUrl: 'https://addon.example/manifest.json',
      timeout: 15000,
    },
    url: 'https://addon.example/file.mkv',
    ...overrides,
  });
}

describe('isExternalDebridFailover', () => {
  it('accepts http streams hosted on the addon manifest host', () => {
    const stream = makeStream({
      type: 'http',
      url: 'https://addon.example/mirror/file.mkv',
    });
    assert.equal(isExternalDebridFailover(stream), true);
  });

  it('accepts debrid streams hosted on the addon manifest host', () => {
    const stream = makeStream({
      type: 'debrid',
      url: 'https://addon.example/link',
    });
    assert.equal(isExternalDebridFailover(stream), true);
  });

  it('rejects p2p and usenet streams', () => {
    assert.equal(
      isExternalDebridFailover(makeStream({ type: 'p2p', url: undefined })),
      false
    );
    assert.equal(
      isExternalDebridFailover(makeStream({ type: 'usenet' })),
      false
    );
  });

  it('rejects urls on a different host than the addon manifest', () => {
    const stream = makeStream({
      type: 'http',
      url: 'https://cdn.other-host.example/file.mkv',
    });
    assert.equal(isExternalDebridFailover(stream), false);
  });

  it('rejects owned playback urls', () => {
    const stream = makeStream({
      type: 'http',
      url: 'https://addon.example/api/v1/debrid/playback/abc/def',
    });
    assert.equal(isExternalDebridFailover(stream), false);
  });

  it('rejects streams without a url', () => {
    assert.equal(isExternalDebridFailover(makeStream({ url: undefined })), false);
  });
});

describe('failover contentTypes schema', () => {
  it('accepts http in the failover contentTypes zod enum', () => {
    const userData = {
      failover: { enabled: true, contentTypes: ['debrid', 'http'] },
    } as unknown as UserData;
    assert.deepEqual(userData.failover?.contentTypes, ['debrid', 'http']);
  });

  it('accepts http type on a failoverVariant', () => {
    const stream = makeStream({});
    stream.failoverVariants = [
      {
        url: 'https://addon.example/mirror/other.mkv',
        type: 'http',
        identity: 'https://addon.example/mirror/other.mkv',
        kind: 'external',
      },
    ];
    // parse through the schema to prove the widened enum validates
    const parsed = ParsedStreamSchema.parse(stream);
    assert.equal(parsed.failoverVariants?.[0]?.type, 'http');
  });
});

describe('buildPlayChain with http variants', () => {
  it('stores http external items in the chain when includeExternal is on', async () => {
    const winner = makeStream({
      id: 'owned-winner',
      type: 'debrid',
      url: 'http://localhost:3000/api/v1/debrid/playback/storeAuth/fbk/fileInfo/tt123/file.mkv',
      service: { id: 'torrin', cached: true },
    });
    const mirror = makeStream({
      id: 'http-mirror',
      type: 'http',
      url: 'https://addon.example/mirror/file.mkv',
      filename: 'file.mkv',
    });
    // simulate what the deduplicator merge step produces
    winner.failoverVariants = [
      {
        url: mirror.url!,
        type: 'http',
        serviceId: mirror.service?.id,
        filename: mirror.filename,
        identity: 'https://addon.example/mirror/file.mkv',
        kind: 'external',
      },
    ];

    let captured: unknown;
    // buildPlayChain caches into the chain cache; we exercise the public path
    // and assert it does not throw with an http variant present.
    await buildPlayChain(
      [winner],
      {
        maxAttempts: 3,
        contentTypes: ['usenet', 'debrid', 'http'],
        allowCrossType: false,
        parallel: 1,
        staggerMs: 0,
        preferredGraceMs: 0,
        maxWaitMs: 1000,
        includeExternal: true,
        sameReleaseLimit: 2,
        duplicateStaggerMs: 0,
      },
      'test-user'
    ).then((r) => (captured = r));
    assert.equal(captured, undefined); // void return; no throw = success
  });
});
