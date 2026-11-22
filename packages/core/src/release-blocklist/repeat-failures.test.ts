import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { settingsStore } from '../config/index.js';
import { ReleaseBlocklistRepository } from '../db/repositories/release-blocklist.js';
import { ReleaseFailuresRepository } from '../db/repositories/release-failures.js';
import {
  isSoftFailureCode,
  reportReleaseFailure,
  reportReleaseSuccess,
} from './feedback.js';
import { openTestDb, resetBlocklistState, wd1, nh1 } from './__tests__/db.js';

let close: () => Promise<void>;

before(async () => {
  close = await openTestDb();
});

after(async () => {
  await close();
});

beforeEach(async () => {
  await resetBlocklistState();
});

const blocked = (key: string) =>
  ReleaseBlocklistRepository.isLocallyBlocked(key);

describe('repeated soft failures (layer 1)', () => {
  test('one soft failure does not block the release', async () => {
    const key = wd1(1);
    await reportReleaseFailure('incomplete_archive', [key]);
    assert.equal(await blocked(key), false);
    assert.equal(await ReleaseFailuresRepository.failureCount(key), 1);
  });

  test('the default threshold (2) marks the release dead', async () => {
    const key = wd1(2);
    const content = nh1(2);
    await reportReleaseFailure('incomplete_archive', [key, content]);
    await reportReleaseFailure('incomplete_archive', [key, content]);
    assert.equal(await blocked(key), true);
    assert.equal(await blocked(content), true);
  });

  test('different soft codes add up on the same release', async () => {
    const key = wd1(3);
    await reportReleaseFailure('archive_ungrouped', [key]);
    await reportReleaseFailure('unsupported_encoding', [key]);
    assert.equal(await blocked(key), true);
  });

  test('a configured threshold of N needs N failures', async () => {
    await settingsStore.set('releaseBlocklist.repeatFailures', 3);
    const key = wd1(4);
    await reportReleaseFailure('archive_incomplete', [key]);
    await reportReleaseFailure('archive_incomplete', [key]);
    assert.equal(await blocked(key), false);
    await reportReleaseFailure('archive_incomplete', [key]);
    assert.equal(await blocked(key), true);
  });

  test('a threshold of 0 turns layer 1 off', async () => {
    await settingsStore.set('releaseBlocklist.repeatFailures', 0);
    const key = wd1(5);
    for (let i = 0; i < 5; i++) {
      await reportReleaseFailure('incomplete_archive', [key]);
    }
    assert.equal(await blocked(key), false);
    assert.equal(await ReleaseFailuresRepository.failureCount(key), 0);
  });

  test('a success clears the verdict and resets the count', async () => {
    const key = wd1(6);
    await reportReleaseFailure('incomplete_archive', [key]);
    await reportReleaseFailure('incomplete_archive', [key]);
    assert.equal(await blocked(key), true);

    await reportReleaseSuccess([key]);
    assert.equal(await blocked(key), false);
    assert.equal(await ReleaseFailuresRepository.failureCount(key), 0);

    // The count starts over: one more failure is not enough again.
    await reportReleaseFailure('incomplete_archive', [key]);
    assert.equal(await blocked(key), false);
  });

  test('a success before the threshold resets the count', async () => {
    const key = wd1(7);
    await reportReleaseFailure('incomplete_archive', [key]);
    await reportReleaseSuccess([key]);
    await reportReleaseFailure('incomplete_archive', [key]);
    assert.equal(await blocked(key), false);
  });

  test('transient, network, auth and request-relative codes never count', async () => {
    const key = wd1(8);
    const codes = [
      'inspect_failed',
      'nzb_fetch_failed',
      'nzb_parse_failed',
      'BAD_GATEWAY',
      'DOWNLOAD_FAILED',
      'UNAUTHORIZED',
      'archive_encrypted',
      'bad_password',
      'archive_bad_password',
      'archive_nested',
      'archive_disabled',
      'archive_no_video',
      'no_streamable_files',
      'content_mismatch',
      undefined,
      null,
    ];
    for (const code of codes) {
      assert.equal(isSoftFailureCode(code), false, `${code} must not count`);
      await reportReleaseFailure(code, [key]);
      await reportReleaseFailure(code, [key]);
    }
    assert.equal(await blocked(key), false);
    assert.equal(await ReleaseFailuresRepository.failureCount(key), 0);
  });

  test('hard codes still mark the release dead on the first failure', async () => {
    const key = wd1(9);
    await reportReleaseFailure('archive_solid', [key]);
    assert.equal(await blocked(key), true);
    const miss = wd1(10);
    await reportReleaseFailure('missing_on_providers', [miss]);
    assert.equal(await blocked(miss), true);
  });

  test('nothing is counted while the blocklist is disabled', async () => {
    await settingsStore.set('releaseBlocklist.enabled', false);
    const key = wd1(11);
    await reportReleaseFailure('incomplete_archive', [key]);
    await reportReleaseFailure('incomplete_archive', [key]);
    assert.equal(await ReleaseFailuresRepository.failureCount(key), 0);
    assert.equal(await blocked(key), false);
  });
});
