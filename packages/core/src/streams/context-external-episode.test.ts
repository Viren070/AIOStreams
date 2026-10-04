import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnimeDatabase, type AnimeEntry } from '../utils/index.js';
import { MetadataService } from '../metadata/service.js';
import { TMDBMetadata } from '../metadata/tmdb.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { StreamSelector } from '../parser/streamExpression.js';
import { StreamContext } from './context.js';
import StreamFilterer from './filterer.js';
import { parseTorrentTitleCached } from '../parser/title.js';
import { isLocalEpisodeWrong } from '../anime-database/episode-titles.js';

// Date-only provider responses and the fixed clock below use UTC calendar days.
process.env.TZ = 'UTC';

const entry = {
  title: 'Bleach: Thousand-Year Blood War Part 4',
  mappings: { imdbId: 'tt0434665', themoviedbId: 30984, thetvdbId: 74796 },
  tmdb: { seasonNumber: 2, fromEpisode: 41 },
  tvdb: { seasonNumber: 17, fromEpisode: 41 },
  localEpisodeTitles: [
    'Bleach: Thousand-Year Blood War Part 4',
    'Bleach: Sennen Kessen-hen - Kashin-tan',
  ],
} as AnimeEntry;

describe('external anime episode dates in stream expressions', () => {
  for (const fixture of [
    {
      id: 'tt0434665:17:48',
      episode: 48,
      date: '2026-09-12',
      age: 0,
      tmdb: true,
    },
    {
      id: 'tt0434665:17:47',
      episode: 47,
      date: '2026-09-05',
      age: 7,
      tmdb: true,
    },
    {
      id: 'tvdb:74796:17:48',
      episode: 48,
      date: '2026-09-12',
      age: 0,
      tmdb: true,
    },
    {
      id: 'tmdb:30984:2:48',
      episode: 48,
      date: '2026-09-12',
      age: 0,
      tmdb: true,
    },
    {
      id: 'tt0434665:17:48',
      episode: 48,
      date: '2026-09-12',
      age: 0,
      tmdb: false,
    },
  ]) {
    it(`${fixture.id}, TMDB available: ${fixture.tmdb}`, async (t) => {
      t.mock.timers.enable({
        apis: ['Date'],
        now: new Date('2026-09-12T17:00:00Z'),
      });
      t.mock.method(SettingsRepository, 'getAll', async () => []);
      t.mock.method(SettingsRepository, 'getVersion', async () => 0);
      await settingsStore.initialise();
      t.mock.method(AnimeDatabase, 'getInstance', () => ({
        getEntryById: async () => entry,
      }));
      t.mock.method(MetadataService.prototype, 'getMetadata', async () => ({
        title: 'Bleach',
        tmdbId: 30984,
        releaseDate: '2004-10-05',
        episodeAirDate: fixture.date,
        runtime: 24,
      }));
      const details = t.mock.method(
        TMDBMetadata.prototype,
        'getEpisodeDetails',
        async () =>
          fixture.tmdb ? { airDate: fixture.date, runtime: 23 } : undefined
      );
      const context = await StreamContext.create('series', fixture.id, {
        tmdbApiKey: 'test',
      } as UserData);
      await context.getMetadata();
      assert.equal(await context.getEpisodeAirDate(), fixture.date);
      assert.deepEqual(details.mock.calls[0].arguments, [
        30984,
        2,
        fixture.episode,
      ]);
      assert.equal(context.toExpressionContext().daysSinceRelease, fixture.age);
      assert.equal(
        context.toExpressionContext().relativeAbsoluteEpisode,
        fixture.episode - 40
      );
      assert.equal(context.toFormatterContext().daysSinceRelease, fixture.age);
      if (fixture.tmdb) assert.equal(await context.getEpisodeRuntime(), 23);
      const selector = new (class extends StreamSelector {
        fixture(overrides: Partial<ParsedStream>) {
          return this.createTestStream(overrides);
        }
      })(context.toExpressionContext());
      const ancient = selector.fixture({
        id: 'ancient',
        type: 'usenet',
        age: 5844 * 24,
      });
      const recent = selector.fixture({ id: 'recent', type: 'usenet', age: 1 });
      assert.deepEqual(
        (
          await selector.select(
            [ancient, recent],
            "((queryType == 'series' or queryType == 'anime.series' or queryType == 'movie' or queryType == 'anime.movie') and daysSinceRelease >= 0 and daysSinceRelease <= 120) ? age(streams, max(48, (daysSinceRelease + 2) * 24)) : []"
          )
        ).map((s) => s.id),
        ['ancient']
      );
    });
  }

  it('uses TMDB when no resolved episode date exists', async (t) => {
    t.mock.timers.enable({
      apis: ['Date'],
      now: new Date('2026-09-12T17:00:00Z'),
    });
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    t.mock.method(AnimeDatabase, 'getInstance', () => ({
      getEntryById: async () => entry,
    }));
    t.mock.method(MetadataService.prototype, 'getMetadata', async () => ({
      tmdbId: 30984,
      releaseDate: '2004-10-05',
    }));
    t.mock.method(TMDBMetadata.prototype, 'getEpisodeDetails', async () => ({
      airDate: '2026-09-12',
    }));
    const context = await StreamContext.create('series', 'tt0434665:17:48', {
      tmdbApiKey: 'test',
    } as UserData);
    await context.getEpisodeAirDate();
    assert.equal(context.toExpressionContext().daysSinceRelease, 0);
  });
});

