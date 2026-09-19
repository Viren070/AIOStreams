import { before, after, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import StreamFilterer from './filterer.js';
import FileParser from '../parser/file.js';
import type { StreamContext, ExtendedMetadata } from './context.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { ReleaseBlocklistRepository } from '../db/repositories/release-blocklist.js';
import { RegexAccess } from '../utils/regex-access.js';

before(async () => {
  mock.method(SettingsRepository, 'getAll', async () => []);
  mock.method(SettingsRepository, 'getVersion', async () => 0);
  mock.method(ReleaseBlocklistRepository, 'hasEntries', async () => false);
  mock.method(RegexAccess, 'isRegexAllowed', async () => true);
  await settingsStore.initialise();
});
after(() => mock.restoreAll());

const seasons = [28, 26, 28, 24, 28, 28, 31, 26, 35, 31].map(
  (episode_count, index) => ({ season_number: index + 1, episode_count })
);

function makeContext(
  episode: number,
  options: { isAnime?: boolean; metadata?: Partial<ExtendedMetadata> } = {}
) {
  const metadata: ExtendedMetadata = {
    title: 'Detective Conan',
    titles: [{ title: 'Detective Conan' }],
    seasons,
    absoluteEpisode: 219 + episode,
    resolvedSeasonNumber: 9,
    resolvedSeasonFirstEpisode: 1,
    ...options.metadata,
  };
  return {
    type: 'series',
    id: `tt0131179:9:${episode}`,
    parsedId: {
      type: 'imdbId',
      value: 'tt0131179',
      season: '9',
      episode: String(episode),
    },
    isAnime: options.isAnime ?? true,
    animeEntry: null,
    getMetadata: async () => metadata,
    getReleaseDates: async () => undefined,
    getEpisodeAirDate: async () => undefined,
    getEpisodeRuntime: async () => undefined,
    toExpressionContext: () => ({ type: 'series', isAnime: true }),
  } as unknown as StreamContext;
}

function makeStream(token: string): ParsedStream {
  const filename = `Detective Conan (2001) ${token}.mkv`;
  return {
    id: token,
    type: 'usenet',
    filename,
    parsedFile: FileParser.parse(filename),
    addon: { name: 'Test', preset: { id: 'test' } },
  } as ParsedStream;
}

function makeFilterer() {
  return new StreamFilterer({
    seasonEpisodeMatching: { enabled: true, strict: true },
    titleMatching: { enabled: true, strict: true },
  } as unknown as UserData);
}

describe('strict filtering of anime season + absolute episode filenames', () => {
  it('handles S11 absolute 305 independently of the parsed filename spelling', async () => {
    const context = makeContext(20, {
      metadata: {
        absoluteEpisode: 305,
        resolvedSeasonNumber: 11,
        seasons: [
          ...seasons,
          { season_number: 11, episode_count: 30 },
          { season_number: 12, episode_count: 38 },
        ],
      },
    });
    context.parsedId!.season = '11';
    const matching = [
      'S11E305',
      'S11 EP305',
      '11x305',
      'Season 11 Episode 305',
      'S11 0305',
      'S11E20',
    ];
    const wrong = [
      'S11E306',
      'S11 0306',
      'S11E305.5',
      'S11 E305v2.5',
      'S11 EP305.5',
      '11x305.5',
    ];
    const result = await makeFilterer().filter(
      [...matching, ...wrong].map(makeStream),
      context
    );
    assert.deepEqual(
      result.map((s) => s.id),
      matching
    );
  });

  for (const episode of [14, 24]) {
    it(`keeps the requested S09E${episode} and rejects 236/252 without expressions`, async () => {
      const absolute = 219 + episode;
      const matching = [
        `S09 E${absolute}`,
        `S09 0${absolute}`,
        `S09.-.${absolute}`,
        `S09E${episode}`,
      ];
      const streams = [
        ...matching,
        'S09 0236',
        'S09 0252',
        'S08 E233',
        'S09',
      ].map(makeStream);
      const filterer = makeFilterer();
      const context = makeContext(episode);
      const result = await filterer.filter(streams, context);
      assert.deepEqual(
        result.map((s) => s.id),
        [...matching, 'S09']
      );
      // Filtering the same objects again must retain the normalized coordinates.
      assert.deepEqual(
        (await filterer.filter(result, context)).map((s) => s.id),
        [...matching, 'S09']
      );
    });
  }

  it('does not enable the new absolute interpretation for non-anime', async () => {
    const result = await makeFilterer().filter(
      [makeStream('S09E233')],
      makeContext(14, { isAnime: false })
    );
    assert.equal(result.length, 0);
  });

  it('preserves local numbering when both E45 interpretations are possible', async () => {
    const context = makeContext(5, {
      metadata: {
        absoluteEpisode: 45,
        resolvedSeasonNumber: 3,
        seasons: [20, 20, 50, 12].map((episode_count, i) => ({
          season_number: i + 1,
          episode_count,
        })),
      },
    });
    context.parsedId!.season = '3';
    const stream = makeStream('S03E45');
    assert.equal((await makeFilterer().filter([stream], context)).length, 0);
    context.parsedId!.episode = '45';
    assert.equal(
      (await makeFilterer().filter([makeStream('S03E45')], context)).length,
      1
    );
  });
});
