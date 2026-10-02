import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  isExternalFailoverTarget,
  buildPlayChain,
  getPlayChain,
} from '../main/play-chain.js';
import { ParsedStreamSchema, UserDataSchema } from '../db/schemas.js';
import type { ParsedStream } from '../db/schemas.js';
import { decodeFallbackKey } from '../debrid/utils.js';
import { initDb } from '../db/db.js';
import { initialiseConfig } from '../config/index.js';

before(async () => {
  await initDb('sqlite://./play-chain-test.db');
  await initialiseConfig();
});

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

describe('isExternalFailoverTarget', () => {
  it('accepts http streams hosted on the addon manifest host', () => {
    const stream = makeStream({
      type: 'http',
      url: 'https://addon.example/mirror/file.mkv',
    });
    assert.equal(isExternalFailoverTarget(stream), true);
  });

  it('accepts debrid streams hosted on the addon manifest host', () => {
    const stream = makeStream({
      type: 'debrid',
      url: 'https://addon.example/link',
    });
    assert.equal(isExternalFailoverTarget(stream), true);
  });

  it('rejects p2p and usenet streams', () => {
    assert.equal(
      isExternalFailoverTarget(makeStream({ type: 'p2p', url: undefined })),
      false
    );
    assert.equal(
      isExternalFailoverTarget(makeStream({ type: 'usenet' })),
      false
    );
  });

  it('rejects urls on a different host than the addon manifest', () => {
    const stream = makeStream({
      type: 'http',
      url: 'https://cdn.other-host.example/file.mkv',
    });
    assert.equal(isExternalFailoverTarget(stream), false);
  });

  it('rejects owned playback urls', () => {
    const stream = makeStream({
      type: 'http',
      url: 'https://addon.example/api/v1/debrid/playback/abc/def',
    });
    assert.equal(isExternalFailoverTarget(stream), false);
  });

  it('rejects streams without a url', () => {
    assert.equal(isExternalFailoverTarget(makeStream({ url: undefined })), false);
  });
});

describe('failover contentTypes schema', () => {
  it('accepts http in the failover contentTypes zod enum', () => {
    const parsed = UserDataSchema.pick({ failover: true }).parse({
      failover: { enabled: true, contentTypes: ['debrid', 'http'] },
    });
    assert.deepEqual(parsed.failover?.contentTypes, ['debrid', 'http']);
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
  it('stores http external items in the chain and stamps owned urls', async () => {
    const winner = makeStream({
      id: 'owned-winner',
      type: 'debrid',
      url: 'http://localhost:3000/api/v1/debrid/playback/storeAuth/fbk/fileInfo/tt123/file.mkv',
      service: { id: 'torrin', cached: true },
    });
    const externalMirror = makeStream({
      id: 'http-mirror',
      type: 'http',
      url: 'https://addon.example/mirror/file.mkv',
      filename: 'file.mkv',
    });
    const sameReleaseVariant = makeStream({
      id: 'http-variant-holder',
      type: 'debrid',
      url: 'http://localhost:3000/api/v1/debrid/playback/storeAuth2/fbk2/fileInfo2/tt123/file.mkv',
      service: { id: 'torrin', cached: true },
    });
    // simulate what the deduplicator merge step produces
    sameReleaseVariant.failoverVariants = [
      {
        url: externalMirror.url!,
        type: 'http',
        serviceId: externalMirror.service?.id,
        filename: externalMirror.filename,
        identity: 'https://addon.example/mirror/file.mkv',
        kind: 'external',
      },
    ];

    await buildPlayChain(
      [winner, externalMirror, sameReleaseVariant],
      {
        allowCrossType: true,
        maxAttempts: 3,
        contentTypes: ['usenet', 'debrid', 'http'],
        parallel: 1,
        staggerMs: 0,
        preferredGraceMs: 0,
        maxWaitMs: 1000,
        includeExternal: true,
        sameReleaseLimit: 2,
        duplicateStaggerMs: 0,
      },
      'test-user'
    );
    // The owned stream's URL must have been stamped with its chain position:
    // /api/v1/debrid/playback/{storeAuth}/{fallbackKey}/...
    const stamped = new URL(winner.url!);
    const fallbackKey = stamped.pathname.split('/')[6];
    const decoded = decodeFallbackKey(fallbackKey);
    assert.ok(decoded, 'owned url must carry a decodable fallback key');

    // Read the chain back through the resolver the playback route uses.
    const resolved = await getPlayChain(decoded, 'debrid');
    assert.ok(resolved, 'chain must be resolvable after build');
    const httpExternal = resolved!.fallbacks.find(
      (a) => a.kind === 'external' && a.type === 'http'
    );
    assert.ok(httpExternal, 'external http target must be in the chain');
    assert.equal(httpExternal.url, 'https://addon.example/mirror/file.mkv');
  });
});
