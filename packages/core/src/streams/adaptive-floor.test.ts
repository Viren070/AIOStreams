import { describe, it, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import StreamFilterer from './filterer.js';
import { StreamContext } from './context.js';
import { ParsedStreamSchema } from '../db/schemas.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import { initDb, closeDb } from '../db/db.js';
import { initialiseConfig } from '../config/index.js';

function makeStream(
  overrides: Partial<ParsedStream>,
  resolution?: string
): ParsedStream {
  const stream = ParsedStreamSchema.parse({
    id: 'test-stream-' + Math.random().toString(36).slice(2),
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
  if (resolution) {
    stream.parsedFile = {
      ...stream.parsedFile,
      resolution,
    } as ParsedStream['parsedFile'];
  }
  return stream;
}

function makeUserData(overrides: Partial<UserData>): UserData {
  // The filterer only reads specific fields; a full UserDataSchema.parse
  // would drag in required sortCriteria/formatter shapes irrelevant here.
  return { ...overrides } as unknown as UserData;
}
async function filterWith(
  userData: UserData,
  streams: ParsedStream[]
): Promise<ParsedStream[]> {
  const filterer = new StreamFilterer(userData);
  const context = await StreamContext.create('series', 'tt0000001:1:1', userData);
  return filterer.filter(streams, context);
}

describe('adaptiveResolutionFloor', () => {
  const floor = ['2160p', '1440p', '1080p', '720p'];

  // ':memory:' doesn't survive connect.ts's URL parsing and absolute
  // Windows paths don't fit its URL scheme, so use a relative path in
  // the package cwd, unique per process so concurrent runs can't touch
  // each other's files; after() removes every artifact.
  const dbPath = `adaptive-floor-test-${process.pid}.db`;
  before(async () => {
    await initDb(`sqlite://./${dbPath}`);
    await initialiseConfig();
  });

  after(async () => {
    await closeDb();
    for (const suffix of ['', '-shm', '-wal']) {
      fs.rmSync(dbPath + suffix, { force: true });
    }
  });

  it('enforces the floor when at least one stream meets it', async () => {
    const userData = makeUserData({
      requiredResolutions: floor,
      adaptiveResolutionFloor: true,
    });
    const streams = [
      makeStream({}, '720p'),
      makeStream({}, '480p'),
      makeStream({}, 'Unknown'),
    ];
    const result = await filterWith(userData, streams);
    assert.deepEqual(
      result.map((s) => s.parsedFile?.resolution),
      ['720p']
    );
  });

  it('drops the floor when nothing meets it, keeping all streams', async () => {
    const userData = makeUserData({
      requiredResolutions: floor,
      adaptiveResolutionFloor: true,
    });
    const streams = [
      makeStream({}, '576p'),
      makeStream({}, '480p'),
      makeStream({}, 'Unknown'),
    ];
    const result = await filterWith(userData, streams);
    assert.equal(result.length, 3);
  });

  it('hard-filters when the floor is not adaptive', async () => {
    const userData = makeUserData({
      requiredResolutions: floor,
    });
    const streams = [
      makeStream({}, '576p'),
      makeStream({}, '480p'),
    ];
    const result = await filterWith(userData, streams);
    assert.equal(result.length, 0);
  });

  it('keeps hard filtering when some streams meet the floor (adaptive on)', async () => {
    const userData = makeUserData({
      requiredResolutions: floor,
      adaptiveResolutionFloor: true,
    });
    const streams = [
      makeStream({}, '1080p'),
      makeStream({}, '480p'),
      makeStream({}, 'Unknown'),
    ];
    const result = await filterWith(userData, streams);
    const resolutions = result.map((s) => s.parsedFile?.resolution);
    assert.ok(resolutions.includes('1080p'));
    assert.ok(!resolutions.includes('480p'));
    assert.ok(!resolutions.includes('Unknown'));
  });

  it('retracts earlier off-floor batches once a later batch meets the floor', () => {
    // Request-scope semantics: per-batch filter() calls saw only their
    // own batch, so batch 1 kept 480p rows; the merged-set pass must
    // drop them because batch 2 contains a floor-meeting stream.
    const filterer = new StreamFilterer(
      makeUserData({ requiredResolutions: floor, adaptiveResolutionFloor: true })
    );
    const batch1 = [makeStream({}, '480p'), makeStream({}, 'Unknown')];
    const batch2 = [makeStream({}, '1080p')];
    const merged = [...batch1, ...batch2];
    const result = filterer.applyResolutionFloor(merged);
    assert.deepEqual(
      result.map((s) => s.parsedFile?.resolution),
      ['1080p']
    );
  });

  it('keeps all merged streams when no batch ever meets the floor', () => {
    const filterer = new StreamFilterer(
      makeUserData({ requiredResolutions: floor, adaptiveResolutionFloor: true })
    );
    const merged = [makeStream({}, '480p'), makeStream({}, 'Unknown')];
    assert.equal(filterer.applyResolutionFloor(merged).length, 2);
  });

  it('is a no-op when no floor is configured', () => {
    const filterer = new StreamFilterer(makeUserData({}));
    const merged = [makeStream({}, '480p')];
    assert.equal(filterer.applyResolutionFloor(merged).length, 1);
  });
});
