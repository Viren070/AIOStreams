import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTorrentTitle } from '@viren070/parse-torrent-title';
import type { Metadata, TitleConflict } from '../metadata/utils.js';
import { normaliseTitle } from '../parser/utils.js';
import StreamFilterer from './filterer.js';
import FileParser from '../parser/file.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { TMDBMetadata } from '../metadata/tmdb.js';
import { TVDBMetadata } from '../metadata/tvdb.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import type { StreamContext } from './context.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { RegexAccess } from '../utils/regex-access.js';
import {
  confirmsTitleIdentity,
  getStreamTitleConflicts,
} from './title-conflicts.js';

const anime: Metadata = {
  title: 'Katekyo Hitman Reborn!',
  titles: [
    { title: 'Katekyo Hitman Reborn!' },
    { title: 'Reborn!' },
    { title: 'Reborn' },
    { title: '家庭教師ヒットマンREBORN!' },
  ],
  year: 2006,
  country: 'JP',
  releaseYears: [2006],
  tmdbId: 45857,
  tvdbId: 80975,
};
const other: TitleConflict = { title: 'Reborn', year: 2025, country: 'CN' };

describe('conflicting release aliases', () => {
  it('rejects both yearless Reborn releases from the report, preserving the distinctive anime title', async () => {
    const names = [
      'Reborn.S01E01.Episode.1.1080p.NF.WEB-DL.AAC2.0.H.264-RUDR.mkv',
      'Reborn.S01E01.Episode.1.1080p.NF.WEB-DL.AAC.2.0.H.264-CHDWEB.mkv',
      'Katekyo.Hitman.Reborn.S01E01.1080p.AO.WEB-DL.AAC2.0.H.264.DUAL-OLYMPUS.mkv',
      'Reborn!.S01E01.1080p.WEB-DL.mkv',
      'Reborn!.-.E01.mkv',
    ];
    const parsed = names.map((name) => parseTorrentTitle(name));
    const queries: string[] = [];
    const found = await getStreamTitleConflicts(
      anime,
      parsed.map((item) => item.title!),
      {},
      async (input) => {
        queries.push(input.title);
        assert.equal(input.tmdbId, anime.tmdbId);
        assert.equal(input.tvdbId, anime.tvdbId);
        return [other];
      }
    );
    assert.equal(
      queries.length,
      1,
      'deduplicate punctuation variants and releases'
    );
    assert.equal(normaliseTitle(queries[0]), 'reborn');
    const kept = parsed.map((item) =>
      confirmsTitleIdentity(
        anime,
        found.get(normaliseTitle(item.title!)) ?? [],
        {
          year: item.year,
          country: item.country,
          episodeTitleMatches: undefined,
        }
      )
    );
    assert.deepEqual(kept, [false, false, true, false, false]);
  });

  it('handles a missing primary title without inventing an alias conflict', async () => {
    const found = await getStreamTitleConflicts(
      { titles: [] } as unknown as Metadata,
      ['Example'],
      {},
      async () => {
        assert.fail('unknown stream titles must not trigger alias searches');
      }
    );
    assert.equal(found.get('example'), undefined);
  });

  it('does not search unrelated releases or unused translations', async () => {
    await getStreamTitleConflicts(
      anime,
      ['Other Show', anime.title],
      {},
      async () => {
        assert.fail('no alias lookup should be needed');
      }
    );
  });

  it('preserves releases when lookup fails or finds no conflict', async () => {
    for (const detect of [
      async () => [],
      async () => {
        throw new Error('offline');
      },
    ]) {
      const found = await getStreamTitleConflicts(
        anime,
        ['Reborn'],
        {},
        detect
      );
      assert.equal(
        confirmsTitleIdentity(anime, found.get('reborn')!, {}),
        true
      );
    }
  });

  it('reuses primary-title conflicts without making another lookup', async () => {
    const metadata = { ...anime, title: 'Reborn!', titleConflicts: [other] };
    const found = await getStreamTitleConflicts(
      metadata,
      ['Reborn'],
      {},
      async () => {
        assert.fail('primary conflict detection already ran');
      }
    );
    assert.equal(
      confirmsTitleIdentity(metadata, found.get('reborn')!, {}),
      false
    );
    assert.deepEqual(metadata.titleConflicts, [other]);
  });
});

