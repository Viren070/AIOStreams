import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { settingsStore } from '../../config/index.js';
import { UsenetIndexerMetricsRepository } from '../../db/index.js';
import { downloadManager } from '../../utils/download-manager.js';
import { addUsenetNzb, resolveFileList } from './library.js';
import { parseWithNzbGrabInvalidation } from './nzb-grab-invalidation.js';
import { openNativeUsenetStream } from './stream-session.js';
import { encodeUsenetStreamToken } from './tokens.js';

const STRICT_INVALID_NZB = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><nzb></nzb>',
  'utf8'
);

function isStrictParseError(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.message, 'Invalid NZB: no files with segments found');
  return true;
}

before(async () => {
  await settingsStore.set('usenet.providers', [
    {
      id: 'test-provider',
      host: '127.0.0.1',
      port: 119,
      tls: false,
      maxConnections: 1,
      priority: 0,
    },
  ]);
});

describe('parseWithNzbGrabInvalidation', () => {
  it('invalidates the exact remote URL and rethrows the original parse error', async (t) => {
    const url =
      'https://indexer.test/api?apikey=secret&t=get&id=1&ordered=true';
    const calls: string[] = [];
    t.mock.method(downloadManager, 'invalidateNzb', async (key: string) => {
      calls.push(key);
      return true;
    });
    const parseError = new Error('strict parse failed');

    await assert.rejects(
      parseWithNzbGrabInvalidation(url, async () => {
        throw parseError;
      }),
      (err) => err === parseError
    );
    assert.deepEqual(calls, [url]);
  });

  it('does not let an invalidation failure mask the parse error', async (t) => {
    t.mock.method(downloadManager, 'invalidateNzb', async () => {
      throw new Error('disk delete failed');
    });
    const parseError = new Error('original parse failure');

    await assert.rejects(
      parseWithNzbGrabInvalidation('https://indexer.test/grab', async () => {
        throw parseError;
      }),
      (err) => err === parseError
    );
  });

  it('does not invalidate direct XML or local-nzb content', async (t) => {
    const invalidate = t.mock.method(
      downloadManager,
      'invalidateNzb',
      async () => true
    );
    const directError = new Error('direct XML parse failed');
    const localError = new Error('local NZB parse failed');

    await assert.rejects(
      parseWithNzbGrabInvalidation(undefined, async () => {
        throw directError;
      }),
      (err) => err === directError
    );
    await assert.rejects(
      parseWithNzbGrabInvalidation('local-nzb://content-hash', async () => {
        throw localError;
      }),
      (err) => err === localError
    );
    assert.equal(invalidate.mock.callCount(), 0);
  });

  it('does not invalidate when parsing succeeds', async (t) => {
    const invalidate = t.mock.method(
      downloadManager,
      'invalidateNzb',
      async () => true
    );
    const parsed = { hash: 'parsed' };

    assert.strictEqual(
      await parseWithNzbGrabInvalidation(
        'https://indexer.test/grab',
        async () => parsed
      ),
      parsed
    );
    assert.equal(invalidate.mock.callCount(), 0);
  });
});

describe('productive NZB parse-failure wiring', () => {
  it('invalidates once from resolveFileList without retrying or double-counting', async (t) => {
    const url = `https://indexer.test/grab/${randomUUID()}?apikey=secret`;
    const searchHash = `search-${randomUUID()}`;
    const fetch = t.mock.method(
      downloadManager,
      'fetchNzb',
      async () => STRICT_INVALID_NZB
    );
    const invalidated: string[] = [];
    t.mock.method(downloadManager, 'invalidateNzb', async (key: string) => {
      invalidated.push(key);
      throw new Error('disk delete failed');
    });
    const record = t.mock.method(
      UsenetIndexerMetricsRepository,
      'record',
      async () => undefined
    );

    await assert.rejects(
      resolveFileList(
        {
          type: 'usenet',
          hash: searchHash,
          nzb: url,
          indexer: 'Wiring Test',
        },
        searchHash,
        [],
        {},
        undefined
      ),
      isStrictParseError
    );

    assert.equal(fetch.mock.callCount(), 1);
    assert.deepEqual(invalidated, [url]);
    assert.equal(record.mock.callCount(), 1);
    const delta = record.mock.calls[0].arguments[0];
    assert.equal(delta.indexer, 'Wiring Test');
    assert.equal(delta.failed, 1);
    assert.equal(delta.failedFetch, 0);
  });

  it('invalidates the exact URL from addUsenetNzb and preserves the parse error', async (t) => {
    const url = `https://manual-indexer.test/grab/${randomUUID()}`;
    const fetch = t.mock.method(
      downloadManager,
      'fetchNzb',
      async () => STRICT_INVALID_NZB
    );
    const invalidated: string[] = [];
    t.mock.method(downloadManager, 'invalidateNzb', async (key: string) => {
      invalidated.push(key);
      throw new Error('disk delete failed');
    });
    const record = t.mock.method(
      UsenetIndexerMetricsRepository,
      'record',
      async () => undefined
    );

    await assert.rejects(addUsenetNzb({ url }), isStrictParseError);

    assert.equal(fetch.mock.callCount(), 1);
    assert.deepEqual(invalidated, [url]);
    assert.equal(record.mock.callCount(), 1);
  });

  it('does not invalidate or fetch when addUsenetNzb receives direct XML', async (t) => {
    const fetch = t.mock.method(
      downloadManager,
      'fetchNzb',
      async () => STRICT_INVALID_NZB
    );
    const invalidate = t.mock.method(
      downloadManager,
      'invalidateNzb',
      async () => true
    );
    const record = t.mock.method(
      UsenetIndexerMetricsRepository,
      'record',
      async () => undefined
    );

    await assert.rejects(
      addUsenetNzb({ xml: STRICT_INVALID_NZB }),
      isStrictParseError
    );

    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(invalidate.mock.callCount(), 0);
    assert.equal(record.mock.callCount(), 1);
  });

  it('invalidates once on a real cold stream open and preserves the parse error', async (t) => {
    const url = `https://stream-indexer.test/grab/${randomUUID()}`;
    const fetch = t.mock.method(
      downloadManager,
      'fetchNzb',
      async () => STRICT_INVALID_NZB
    );
    const invalidated: string[] = [];
    t.mock.method(downloadManager, 'invalidateNzb', async (key: string) => {
      invalidated.push(key);
      throw new Error('disk delete failed');
    });
    const token = encodeUsenetStreamToken({
      nzb: url,
      hash: `cold-${randomUUID()}`,
      filename: 'cold-open.mkv',
    });

    await assert.rejects(openNativeUsenetStream({ token }), isStrictParseError);

    assert.equal(fetch.mock.callCount(), 1);
    assert.deepEqual(invalidated, [url]);
  });

  it('does not expose the invalidation helpers through the public core API', async () => {
    const publicApi = await import('../../index.js');

    assert.equal('invalidateRemoteNzb' in publicApi, false);
    assert.equal('parseWithNzbGrabInvalidation' in publicApi, false);
  });
});