for (const strict of [false, true]) {
  it(`rejects wrong-part local episodes using normal matching only (strict=${strict})`, async (t) => {
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    t.mock.method(AnimeDatabase, 'getInstance', () => ({
      getEntryById: async () => entry,
    }));
    t.mock.method(MetadataService.prototype, 'getMetadata', async () => ({
      title: 'Bleach',
      titles: [{ title: 'Bleach' }],
      seasons: [
        20, 21, 22, 28, 18, 22, 20, 16, 22, 16, 7, 17, 36, 51, 26, 24,
      ].map((n, i) => ({ season_number: i + 1, episode_count: n })),
    }));
    const userData = {
      seasonEpisodeMatching: { enabled: true, strict },
      // No stream expressions or age/title filters: numbering must stand alone.
    } as UserData;
    const context = await StreamContext.create(
      'series',
      'tt0434665:17:48',
      userData
    );
    const fixtures = new (class extends StreamSelector {
      stream(overrides: Partial<ParsedStream>) {
        return this.createTestStream(overrides);
      }
    })({});
    const releases = [
      [
        'correct-local',
        'Bleach - Sennen Kessen Hen - Kashin Tan - 08 [1080p].mkv',
      ],
      ['correct-external', 'Bleach S17E48 1080p.mkv'],
      ['correct-absolute', 'Bleach - 414 [1080p].mkv'],
      [
        'correct-batch',
        'Bleach - 08 [1080p].mkv',
        'Bleach: Thousand-Year Blood War Part 4',
      ],
      ['wrong-base', 'Bleach - 08 [1080p].mkv'],
      [
        'wrong-batch',
        'Bleach - 08 [1080p].mkv',
        'Bleach: Thousand-Year Blood War Part 3',
      ],
      [
        'wrong-file-part',
        'Bleach - Sennen Kessen Hen - Soukoku Tan - 08 [1080p].mkv',
        'Bleach: Thousand-Year Blood War Part 4',
      ],
      [
        'wrong-folder-episode',
        'Bleach - 08 [1080p].mkv',
        'Bleach - Sennen Kessen Hen - Kashin Tan - 09 [1080p]',
      ],
      [
        'wrong-part',
        'Bleach - Sennen Kessen Hen - Soukoku Tan - 08 [1080p].mkv',
      ],
      [
        'wrong-part-season-one',
        'Bleach - Sennen Kessen Hen - Soukoku Tan S01E08 1080p.mkv',
      ],
    ];
    const streams = releases.map(([id, filename, folderName]) =>
      fixtures.stream({
        id,
        filename,
        folderName,
        parsedFile: parseTorrentTitleCached(filename),
        age: 1, // Even fresh reposts of the wrong part must be rejected.
      })
    );
    const metadata = await context.getMetadata();
    assert.equal(metadata?.relativeAbsoluteEpisode, 8);
    assert.deepEqual(metadata?.localEpisodeTitles, entry.localEpisodeTitles);
    const kept = await new StreamFilterer(userData).filter(streams, context);
    assert.deepEqual(
      kept.map((stream) => stream.id),
      ['correct-local', 'correct-external', 'correct-absolute', 'correct-batch']
    );
    // Built-in release validation must reject the same false local matches.
    for (const stream of streams) {
      assert.equal(
        isLocalEpisodeWrong(
          stream.parsedFile!,
          {
            episode: 48,
            absoluteEpisode: 414,
            relativeAbsoluteEpisode: 8,
            localEpisodeTitles: entry.localEpisodeTitles,
          },
          stream.folderName
            ? parseTorrentTitleCached(stream.folderName)
            : undefined
        ),
        stream.id.startsWith('wrong-')
      );
    }
  });
}