describe('evidence for an ambiguous title', () => {
  it('accepts numeric year evidence and rejects non-finite or non-year values', () => {
    assert.equal(confirmsTitleIdentity(anime, [other], { year: 2006 }), true);
    assert.equal(confirmsTitleIdentity(anime, [other], { year: 2025 }), false);
    for (const year of [NaN, Infinity, 2006.5]) {
      assert.equal(confirmsTitleIdentity(anime, [other], { year }), false);
    }
  });

  it('requires evidence even for the older show', () => {
    assert.equal(confirmsTitleIdentity(anime, [other], {}), false);
    assert.equal(confirmsTitleIdentity(anime, [other], { year: '2006' }), true);
    assert.equal(
      confirmsTitleIdentity(anime, [other], { year: '2025' }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(anime, [other], { country: 'JP' }),
      true
    );
    assert.equal(
      confirmsTitleIdentity(anime, [other], { episodeTitleMatches: true }),
      true
    );
  });

  it('does not treat a shared country or year as identifying evidence', () => {
    assert.equal(
      confirmsTitleIdentity(anime, [{ ...other, country: 'JP' }], {
        country: 'JP',
      }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(anime, [{ ...other, year: 2007 }], {
        year: '2006',
      }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(anime, [other], { year: '2006-2025' }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(anime, [{ title: 'Reborn' }], {
        year: '2006',
        country: 'JP',
      }),
      false
    );
  });

  it('accepts an identifying requested season year and ordinary unambiguous releases', () => {
    assert.equal(
      confirmsTitleIdentity({ ...anime, releaseYears: [2006, 2009] }, [other], {
        year: '2009',
      }),
      true
    );
    assert.equal(confirmsTitleIdentity(anime, [], {}), true);
  });

  it('uses bounded year ranges only when they include the request and exclude every competing year', () => {
    const requested = { ...anime, year: 2005, releaseYears: [2005] };
    const conflicts = [{ title: 'Another series', year: 2024 }];
    assert.equal(
      confirmsTitleIdentity(requested, conflicts, { year: '2005-2008' }),
      true
    );
    assert.equal(
      confirmsTitleIdentity(requested, conflicts, { year: '2003-2008' }),
      true
    );
    for (const year of [
      '2005-2024',
      '2005-2023',
      '2008-2005',
      '2020-2022',
      '2005-',
      '2005-2008-2024',
    ]) {
      assert.equal(
        confirmsTitleIdentity(requested, conflicts, { year }),
        false,
        year
      );
    }
    assert.equal(
      confirmsTitleIdentity(requested, [{ title: 'Unknown year' }], {
        year: '2005-2008',
      }),
      false
    );
  });

  it('combines year and country to exclude different competitors without treating unknown metadata as proof', () => {
    const requested = {
      ...anime,
      title: 'Reborn',
      year: 2025,
      releaseYears: [2025],
      country: 'CN',
    };
    const conflicts = [
      { title: 'Reborn', year: 2020, country: 'CN' },
      { title: 'Reborn', year: 2025, country: 'TR' },
      { title: 'Reborn', year: 2009 },
      { title: 'Reborn', country: 'KR' },
    ];
    assert.equal(
      confirmsTitleIdentity(requested, conflicts, {
        year: '2025',
        country: 'CN',
      }),
      true
    );
    assert.equal(
      confirmsTitleIdentity(requested, conflicts, { year: '2025' }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(requested, conflicts, { country: 'CN' }),
      false
    );
    assert.equal(
      confirmsTitleIdentity(
        requested,
        [...conflicts, { title: 'Reborn', year: 2025 }],
        { year: '2025', country: 'CN' }
      ),
      false
    );
    assert.equal(
      confirmsTitleIdentity(
        requested,
        [...conflicts, { title: 'Reborn', country: 'CN' }],
        { year: '2025', country: 'CN' }
      ),
      false
    );
    assert.equal(
      confirmsTitleIdentity(requested, conflicts, {
        year: '2020',
        country: 'CN',
      }),
      false
    );
  });
});

describe('StreamFilterer ambiguity settings', () => {
  it('retains Avatar releases identified by year or episode title but rejects untagged and shared-country names', async (t) => {
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    const metadata: Metadata = {
      title: 'Avatar: The Last Airbender',
      titles: [{ title: 'Avatar: The Last Airbender' }],
      year: 2005,
      releaseYears: [2005],
      country: 'US',
      episodeTitles: [{ title: 'The Boy in the Iceberg', language: 'en' }],
      titleConflicts: [
        { title: 'Avatar: The Last Airbender', year: 2024, country: 'US' },
      ],
    };
    const context = {
      type: 'series',
      id: 'tt0417299:1:1',
      isAnime: true,
      parsedId: { season: '1', episode: '1' },
      getMetadata: async () => metadata,
      getReleaseDates: async () => undefined,
      getEpisodeAirDate: async () => undefined,
      getEpisodeRuntime: async () => undefined,
      toExpressionContext: () => ({}),
    } as unknown as StreamContext;
    const names = [
      // Both yearless releases survived in the live test log.
      'Avatar.The.Last.Airbender.S01E01.The.Boy.in.the.Iceberg.1080p.SKST.WEB-DL.DD+2.0.H.264-playWEB.mkv',
      'Avatar.The.Last.Airbender.S01E01.The.Boy.in.the.Iceberg.1080p.FLAC.2.0.AVC.REMUX-FraMeSToR.mkv',
      'Avatar.The.Last.Airbender.2005.S01E01.1080p.WEB-DL.mkv',
      'Avatar.The.Last.Airbender.S01E01.1080p.WEB-DL.mkv',
      'Avatar.The.Last.Airbender.US.S01E01.1080p.WEB-DL.mkv',
      'Avatar.The.Last.Airbender.2024.S01E01.1080p.WEB-DL.mkv',
      'Avatar.The.Last.Airbender.S01E01.Chapter.One.The.Boy.in.the.Iceberg.1080p.BluRay.DDP.2.0.H.265.-EDGE2020.mkv',
      'Avatar.The.Last.Airbender.2005-2008.S01E01.1080p.BluRay.mkv',
      'Avatar.The.Last.Airbender.2005-2024.S01E01.1080p.WEB-DL.mkv',
      'Avatar.The.Last.Airbender.S01E01.Aang.1080p.WEB-DL.mkv',
      'Avatar.The.Last.Airbender.S01E01.Chapter.One.Aang.1080p.WEB-DL.mkv',
      'Avatar.The.Last.Airbender.S01E01.Chapter.IV.The.Boy.in.the.Iceberg.1080p.WEB-DL.mkv',
      'Avatar.The.Last.Airbender.S01E01.Part.Vic.The.Boy.in.the.Iceberg.1080p.WEB-DL.mkv',
      'Avatar.The.Last.Airbender.S01E01.Episode.Did.The.Boy.in.the.Iceberg.1080p.WEB-DL.mkv',
    ];
    for (const mode of ['exact', 'contains'] as const) {
      const filter = new StreamFilterer({
        titleMatching: {
          enabled: true,
          mode,
          similarityThreshold: 1,
          ambiguousResults: 'discard',
        },
        episodeTitleMatching: { enabled: true, similarityThreshold: 1 },
      } as UserData);
      const streams = names.map((filename, i) => ({
        id: String(i),
        type: 'usenet',
        filename,
        parsedFile: FileParser.parse(filename),
        addon: { preset: { id: 'newznab' } },
      })) as ParsedStream[];
      assert.equal(streams[4].parsedFile?.country, 'US');
      assert.deepEqual(
        (await filter.filter(streams, context)).map((stream) => stream.id),
        ['0', '1', '2', '6', '7', '11']
      );
    }
  });

  it('rejects same-year Reborn collisions while retaining the distinctive Carpinti alias in exact and contains modes', async (t) => {
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    // The requested show itself is the only result for its distinctive alias.
    t.mock.method(SkyhookMetadata.prototype, 'search', async () => [
      { title: 'Carpinti', tvdbId: 466372, year: 2025, country: 'TR' },
    ]);
    t.mock.method(TMDBMetadata.prototype, 'searchSeries', async () => []);
    t.mock.method(TVDBMetadata.prototype, 'searchSeries', async () => [
      { name: 'Carpinti', tvdbId: 466372, year: 2025, country: 'TR' },
    ]);
    const metadata: Metadata = {
      title: 'Reborn (2025)',
      year: 2025,
      releaseYears: [2025],
      country: 'TR',
      tvdbId: 466372,
      titles: [
        { title: 'Reborn (2025)' },
        { title: 'Reborn' },
        { title: 'Çarpıntı' },
        { title: 'Carpinti' },
      ],
      titleConflicts: [{ title: 'Reborn', year: 2025, country: 'CN' }],
    };
    const names = [
      'Reborn.2025.S01E05.2160p.IQIYI.WEB-DL.DDP2.0.H.265-ANDY.mkv',
      'Reborn.S01E05.2025.2160p.V2.WEB-DL.H265.HDR.60fps.AAC-HHWEB.mp4',
      'Reborn.2025.S01E05.1080p.IQIYI.WEB-DL.AAC.H.264-ANDY',
      'Reborn.2025.S01E05.1080p.VIKI.WEB-DL.AAC2.0.H.264-DUSKLiGHT',
      'Carpinti.s01.e05.WEB-DLRip1080p.mkv',
    ];
    const context = {
      type: 'series',
      id: 'tt37793706:1:5',
      isAnime: false,
      parsedId: { season: '1', episode: '5' },
      getMetadata: async () => metadata,
      getReleaseDates: async () => undefined,
      getEpisodeAirDate: async () => undefined,
      getEpisodeRuntime: async () => undefined,
      toExpressionContext: () => ({}),
    } as unknown as StreamContext;
    for (const mode of ['exact', 'contains'] as const) {
      const filter = new StreamFilterer({
        titleMatching: {
          enabled: true,
          mode,
          similarityThreshold: 1,
          ambiguousResults: 'discard',
        },
      } as UserData);
      const streams = names.map((filename, i) => ({
        id: String(i),
        type: 'usenet',
        filename,
        parsedFile: FileParser.parse(filename),
        addon: { preset: { id: 'newznab' } },
      })) as ParsedStream[];
      assert.deepEqual(
        (await filter.filter(streams, context)).map((s) => s.id),
        ['4']
      );
    }
  });

  it('does not run series conflict lookups for an anime movie', async (t) => {
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    const unexpectedLookup = async () => {
      assert.fail('movie filtering must not search for series conflicts');
    };
    const lookups = [
      t.mock.method(SkyhookMetadata.prototype, 'search', unexpectedLookup),
      t.mock.method(TMDBMetadata.prototype, 'searchSeries', unexpectedLookup),
      t.mock.method(TVDBMetadata.prototype, 'searchSeries', unexpectedLookup),
    ];
    const filename =
      'Unanswered.butterfly.Sword.Art.Online.2026.1080p.YT.WEB-DL.JPN.AAC2.0.H.264-ToonsHub.mkv';
    const stream = {
      id: 'movie',
      type: 'usenet',
      filename,
      parsedFile: FileParser.parse(filename),
      addon: { preset: { id: 'easynews' } },
    } as ParsedStream;
    const context = {
      type: 'movie',
      id: 'tt43625959',
      isAnime: true,
      getMetadata: async () => ({
        title: 'Unanswered//butterfly',
        year: 2026,
        titles: [
          { title: 'Unanswered//butterfly' },
          { title: 'Unanswered butterfly Sword Art Online' },
        ],
      }),
      getReleaseDates: async () => undefined,
      getEpisodeAirDate: async () => undefined,
      getEpisodeRuntime: async () => undefined,
      toExpressionContext: () => ({}),
    } as unknown as StreamContext;
    const filter = new StreamFilterer({
      titleMatching: {
        enabled: true,
        mode: 'exact',
        similarityThreshold: 1,
        ambiguousResults: 'discard',
      },
    } as UserData);
    assert.deepEqual(
      (await filter.filter([stream], context)).map((s) => s.id),
      ['movie']
    );
    assert.deepEqual(
      lookups.map((lookup) => lookup.mock.callCount()),
      [0, 0, 0]
    );
  });

  it('applies discard to the colliding alias while respecting keep, disabled matching and request/addon scopes', async (t) => {
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
    const lookup = t.mock.method(
      SkyhookMetadata.prototype,
      'search',
      async () => [
        { title: 'Reborn!', year: 2006, country: 'JP', tvdbId: 80975 },
        { title: 'Reborn (2025)', year: 2025, country: 'CN', tvdbId: 999999 },
      ]
    );
    t.mock.method(TMDBMetadata.prototype, 'searchSeries', async () => []);
    t.mock.method(TVDBMetadata.prototype, 'searchSeries', async () => [
      { name: 'Reborn!', year: 2006, country: 'JP', tvdbId: 80975 },
      { name: 'Reborn (2025)', year: 2025, country: 'CN', tvdbId: 999999 },
    ]);
    const names = [
      'Reborn.S01E01.Episode.1.1080p.NF.WEB-DL.AAC2.0.H.264-RUDR.mkv',
      'Reborn.S01E01.Episode.1.1080p.NF.WEB-DL.AAC.2.0.H.264-CHDWEB.mkv',
      'Katekyo.Hitman.Reborn.S01E01.1080p.AO.WEB-DL.AAC2.0.H.264.DUAL-OLYMPUS.mkv',
      // Correct anime release from the custom log, but the filename alone
      // does not distinguish it from the other shows using this alias.
      'Reborn!.-.E01.mkv',
    ];
    const context = {
      type: 'series',
      id: 'tt1224144:1:1',
      isAnime: true,
      parsedId: { season: '1', episode: '1' },
      getMetadata: async () => anime,
      getReleaseDates: async () => undefined,
      getEpisodeAirDate: async () => undefined,
      getEpisodeRuntime: async () => undefined,
      toExpressionContext: () => ({}),
    } as unknown as StreamContext;
    const run = async (
      options: UserData['titleMatching'],
      animeRequest = true,
      addon: ParsedStream['addon'] = {
        preset: { id: 'easynews' },
      } as ParsedStream['addon']
    ) => {
      const filter = new StreamFilterer({ titleMatching: options } as UserData);
      const streams = names.map((filename, i) => ({
        id: String(i),
        type: 'usenet',
        filename,
        parsedFile: FileParser.parse(filename),
        addon,
      })) as ParsedStream[];
      return (
        await filter.filter(streams, {
          ...context,
          isAnime: animeRequest,
        } as StreamContext)
      ).map((stream) => stream.id);
    };
    const discard = {
      enabled: true,
      mode: 'exact' as const,
      similarityThreshold: 1,
      ambiguousResults: 'discard' as const,
    };
    assert.deepEqual(await run(discard), ['2']);
    assert.deepEqual(await run({ ...discard, requestTypes: ['anime'] }), ['2']);
    assert.deepEqual(
      await run({ ...discard, requestTypes: ['series', 'anime'] }),
      ['2']
    );
    assert.deepEqual(
      await run({ ...discard, requestTypes: ['series'] }, false),
      ['2']
    );
    assert.deepEqual(
      await run({ ...discard, requestTypes: ['anime'] }, false),
      ['0', '1', '2', '3']
    );
    assert.deepEqual(
      await run(
        { ...discard, addons: ['easynews'] },
        true,
        {} as ParsedStream['addon']
      ),
      ['0', '1', '2', '3']
    );
    const lookupsAfterDiscard = lookup.mock.callCount();
    for (const options of [
      { ...discard, ambiguousResults: 'keep' as const },
      { ...discard, enabled: false },
      { ...discard, requestTypes: ['movie'] },
      { ...discard, requestTypes: ['series'] },
      { ...discard, addons: ['other-addon'] },
    ]) {
      assert.deepEqual(await run(options), ['0', '1', '2', '3']);
    }
    assert.equal(
      lookup.mock.callCount(),
      lookupsAfterDiscard,
      'no additional lookups outside discard scope'
    );
  });
});
