import {
  test,
  describe,
  before,
  after,
  beforeEach,
  afterEach,
  mock,
} from 'node:test';
import assert from 'node:assert/strict';
import { settingsStore } from '../config/index.js';
import { ReleaseFailuresRepository } from '../db/repositories/release-failures.js';
import { reportReleaseFailure, reportReleaseSuccess } from './feedback.js';
import { demoteFailingGroups, releaseGroupOf } from './group-demotion.js';
import { openTestDb, resetBlocklistState, wd1 } from './__tests__/db.js';

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

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

const CASTLE = { imdbId: 'tt1219024', tmdbId: 1419 };
const OTHER_SHOW = { imdbId: 'tt0903747', tmdbId: 1396 };

const episode = (show: typeof CASTLE, e: number) => ({
  ...show,
  season: 5,
  episode: e,
});

const castleFile = (e: number, group = 'TMSF') =>
  `Castle.S05E${String(e).padStart(2, '0')}.720p.WEB-DL.DD5.1.H.264-${group}.mkv`;

type TestStream = { id: string; parsedFile?: { releaseGroup?: string } };

const streams = (): TestStream[] => [
  { id: 'a', parsedFile: { releaseGroup: 'TMSF' } },
  { id: 'b', parsedFile: { releaseGroup: 'NTb' } },
  { id: 'c', parsedFile: { releaseGroup: 'tmsf' } },
  { id: 'd' },
  { id: 'e', parsedFile: { releaseGroup: 'FLUX' } },
];

const ids = (list: TestStream[]) => list.map((s) => s.id);

/** Three distinct TMSF releases of Castle die on the given code. */
async function killTmsfReleases(
  code: string,
  times = 1,
  show = CASTLE,
  first = 1
): Promise<void> {
  for (let e = first; e < first + 3; e++) {
    for (let i = 0; i < times; i++) {
      await reportReleaseFailure(code, [wd1(100 + e)], {
        filename: castleFile(e),
        title: episode(show, e),
      });
    }
  }
}

