import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import StreamFilterer from './filterer.js';
import { StreamContext } from './context.js';
import { ParsedStreamSchema } from '../db/schemas.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import { initDb } from '../db/db.js';
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

  before(async () => {
    // ':memory:' doesn't survive connect.ts's URL parsing; a relative
    // sqlite://./file URI lands in the process cwd (packages/core when run
    // via the test script) and behaves identically for these tests.
    await initDb('sqlite://./adaptive-floor-test.db');
    await initialiseConfig();
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
    const resolutions = result.map((s) => s.parsedFile?.resolution);
    assert.deepEqual(resolutions.sort(), ['480p', 'Unknown', '720p'].sort().filter(r => r === '720p'));
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
});
