import {
  release as makeTestRelease,
  seriesContext,
  catalogue,
} from '../../test/title-fixtures.js';
import './filterer.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import StreamFilterer from './filterer.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { RegexAccess } from '../utils/regex-access.js';
import type { Metadata } from '../metadata/utils.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import {
  initialiseTestSettings,
  createTestStreamContext,
} from '../../test/helpers.js';
const options = {
  titleMatching: { enabled: true, ambiguousResults: 'discard', mode: 'exact' },
  yearMatching: { enabled: true },
  seasonEpisodeMatching: { enabled: true },
  episodeTitleMatching: { enabled: true },
} as UserData;
const release = (name: string, idMatched?: boolean) =>
  makeTestRelease(name, { id: name, idMatched: idMatched }) as ParsedStream;
const context = (metadata: Metadata) =>
  seriesContext(metadata, {
    id: 'tt1234567:1:4',
    parsedId: { type: 'imdbId', value: 'tt1234567', season: '1', episode: '4' },
  });

it('retains yearless remake protection and catalogue recovery for unrelated series names', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (tvdbId) => ({
    tvdbId,
    title: 'Shared',
    status: 'Ended',
    episodes: Array.from({ length: 12 }, (_, i) => ({
      seasonNumber: 1,
      episodeNumber: i + 1,
      title:
        i === 3
          ? tvdbId === 1
            ? 'Departure to Another Town'
            : 'Meeting the Family'
          : `Episode ${i + 1}`,
    })),
  }));
  for (const title of ['Fruits Basket', 'Shared Chronicle']) {
    const metadata: Metadata = {
      title,
      titles: [{ title }],
      year: 2001,
      country: 'JP',
      genres: ['Animation'],
      tvdbId: 1,
      titleConflicts: [{ title, year: 2019, country: 'JP', tvdbId: 2 }],
    };
    const names = [
      `${title}.S01E04.Departure.to.Another.Town.mkv`,
      `${title}.S01E04.Meeting.the.Family.mkv`,
      `${title}.S01E04.mkv`,
    ];
    const kept = await new StreamFilterer(options).filter(
      names.map((name) => release(name)),
      context(metadata)
    );
    assert.deepEqual(
      kept.map((s) => s.filename),
      [names[0]],
      'only independently identified original survives without a year'
    );
    assert.equal(
      (
        await new StreamFilterer(options).filter(
          [release(names[2], true)],
          context(metadata)
        )
      ).length,
      1
    );
  }
});

it('accepts bare canonical reality editions without exempting same-country remakes, unknown genres or country-qualified requests', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  let reads = 0;
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => {
    reads++;
    return null;
  });
  for (const title of ['Love Island', 'Harbour House']) {
    const metadata: Metadata = {
      title,
      titles: [{ title }],
      country: 'GB',
      genres: ['Reality'],
      titleConflicts: [{ title, country: 'US', tvdbId: 2 }],
    };
    const bare = `${title}.S01E04.mkv`;
    assert.equal(
      (
        await new StreamFilterer(options).filter(
          [release(bare)],
          context(metadata)
        )
      ).length,
      1
    );
    assert.equal(reads, 0, 'country-edition titles need no catalogue');
    assert.equal(
      (
        await new StreamFilterer(options).filter(
          [release(`${title}.Us.S01E04.mkv`)],
          context(metadata)
        )
      ).length,
      0
    );
    for (const extra of [
      { genres: undefined },
      { genres: ['Drama'] },
      { title: title + ' (UK)' },
      { titleConflicts: [{ title, country: 'GB', tvdbId: 2 }] },
    ]) {
      assert.equal(
        (
          await new StreamFilterer(options).filter(
            [release(bare)],
            context({ ...metadata, ...extra })
          )
        ).length,
        0
      );
    }
    reads = 0;
  }
});

it('uses configured year compatibility for identity and leaves disabled or excluded year checks disabled', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (tvdbId) =>
    catalogue(tvdbId, [1], 'Ended', { title: 'Shared' })
  );
  const metadata: Metadata = {
    title: 'Shared',
    titles: [{ title: 'Shared' }],
    year: 2001,
    yearEnd: 2010,
    country: 'JP',
    titleConflicts: [{ title: 'Shared', year: 2021, country: 'JP', tvdbId: 2 }],
  };
  for (const idMatched of [undefined, true]) {
    for (const yearMatching of [
      undefined,
      { enabled: false },
      { enabled: true, addons: ['other'] },
      { enabled: true, requestTypes: ['movie'] },
    ] as UserData['yearMatching'][]) {
      assert.equal(
        (
          await new StreamFilterer({ ...options, yearMatching }).filter(
            [release('Shared.2021.S01E04.mkv', idMatched)],
            context(metadata)
          )
        ).length,
        1,
        'catalogue/ID evidence cannot re-enable a year check'
      );
    }
    assert.equal(
      (
        await new StreamFilterer({
          ...options,
          yearMatching: { enabled: true, tolerance: 0 },
        }).filter(
          [release('Shared.2021.S01E04.mkv', idMatched)],
          context(metadata)
        )
      ).length,
      0
    );
    assert.equal(
      (
        await new StreamFilterer({
          ...options,
          yearMatching: { enabled: true },
        }).filter(
          [release('Shared.2008.S01E04.mkv', idMatched)],
          context(metadata)
        )
      ).length,
      1,
      'series-run year uses normal compatibility'
    );
    assert.equal(
      (
        await new StreamFilterer({
          ...options,
          yearMatching: { enabled: true, useInitialAirDate: true },
        }).filter(
          [release('Shared.2008.S01E04.mkv', idMatched)],
          context(metadata)
        )
      ).length,
      0
    );
  }
});

it('uses an identifying filename year without turning a disabled year filter into a veto', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => {
    assert.fail('the filename year already resolves identity');
  });
  const metadata: Metadata = {
    title: 'Shared',
    titles: [{ title: 'Shared' }],
    year: 2001,
    country: 'JP',
    titleConflicts: [{ title: 'Shared', year: 2021, country: 'JP', tvdbId: 2 }],
  };
  assert.equal(
    (
      await new StreamFilterer({
        ...options,
        yearMatching: { enabled: false },
      }).filter([release('Shared.2001.S01E04.mkv')], context(metadata))
    ).length,
    1
  );
});

it('preserves the ordinary strict-year default for movies', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  const movieContext = createTestStreamContext({
    type: 'movie',
    isAnime: false,
    id: 'tt1234567',
    parsedId: { type: 'imdbId', value: 'tt1234567' },
    getMetadata: async () => ({
      title: 'Shared',
      titles: [{ title: 'Shared' }],
      year: 2001,
    }),
  });
  for (const strict of [undefined, true, false]) {
    const yearMatching =
      strict === undefined ? { enabled: true } : { enabled: true, strict };
    const kept = await new StreamFilterer({ ...options, yearMatching }).filter(
      [release('Shared.mkv')],
      movieContext
    );
    assert.equal(kept.length, strict === false ? 1 : 0);
  }
});