it('rejects a base-show episode on a sequel request without absolute episode metadata', async (t) => {
  t.mock.method(SettingsRepository, 'getAll', async () => []);
  t.mock.method(SettingsRepository, 'getVersion', async () => 0);
  await settingsStore.initialise();
  t.mock.method(AnimeDatabase, 'getInstance', () => ({
    getEntryById: async () => ({
      ...entry,
      title: 'Example Anime: Return',
      tvdb: { seasonNumber: 2, fromEpisode: 1 },
      localEpisodeTitles: ['Example Anime: Return'],
    }),
  }));
  t.mock.method(MetadataService.prototype, 'getMetadata', async () => ({
    title: 'Example Anime',
    titles: [{ title: 'Example Anime' }],
  }));
  const userData = {
    seasonEpisodeMatching: { enabled: true, strict: true },
  } as UserData;
  const context = await StreamContext.create(
    'series',
    'tt09999995:2:1',
    userData
  );
  const metadata = await context.getMetadata();
  assert.equal(metadata?.absoluteEpisode, undefined);
  assert.deepEqual(metadata?.localEpisodeTitles, ['Example Anime: Return']);
  const fixtures = new (class extends StreamSelector {
    stream(overrides: Partial<ParsedStream>) {
      return this.createTestStream(overrides);
    }
  })({});
  const streams = [
    'Example Anime - 01.mkv',
    'Example Anime Return - 01.mkv',
  ].map((filename, i) =>
    fixtures.stream({
      id: String(i),
      filename,
      folderName: undefined,
      parsedFile: parseTorrentTitleCached(filename),
    })
  );
  assert.deepEqual(
    (await new StreamFilterer(userData).filter(streams, context)).map(
      (s) => s.id
    ),
    ['1']
  );
});