describe('release-group demotion (layer 2)', () => {
  test('parses the release group from the filename', () => {
    assert.equal(releaseGroupOf(castleFile(21)), 'tmsf');
    assert.equal(releaseGroupOf(null), null);
  });

  test('M distinct dead releases move the group last but keep it', async () => {
    await killTmsfReleases('missing_on_providers');
    const out = await demoteFailingGroups(streams(), {
      kind: 'series',
      imdbId: CASTLE.imdbId,
    });
    assert.deepEqual(ids(out), ['b', 'd', 'e', 'a', 'c']);
  });

  test('fewer than M dead releases leave the order alone', async () => {
    for (const e of [1, 2]) {
      await reportReleaseFailure('missing_on_providers', [wd1(100 + e)], {
        filename: castleFile(e),
        title: episode(CASTLE, e),
      });
    }
    // The same release failing again is still one dead release.
    await reportReleaseFailure('missing_on_providers', [wd1(101)], {
      filename: castleFile(1),
      title: episode(CASTLE, 1),
    });
    const out = await demoteFailingGroups(streams(), {
      kind: 'series',
      imdbId: CASTLE.imdbId,
    });
    assert.deepEqual(ids(out), ['a', 'b', 'c', 'd', 'e']);
  });

  test('releases killed by the repeated-failure verdict count too', async () => {
    await killTmsfReleases('incomplete_archive', 1);
    let out = await demoteFailingGroups(streams(), {
      kind: 'series',
      imdbId: CASTLE.imdbId,
    });
    // One soft failure each: none is dead yet.
    assert.deepEqual(ids(out), ['a', 'b', 'c', 'd', 'e']);

    await killTmsfReleases('incomplete_archive', 1);
    out = await demoteFailingGroups(streams(), {
      kind: 'series',
      imdbId: CASTLE.imdbId,
    });
    assert.deepEqual(ids(out), ['b', 'd', 'e', 'a', 'c']);
  });

  test('matches the title by any shared id', async () => {
    await killTmsfReleases('missing_on_providers');
    const out = await demoteFailingGroups(streams(), {
      kind: 'series',
      tmdbId: CASTLE.tmdbId,
    });
    assert.deepEqual(ids(out), ['b', 'd', 'e', 'a', 'c']);
  });

  test('other titles of the same group are unaffected', async () => {
    await killTmsfReleases('missing_on_providers');
    const out = await demoteFailingGroups(streams(), {
      kind: 'series',
      imdbId: OTHER_SHOW.imdbId,
      tmdbId: OTHER_SHOW.tmdbId,
    });
    assert.deepEqual(ids(out), ['a', 'b', 'c', 'd', 'e']);
    // A movie sharing the numeric TMDB id is another title, too.
    const movie = await demoteFailingGroups(streams(), {
      kind: 'movie',
      tmdbId: CASTLE.tmdbId,
    });
    assert.deepEqual(ids(movie), ['a', 'b', 'c', 'd', 'e']);
  });

  test('penalties expire after the window', async () => {
    const start = Date.UTC(2026, 0, 1);
    mock.timers.enable({ apis: ['Date'], now: start });
    await killTmsfReleases('missing_on_providers');

    mock.timers.setTime(start + 29 * 86_400_000);
    let out = await demoteFailingGroups(streams(), {
      kind: 'series',
      imdbId: CASTLE.imdbId,
    });
    assert.deepEqual(ids(out), ['b', 'd', 'e', 'a', 'c']);

    mock.timers.setTime(start + 31 * 86_400_000);
    out = await demoteFailingGroups(streams(), {
      kind: 'series',
      imdbId: CASTLE.imdbId,
    });
    assert.deepEqual(ids(out), ['a', 'b', 'c', 'd', 'e']);
  });

  test('a configured window and threshold apply', async () => {
    await settingsStore.set('releaseBlocklist.groupDemotionThreshold', 4);
    await killTmsfReleases('missing_on_providers');
    let out = await demoteFailingGroups(streams(), {
      kind: 'series',
      imdbId: CASTLE.imdbId,
    });
    assert.deepEqual(ids(out), ['a', 'b', 'c', 'd', 'e']);
    await reportReleaseFailure('missing_on_providers', [wd1(150)], {
      filename: castleFile(9),
      title: episode(CASTLE, 9),
    });
    out = await demoteFailingGroups(streams(), {
      kind: 'series',
      imdbId: CASTLE.imdbId,
    });
    assert.deepEqual(ids(out), ['b', 'd', 'e', 'a', 'c']);
  });

  test('a threshold of 0 turns demotion off', async () => {
    await settingsStore.set('releaseBlocklist.groupDemotionThreshold', 0);
    await killTmsfReleases('missing_on_providers');
    const out = await demoteFailingGroups(streams(), {
      kind: 'series',
      imdbId: CASTLE.imdbId,
    });
    assert.deepEqual(ids(out), ['a', 'b', 'c', 'd', 'e']);
  });

  test('a successful play of the group clears the demotion', async () => {
    await killTmsfReleases('missing_on_providers');
    await reportReleaseSuccess([wd1(200)], {
      filename: castleFile(12),
      title: episode(CASTLE, 12),
    });
    const out = await demoteFailingGroups(streams(), {
      kind: 'series',
      imdbId: CASTLE.imdbId,
    });
    assert.deepEqual(ids(out), ['a', 'b', 'c', 'd', 'e']);
  });

  test('a success of another group keeps the demotion', async () => {
    await killTmsfReleases('missing_on_providers');
    await reportReleaseSuccess([wd1(201)], {
      filename: castleFile(12, 'NTb'),
      title: episode(CASTLE, 12),
    });
    const out = await demoteFailingGroups(streams(), {
      kind: 'series',
      imdbId: CASTLE.imdbId,
    });
    assert.deepEqual(ids(out), ['b', 'd', 'e', 'a', 'c']);
  });

  test('a store error fails open', async () => {
    await killTmsfReleases('missing_on_providers');
    mock.method(ReleaseFailuresRepository, 'demotedGroups', async () => {
      throw new Error('database is locked');
    });
    const input = streams();
    const out = await demoteFailingGroups(input, {
      kind: 'series',
      imdbId: CASTLE.imdbId,
    });
    assert.deepEqual(ids(out), ['a', 'b', 'c', 'd', 'e']);
  });

  test('a penalty write error does not break the failure report', async () => {
    mock.method(ReleaseFailuresRepository, 'addGroupPenalty', async () => {
      throw new Error('database is locked');
    });
    await assert.doesNotReject(() =>
      reportReleaseFailure('missing_on_providers', [wd1(300)], {
        filename: castleFile(1),
        title: episode(CASTLE, 1),
      })
    );
  });
});
