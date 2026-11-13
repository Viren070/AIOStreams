import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import '../index.js';
import {
  canonicalNzbHash,
  cleanNzbUrl,
  hashNzbUrl,
  sentNzbHash,
} from './utils.js';
import { NativeUsenetService } from './aiostreams.js';
import { UsenetLibraryRepository } from '../db/index.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { downloadManager } from '../utils/index.js';

describe('Issue #1670: Spottarr and Newznab guid NZB URL hashing', () => {
  before(async () => {
    process.env.USENET_PROVIDERS = JSON.stringify([
      {
        id: 'p1',
        name: 'TestNNTP',
        host: 'news.example.com',
        port: 563,
        tls: true,
        username: 'u',
        password: 'p',
        maxConnections: 4,
        priority: 1,
        enabled: true,
      },
    ]);
    mock.method(SettingsRepository, 'getAll', async () => []);
    mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
  });
  it('produces distinct canonical hashes for different Spottarr guid values', () => {
    const first = 'http://spottarr:8383/newznab/api?t=get&guid=6337';
    const second = 'http://spottarr:8383/newznab/api?t=get&guid=6336';

    const firstCanonical = canonicalNzbHash(first);
    const secondCanonical = canonicalNzbHash(second);

    assert.equal(firstCanonical.known, true);
    assert.equal(secondCanonical.known, true);
    assert.notEqual(firstCanonical.hash, secondCanonical.hash);
    assert.equal(hashNzbUrl(first), firstCanonical.hash);
    assert.equal(hashNzbUrl(second), secondCanonical.hash);
    assert.notEqual(
      hashNzbUrl(first),
      hashNzbUrl(cleanNzbUrl(first)),
      'guid URL must not fall through to base /api URL hash'
    );
  });

  it('preserves release identity when apikey or extra params change on guid URLs', () => {
    const withKeyOne =
      'http://spottarr:8383/newznab/api?t=get&guid=6337&apikey=key-one';
    const withKeyTwo =
      'http://spottarr:8383/newznab/api?t=get&guid=6337&apikey=key-two&i=1';
    const shortAction =
      'http://spottarr:8383/newznab/api?t=g&guid=6337&apikey=key-one';
    const getNzbOne = 'https://indexer.test/getnzb?guid=abc-123&apikey=one';
    const getNzbTwo = 'https://indexer.test/getnzb?guid=abc-123&apikey=two';

    assert.equal(hashNzbUrl(withKeyOne), hashNzbUrl(withKeyTwo));
    assert.equal(hashNzbUrl(withKeyOne, false), hashNzbUrl(withKeyTwo, false));
    assert.equal(sentNzbHash(withKeyOne), sentNzbHash(withKeyTwo));
    assert.equal(canonicalNzbHash(shortAction).known, true);
    assert.equal(hashNzbUrl(getNzbOne), hashNzbUrl(getNzbTwo));
  });

  it('keeps standard t=get&id=... Newznab URLs unchanged', () => {
    const idUrlOne = 'https://indexer.test/api?t=get&id=rel-1&apikey=one';
    const idUrlTwo = 'https://indexer.test/api?t=get&id=rel-1&apikey=two';
    const idWithGuid =
      'https://indexer.test/api?t=get&id=rel-1&guid=extra-guid&apikey=one';

    assert.equal(hashNzbUrl(idUrlOne), hashNzbUrl(idUrlTwo));
    assert.equal(hashNzbUrl(idUrlOne), hashNzbUrl(idWithGuid));
  });

  it('isolates failed and imported Spottarr releases in NativeUsenetService', async () => {
    const urlA = 'http://spottarr:8383/newznab/api?t=get&guid=6337';
    const urlB = 'http://spottarr:8383/newznab/api?t=get&guid=6336';
    const hashA = hashNzbUrl(urlA);
    const hashB = hashNzbUrl(urlB);
    const legacyCollidingHash = hashNzbUrl('http://spottarr:8383/newznab/api');

    const failedEntryA: any = {
      nzbHash: 'content-hash-a',
      name: 'Compressed.Movie.A.2160p',
      status: 'failed',
      failReason: 'Archive is compressed: not streamable',
      errorCode: 'COMPRESSED_ARCHIVE',
      failCount: 1,
      files: [],
      nzbUrl: urlA,
    };

    mock.method(downloadManager, 'fetchNzb', async () => {
      throw new Error('network disabled in unit test');
    });
    mock.method(
      UsenetLibraryRepository,
      'getManyResolved',
      async (hashes: string[]) => {
        const map = new Map();
        for (const h of hashes) {
          if (h === hashA || h === legacyCollidingHash) {
            map.set(h, failedEntryA);
          }
        }
        return map;
      }
    );
    mock.method(
      UsenetLibraryRepository,
      'getResolved',
      async (hash: string) => {
        if (hash === hashA || hash === legacyCollidingHash) {
          return { entry: failedEntryA, contentHash: failedEntryA.nzbHash };
        }
        return undefined;
      }
    );

    const service = Object.create(
      NativeUsenetService.prototype
    ) as NativeUsenetService;
    (service as any).assertAuthorised = () => {};

    const statuses = await service.checkNzbs([
      { name: 'Movie A', hash: hashA },
      { name: 'Movie B', hash: hashB },
    ]);

    assert.equal(statuses[0].status, 'failed');
    assert.equal(statuses[1].status, 'cached');

    // Even if a client sends a stale pre-fix colliding hash in playbackInfo.hash,
    // resolve() recomputes the canonical shaped hash from playbackInfo.nzb so
    // Movie B does not inherit Movie A's cached failure or files.
    let resolvedHashSeen: string | undefined;
    mock.method(
      UsenetLibraryRepository,
      'getResolved',
      async (hash: string) => {
        resolvedHashSeen = hash;
        if (hash === hashA || hash === legacyCollidingHash) {
          return { entry: failedEntryA, contentHash: failedEntryA.nzbHash };
        }
        return undefined;
      }
    );

    await assert.rejects(
      () =>
        service.resolve(
          {
            type: 'usenet',
            nzb: urlB,
            hash: legacyCollidingHash,
            title: 'Movie B',
            size: 1000,
          } as any,
          'Movie.B.mkv'
        ),
      (err: any) => {
        assert.equal(
          resolvedHashSeen,
          hashB,
          'resolve must look up the shaped hash for urlB rather than the colliding base URL hash'
        );
        assert.notEqual(
          err?.message,
          'nzb previously failed on all providers'
        );
        return true;
      }
    );

    mock.restoreAll();
  });
});
