import './filterer.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import StreamFilterer from './filterer.js';
import FileParser from '../parser/file.js';
import { TMDBMetadata } from '../metadata/tmdb.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { RegexAccess } from '../utils/regex-access.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import {
  initialiseTestSettings,
  createTestStreamContext,
} from '../../test/helpers.js';

it('keeps country/year recovery independent of ongoing or missing competitor bounds through the full filter', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  let provider: 'closed' | 'ongoing' | 'missing' = 'closed';
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async (tvdbId) => ({
    tvdbId,
    title: 'Love Island',
    status: 'Ended',
    episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
  }));
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
      const context = createTestStreamContext({
        type: 'series',
        id: `tt4770018:${season}:4`,
        isAnime: false,
        parsedId: {
          type: 'imdbId',
          value: 'tt4770018',
          season: String(season),
          episode: '4',
        },
        getMetadata: async () => ({
          title: 'Love Island',
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
        }),
      });
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
        const releases = filenames.map((filename, i) => ({
          id: String(i),
          type: 'usenet',
          filename,
          parsedFile: FileParser.parse(filename),
          addon: { preset: { id: 'newznab' } },
        })) as ParsedStream[];
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
            ...(state === 'closed' ? ['0'] : []),
            '1',
            '2',
            '3',
            '7',
            '10',
            'id-search',
            ...(state === 'closed' ? ['item-id-only'] : []),
            'id-search-date-only',
          ],
          `season ${season}, aliases ${aliases}, ${state}`
        );
      }
    }
});
