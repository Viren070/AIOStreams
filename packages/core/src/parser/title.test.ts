import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import '../index.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import FileParser from './file.js';
import { parseTorrentTitleCached } from './title.js';
import { isEpisodeWrong, isTitleWrong } from '../debrid/utils.js';
import { isNonAnimeAbsoluteEligible } from '../builtins/utils/general.js';
import { BaseDebridAddon } from '../builtins/base/debrid.js';
import { MetadataService } from '../metadata/service.js';
import { AnimeDatabase } from '../utils/index.js';

before(async () => {
  mock.method(SettingsRepository, 'getAll', async () => []);
  mock.method(SettingsRepository, 'getVersion', async () => 0);
  await settingsStore.initialise();
});

describe('Turkish episode format (Blm / Bölüm / Bolum) & series search', () => {
  it('parses "Tuzlu Kahve 07 Blm (13 10 2026)" with clean title, episode 7, and date', () => {
    const parsed = parseTorrentTitleCached('Tuzlu Kahve 07 Blm (13 10 2026)');
    assert.equal(parsed.title, 'Tuzlu Kahve');
    assert.deepEqual(parsed.episodes, [7]);
    assert.equal(parsed.date, '2026-10-13');

    const fileParsed = FileParser.parse('Tuzlu Kahve 07 Blm (13 10 2026)');
    assert.equal(fileParsed.title, 'Tuzlu Kahve');
    assert.deepEqual(fileParsed.episodes, [7]);
    assert.equal(fileParsed.date, '2026-10-13');
  });

  it('parses Turkish Bölüm / Bolum / Blm single, range, and season variants', () => {
    const p1 = parseTorrentTitleCached(
      'Kızılcık Şerbeti 70. Bölüm 1080p WEB-DL'
    );
    assert.equal(p1.title, 'Kızılcık Şerbeti');
    assert.deepEqual(p1.episodes, [70]);
    assert.equal(p1.resolution, '1080p');
    assert.equal(p1.quality, 'WEB-DL');

    const p2 = parseTorrentTitleCached('Eşref Rüya 07 Bolum 1080p');
    assert.equal(p2.title, 'Eşref Rüya');
    assert.deepEqual(p2.episodes, [7]);

    const p3 = parseTorrentTitleCached('Tuzlu Kahve Bölüm 7 720p');
    assert.equal(p3.title, 'Tuzlu Kahve');
    assert.deepEqual(p3.episodes, [7]);

    const p4 = parseTorrentTitleCached('Tuzlu Kahve 01-07 Blm 1080p');
    assert.equal(p4.title, 'Tuzlu Kahve');
    assert.deepEqual(p4.episodes, [1, 2, 3, 4, 5, 6, 7]);

    const p5 = parseTorrentTitleCached(
      'Kızılcık Şerbeti 2. Sezon 70. Bölüm 1080p'
    );
    assert.equal(p5.title, 'Kızılcık Şerbeti');
    assert.deepEqual(p5.seasons, [2]);
    assert.deepEqual(p5.episodes, [70]);
  });

  it('passes debrid title and episode validation for Turkish episode releases', () => {
    const parsed = parseTorrentTitleCached('Eşref Rüya 07 Blm 1080p');
    const metadata = {
      titles: ['Eşref Rüya'],
      season: 1,
      episode: 7,
      absoluteEpisode: 7,
    };
    assert.equal(isTitleWrong(parsed, metadata), false);
    assert.equal(isEpisodeWrong(parsed, metadata), false);
    assert.equal(
      isEpisodeWrong(parsed, { ...metadata, episode: 8, absoluteEpisode: 8 }),
      true
    );
  });

  it('enables absolute episode search and bare padded episode query for Turkish series', async () => {
    assert.equal(isNonAnimeAbsoluteEligible({ originalLanguage: 'tr' }), true);

    mock.method(AnimeDatabase, 'getInstance', () => ({
      getEntryById: async () => null,
    }));
    mock.method(MetadataService.prototype, 'getMetadata', async () => ({
      title: 'Tuzlu Kahve',
      titles: [{ title: 'Tuzlu Kahve', language: 'tr' }],
      originalLanguage: 'tr',
      seasons: [
        { season_number: 1, episode_count: 10 },
        { season_number: 2, episode_count: 10 },
      ],
    }));

    const addon = Object.assign(Object.create(BaseDebridAddon.prototype), {
      name: 'Test',
      userData: {},
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    }) as any;

    const parsedId = {
      type: 'imdbId' as const,
      value: 'tt1234567',
      fullId: 'tt1234567:2:7',
      mediaType: 'series' as const,
      season: '2',
      episode: '7',
    };

    const searchMetadata = await addon._getSearchMetadata(parsedId, 'series');
    assert.equal(searchMetadata.absoluteEpisode, 17);

    const queries: string[] = addon.buildQueries(parsedId, searchMetadata);

    assert.ok(queries.includes('Tuzlu Kahve 17'));
    assert.ok(queries.includes('Tuzlu Kahve E17'));
    assert.ok(queries.includes('Tuzlu Kahve S02E07'));
  });
});