for (const episode of [47, 48]) {
  for (const strict of [false, true]) {
    it(`rejects old season/absolute pairs for E${episode} with normal matching (strict=${strict})`, async (t) => {
      t.mock.method(SettingsRepository, 'getAll', async () => []);
      t.mock.method(SettingsRepository, 'getVersion', async () => 0);
      await settingsStore.initialise();
      t.mock.method(AnimeDatabase, 'getInstance', () => ({
        getEntryById: async () => entry,
      }));
      t.mock.method(MetadataService.prototype, 'getMetadata', async () => ({
        title: 'Bleach',
        titles: [{ title: 'Bleach' }],
        seasons: [
          20, 21, 22, 28, 18, 22, 20, 16, 22, 16, 7, 17, 36, 51, 26, 24,
        ].map((count, i) => ({ season_number: i + 1, episode_count: count })),
      }));
      const userData = {
        seasonEpisodeMatching: { enabled: true, strict },
      } as UserData;
      const context = await StreamContext.create(
        'series',
        `tt0434665:17:${episode}`,
        userData
      );
      assert.equal(
        (await context.getMetadata())?.absoluteEpisode,
        episode + 366
      );
      const fixtures = new (class extends StreamSelector {
        stream(overrides: Partial<ParsedStream>) {
          return this.createTestStream(overrides);
        }
      })({});
      const names = [
        'Bleach.(2004)-S17E34-400-BABY.HOLD.YOUR.HAND.[WEBDL-1080p][8bit][h264][AAC.2.0][JA+EN]-VARYG.mkv',
        'Bleach.(2004)-S17E37-403-SHADOWS.GONE.[WEBDL-1080p][8bit][h264][AAC.2.0][JA]-VARYG.mkv',
        `Bleach S17E${episode}-${episode + 366} 1080p.mkv`,
        `Bleach S17E${episode} 1080p.mkv`,
        'Bleach S17E45-48 1080p.mkv',
      ];
      // Exercise both stream categories without any excluded expressions.
      for (const type of ['usenet', 'debrid'] as const) {
        const streams = names.map((filename, index) =>
          fixtures.stream({
            id: `${index}`,
            type,
            filename,
            folderName: undefined,
            parsedFile: parseTorrentTitleCached(filename),
            age: 1,
          })
        );
        assert.deepEqual(
          (await new StreamFilterer(userData).filter(streams, context)).map(
            (s) => s.id
          ),
          ['2', '3', '4']
        );
      }
    });
  }
}

for (const details of [
  undefined,
  { runtime: 23 },
  { runtime: 23, airDate: '2026-09-10' },
  { runtime: 23, airDate: '' },
]) {
  it(`uses consistent dates for expressions and digital-release filtering with details=${JSON.stringify(details)}`, async (t) => {
    t.mock.timers.enable({
      apis: ['Date'],
      now: new Date('2026-09-12T17:00:00Z'),
    });
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    t.mock.method(AnimeDatabase, 'getInstance', () => ({
      getEntryById: async () => entry,
    }));
    t.mock.method(MetadataService.prototype, 'getMetadata', async () => ({
      title: 'Bleach',
      tmdbId: 30984,
      releaseDate: '2004-10-05',
      episodeAirDate: '2026-09-12',
    }));
    const lookup = t.mock.method(
      TMDBMetadata.prototype,
      'getEpisodeDetails',
      async () => details
    );
    const userData = {
      tmdbApiKey: 'test',
      digitalReleaseFilter: { enabled: true, checkResultAge: true },
    } as UserData;
    const context = await StreamContext.create(
      'series',
      'tt0434665:17:48',
      userData
    );
    t.mock.method(context, 'getReleaseDates', async () => undefined);
    const expectedDate = details?.airDate || '2026-09-12';
    assert.equal(await context.getEpisodeAirDate(), expectedDate);
    assert.equal(await context.getEpisodeAirDate(), expectedDate);
    assert.equal(
      context.toExpressionContext().daysSinceRelease,
      details?.airDate ? 2 : 0
    );
    assert.equal(
      context.toFormatterContext().daysSinceRelease,
      details?.airDate ? 2 : 0
    );
    assert.equal(lookup.mock.callCount(), 1);
    const fixture = new (class extends StreamSelector {
      stream(overrides: Partial<ParsedStream>) {
        return this.createTestStream(overrides);
      }
    })({});
    const streams = [
      fixture.stream({ id: 'old', type: 'usenet', age: 72 }),
      fixture.stream({ id: 'between', type: 'usenet', age: 40 }),
      fixture.stream({ id: 'recent', type: 'usenet', age: 1 }),
    ];
    assert.deepEqual(
      (await new StreamFilterer(userData).filter(streams, context)).map(
        (s) => s.id
      ),
      details?.airDate ? ['between', 'recent'] : ['recent']
    );
  });
}
