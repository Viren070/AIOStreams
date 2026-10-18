import {
  seriesContext,
  release as makeTestRelease,
  catalogue,
} from '../../test/title-fixtures.js';
import './filterer.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import StreamFilterer from './filterer.js';
import { TMDBMetadata } from '../metadata/tmdb.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { RegexAccess } from '../utils/regex-access.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import { initialiseTestSettings, mockHttp } from '../../test/helpers.js';

it('retains explicit matching country tags when a same-name competitor has no country, without exempting bare titles or known same-country remakes', async (t) => {
  await initialiseTestSettings(t);
  mockHttp(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => null);
  t.mock.method(TMDBMetadata.prototype, 'getSeasonBound', async () => {
    throw new Error('unavailable');
  });
  t.mock.method(TMDBMetadata.prototype, 'getEpisodeCatalog', async () => {
    throw new Error('unavailable');
  });
  const filenames = [
    'I.Can.See.Your.Voice.US.S02E06.1080p.WEB.h264-BAE.mkv',
    'i.can.see.your.voice.us.s02e06.720p.web.h264-bae.mkv',
    'I.Can.See.Your.Voice.US.S02E06.1080p.HEVC.x265-MeGusta.mkv',
    'I.Can.See.Your.Voice.UK.S02E06.1080p.mkv',
    'I.Can.See.Your.Voice.BE.S02E06.1080p.mkv',
    'I.Can.See.Your.Voice.S02E06.1080p.mkv',
    'Unrelated.Show.US.S02E06.1080p.mkv',
    'I.Can.See.Your.Voice.US.2017.S02E06.1080p.mkv',
    'I.Can.See.Your.Voice.US.S02E07.1080p.mkv',
    'I.Can.See.Your.Voice.US.S03E06.1080p.mkv',
  ];
  for (const primaryTitle of [
    'I Can See Your Voice (US)',
    'I Can See Your Voice',
  ])
    for (const country of [undefined, 'US']) {
      const context = seriesContext(
        {
          title: primaryTitle,
          titles: [
            { title: 'I Can See Your Voice (US)' },
            { title: 'I Can See Your Voice' },
          ],
          country: 'US',
          year: 2020,
          releaseYears: [2020, 2022],
          genres: ['Reality'],
          tmdbId: 110494,
          tvdbId: 387526,
          titleConflicts: [
            {
              title: 'I Can See Your Voice',
              year: 2015,
              country: 'KR',
              tmdbId: 71959,
            },
            {
              title: 'I Can See Your Voice',
              year: 2017,
              country,
              tmdbId: 105295,
            },
            {
              title: 'I Can See Your Voice',
              year: 2020,
              country: 'NL',
              tmdbId: 124035,
            },
            {
              title: 'I Can See Your Voice (UK)',
              year: 2021,
              country: 'GB',
              tvdbId: 387536,
            },
            {
              title: 'I Can See Your Voice (BE)',
              year: 2022,
              country: 'BE',
              tvdbId: 424760,
            },
          ],
        },
        {
          id: 'tt11710130:2:6',
          parsedId: {
            type: 'imdbId',
            value: 'tt11710130',
            season: '2',
            episode: '6',
          },
        }
      );
      const releases = filenames.map((name, i) =>
        makeTestRelease(name, { id: String(i) })
      );
      releases.push(
        makeTestRelease(filenames[5], { id: 'id-search', idMatched: true }),
        makeTestRelease(filenames[3], {
          id: 'wrong-country-id-search',
          idMatched: true,
        }),
        makeTestRelease(filenames[0], {
          id: 'contradictory-id',
          releaseIds: { tvdbId: 387536 },
        }),
        makeTestRelease(filenames[5], {
          id: 'item-id-only',
          releaseIds: { tvdbId: 387526 },
        })
      );
      const kept = await new StreamFilterer({
        titleMatching: {
          enabled: true,
          mode: 'exact',
          ambiguousResults: 'discard',
        },
        yearMatching: { enabled: true },
        seasonEpisodeMatching: { enabled: true },
      } as UserData).filter(releases, context);
      assert.deepEqual(
        kept.map((s) => s.id),
        country ? ['id-search'] : ['0', '1', '2', 'id-search']
      );
      assert.equal(
        (
          await new StreamFilterer({
            titleMatching: {
              enabled: true,
              mode: 'exact',
              ambiguousResults: 'discard',
            },
          } as UserData).filter([makeTestRelease(filenames[7])], context)
        ).length,
        country ? 0 : 1,
        'a disabled year filter stays disabled'
      );
    }
});

