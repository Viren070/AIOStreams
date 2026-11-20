import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';
// Use the normal core entry point to initialise the builtins' dependency graph.
import '../../index.js';
import { BaseDebridAddon } from './debrid.js';
import { calculateAbsoluteEpisode } from '../utils/general.js';
import { MetadataService } from '../../metadata/service.js';
import { AnimeDatabase } from '../../anime-database/index.js';
import { StreamContext } from '../../streams/context.js';
import { settingsStore } from '../../config/index.js';
import { SettingsRepository } from '../../db/repositories/settings.js';
import StreamParser from '../../parser/streams.js';
import type { Stream, ParsedStream } from '../../db/schemas.js';
import type {
  TorrentWithSelectedFile,
  NZBWithSelectedFile,
} from '../../debrid/utils.js';

type SelectedFile = TorrentWithSelectedFile | NZBWithSelectedFile;

// Exercise stream creation and parsing without starting addon searches.
const addon = Object.assign(Object.create(BaseDebridAddon.prototype), {
  name: 'Test',
  userData: {},
}) as {
  _createStream: (
    result: SelectedFile,
    metadataId: string,
    encryptedStoreAuths: {}
  ) => Stream;
};
const parser = Object.create(StreamParser.prototype) as {
  getSeeders: (stream: Stream, parsed: ParsedStream) => number | undefined;
};

function makeTorrent(): TorrentWithSelectedFile {
  return {
    type: 'torrent',
    title: 'Test.1080p.WEB-DL',
    hash: '0'.repeat(40),
    sources: [],
    size: 1024,
    file: { index: 0, name: 'Test.1080p.WEB-DL.mkv', size: 1024 },
  };
}

function assertSeeders(result: SelectedFile, expected: number | undefined) {
  const stream = addon._createStream(result, 'tt0000001', {});
  assert.equal(parser.getSeeders(stream, {} as ParsedStream), expected);
  if (expected === undefined) {
    assert.doesNotMatch(stream.description ?? '', /👤/u);
  } else {
    assert.ok(stream.description?.includes(`👤 ${expected}`));
  }
}

describe('BaseDebridAddon seeder metadata', () => {
  it('preserves an explicitly reported zero through stream parsing', () => {
    assertSeeders({ ...makeTorrent(), seeders: 0 }, 0);
  });

  it('preserves a positive seeder count through stream parsing', () => {
    assertSeeders({ ...makeTorrent(), seeders: 42 }, 42);
  });

  it('does not invent a zero when the seeder property is absent', () => {
    assertSeeders(makeTorrent(), undefined);
  });

  it('omits an explicitly undefined seeder count', () => {
    assertSeeders({ ...makeTorrent(), seeders: undefined }, undefined);
  });

  it('does not add seeder metadata to a Usenet result without it', () => {
    assertSeeders(
      {
        type: 'usenet',
        title: 'Test.1080p.WEB-DL',
        hash: '0'.repeat(40),
        nzb: 'https://example.com/test.nzb',
        size: 1024,
        file: { index: 0, name: 'Test.1080p.WEB-DL.mkv', size: 1024 },
      },
      undefined
    );
  });
});

describe('Issue #1685: calculateAbsoluteEpisode with split-cour and missing seasons', () => {
  before(async () => {
    mock.method(SettingsRepository, 'getAll', async () => []);
    mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
  });

  it('calculates absolute episode normally when the requested season exists in seasons', () => {
    const seasons = [
      { number: '0', episodes: 8 },
      { number: '1', episodes: 13 },
      { number: '2', episodes: 12 },
    ];
    assert.equal(calculateAbsoluteEpisode('2', '1', seasons), '14');
    assert.equal(calculateAbsoluteEpisode('1', '5', seasons), '5');
  });

  it('uses animeEntry fromEpisode offset when the requested season is missing from Cinemeta seasons (Fate/Zero S2E1)', () => {
    const cinemetaSeasons = [
      { number: '0', episodes: 8 },
      { number: '1', episodes: 25 },
    ];
    const fateZeroS2Entry = {
      imdb: { seasonNumber: 1, fromEpisode: 14 },
      tmdb: { seasonNumber: 1, fromEpisode: 14 },
      tvdb: { seasonNumber: 2, fromEpisode: 1 },
    };

    assert.equal(
      calculateAbsoluteEpisode('2', '1', cinemetaSeasons, fateZeroS2Entry),
      '14'
    );
    assert.equal(
      calculateAbsoluteEpisode('2', '5', cinemetaSeasons, fateZeroS2Entry),
      '18'
    );
  });

  it('adds episodes before the mapped season when fromEpisode maps into a later season', () => {
    const seasons = [
      { number: '1', episodes: 24 },
      { number: '2', episodes: 25 },
    ];
    const entry = {
      imdb: { seasonNumber: 2, fromEpisode: 14 },
    };

    assert.equal(calculateAbsoluteEpisode('3', '2', seasons, entry), '39');
  });

  it('returns undefined instead of summing all seasons when season is absent and no mapping applies', () => {
    const cinemetaSeasons = [{ number: '1', episodes: 25 }];
    assert.equal(calculateAbsoluteEpisode('2', '1', cinemetaSeasons), undefined);
    assert.equal(
      calculateAbsoluteEpisode('2', '1', cinemetaSeasons, {
        tvdb: { seasonNumber: 2, fromEpisode: 1 },
      }),
      undefined
    );
  });

  it('resolves absoluteEpisode = 14 (not 26) in BaseDebridAddon._getSearchMetadata and StreamContext for Fate/Zero S2E1', async () => {
    const fateZeroEntry: any = {
      animeSeason: { year: 2012 },
      imdb: { seasonNumber: 1, fromEpisode: 14 },
      tmdb: { seasonNumber: 1, fromEpisode: 14 },
      tvdb: { seasonNumber: 2, fromEpisode: 1 },
      trakt: { seasonNumber: 2 },
    };

    mock.method(MetadataService.prototype, 'getMetadata', async () => ({
      title: 'Fate/Zero',
      titles: ['Fate/Zero'],
      year: 2011,
      originalLanguage: 'ja',
      seasons: [
        { season_number: 0, episode_count: 8 },
        { season_number: 1, episode_count: 25 },
      ],
    }));
    mock.method(AnimeDatabase, 'getInstance', () => ({
      getEntryById: async () => fateZeroEntry,
    }));

    const searchAddon = Object.create(BaseDebridAddon.prototype);
    searchAddon.userData = {};
    searchAddon.logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    const searchMeta = await searchAddon._getSearchMetadata(
      {
        type: 'imdbId',
        value: 'tt2051178',
        season: '2',
        episode: '1',
      },
      'series'
    );

    assert.equal(searchMeta.absoluteEpisode, 14);
    assert.equal(searchMeta.relativeAbsoluteEpisode, undefined);

    const ctx = await StreamContext.create(
      'series',
      'tt2051178:2:1',
      {} as any
    );
    ctx.startMetadataFetch();
    const ctxMeta = await ctx.getMetadata();
    assert.equal(ctxMeta?.absoluteEpisode, 14);
    assert.equal(ctxMeta?.relativeAbsoluteEpisode, undefined);

    mock.restoreAll();
  });
});