it('keeps country/year recovery independent of ongoing or missing competitor bounds through the full filter', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  let provider: 'closed' | 'ongoing' | 'missing' = 'closed';
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (tvdbId) =>
    catalogue(tvdbId, [1], 'Ended', { title: 'Love Island' })
  );
  t.mock.method(TMDBMetadata.prototype, 'getSeasonBound', async (id) => {
    if (id === 90522 && provider !== 'closed')
      throw new Error('no final bound');
    return 1;
  });
  t.mock.method(TMDBMetadata.prototype, 'getEpisodeCatalog', async (tmdbId) => {
    if (tmdbId === 90522 && provider === 'missing')
      throw new Error('unavailable');
    return {
      tmdbId,
      status:
        tmdbId === 90522 && provider === 'ongoing'
          ? 'Returning Series'
          : 'Ended',
      episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
    };
  });
  const conflicts = [
    { title: 'Love Island', year: 2019, country: 'BE', tmdbId: 90522 },
    { title: 'Love Island (HU)', year: 2019, country: 'HU', tvdbId: 369293 },
    { title: 'Love Island France', year: 2020, country: 'FR', tmdbId: 100011 },
    { title: 'Love Island', year: 2021, country: 'CZ', tmdbId: 134156 },
    { title: 'Love Island Spain', year: 2021, country: 'ES', tmdbId: 121726 },
    { title: 'Love Island', year: 2021, country: 'ZA', tmdbId: 127970 },
  ];
  for (const season of [1, 13])
    for (const aliases of [false, true]) {
      const context = seriesContext(
        {
          title: 'Love Island',
          genres: ['Reality'],
          tvdbId: 296669,
          titles: (aliases
            ? ['Love Island', 'Love Island UK', 'Love Island (UK)']
            : ['Love Island']
          ).map((title) => ({ title })),
          year: 2015,
          country: 'GB',
          releaseYears: [2015],
          seasons: [{ season_number: season, episode_count: 57 }],
          titleConflicts: conflicts,
          isDateBased: season === 13,
          episodeAirDate: '2026-06-04',
        },
        {
          id: `tt4770018:${season}:4`,
          parsedId: {
            type: 'imdbId',
            value: 'tt4770018',
            season: String(season),
            episode: '4',
          },
        }
      );
      for (const state of ['closed', 'ongoing', 'missing'] as const) {
        provider = state;
        const filenames = [
          `Love.Island.S${String(season).padStart(2, '0')}E04.mkv`,
          ...['UK', 'Uk', 'uk', 'US', 'Us', 'us', '2015', '2019'].map(
            (tag) =>
              `Love.Island.${tag}.S${String(season).padStart(2, '0')}E04.mkv`
          ),
          'Love.Island.2026.06.04.mkv',
          'Love.Island.uk.2026.06.04.mkv',
        ];
        const releases = filenames.map((filename, i) =>
          makeTestRelease(filename, { id: String(i) })
        ) as ParsedStream[];
        releases.push(
          { ...releases[0], id: 'id-search', idMatched: true },
          {
            ...releases[0],
            id: 'item-id-only',
            releaseIds: { tvdbId: 296669 },
          },
          { ...releases[4], id: 'id-search-wrong-country', idMatched: true },
          { ...releases[8], id: 'id-search-wrong-year', idMatched: true },
          { ...releases[9], id: 'id-search-date-only', idMatched: true }
        );
        const kept = await new StreamFilterer({
          tmdbApiKey: 'test',
          titleMatching: {
            enabled: true,
            mode: 'exact',
            ambiguousResults: 'discard',
          },
        } as UserData).filter(releases, context);
        assert.deepEqual(
          kept.map((s) => s.id),
          [
            '0',
            '1',
            '2',
            '3',
            '7',
            '8',
            '9',
            '10',
            'id-search',
            'item-id-only',
            'id-search-wrong-year',
            'id-search-date-only',
          ],
          `season ${season}, aliases ${aliases}, ${state}`
        );
      }
    }
});
