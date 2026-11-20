import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import '../../../index.js';
import { settingsStore } from '../../../config/index.js';
import { SettingsRepository } from '../../../db/repositories/settings.js';
import { IdParser } from '../../../utils/id-parser.js';
import { NewznabAddon, NewznabAddonConfigSchema } from '../../newznab/addon.js';
import type { SearchMetadata } from '../debrid.js';
import { NabApiError } from './api.js';
import type { NewznabSearchResultItem, SearchResponse } from './api.js';
import type { NabAddonConfig } from './addon.js';
import { parseNabParsedFileInfo } from './addon.js';

const episode = IdParser.parse('tt1234567:1:1', 'series')!;
const metadata: SearchMetadata = {
  titles: ['Daily Show'],
  tvdbId: 42,
  tvdbSeason: 2,
  tvdbEpisode: 3,
  isDateBased: true,
  episodeAirDate: '2024-10-25',
  airDates: ['2024-10-25'],
};

function release(title: string): NewznabSearchResultItem {
  return {
    title,
    enclosure: [
      {
        type: 'application/x-nzb',
        url: 'https://example.org/a.nzb',
        length: 100,
      },
    ],
    newznab: {},
  };
}

class TestAddon extends NewznabAddon {
  searchEpisode(meta: SearchMetadata) {
    return this.performSearch(episode, meta);
  }
}

function fixture(
  replies: (NewznabSearchResultItem[] | SearchResponse<'newznab'> | Error)[],
  strategy: NabAddonConfig['seasonEpisodeStrategy'] = 'episodeFirst',
  paginate = false
) {
  const addon = new TestAddon(
    NewznabAddonConfigSchema.parse({
      url: 'https://example.org',
      services: [],
      seasonEpisodeStrategy: strategy,
      paginate,
    })
  );
  addon.api.getCapabilities = async () => ({
    server: {},
    searching: {
      'tv-search': {
        available: true,
        supportedParams: ['tvdbid', 'season', 'ep'],
      },
    },
  });
  const calls: string[][] = [];
  addon.api.search = async (fn, params = {}) => {
    assert.equal(fn, 'tvsearch');
    assert.equal(params.tvdbid, '42');
    assert.equal(params.extended, '1');
    calls.push([
      String(params.season),
      ...(params.ep === undefined ? [] : [String(params.ep)]),
      ...(params.offset === undefined ? [] : [`offset=${params.offset}`]),
    ]);
    const reply = replies.shift();
    assert.ok(reply, 'unexpected indexer request');
    if (reply instanceof Error) throw reply;
    return Array.isArray(reply) ? { results: reply } : reply;
  };
  return { run: (meta = metadata) => addon.searchEpisode(meta), calls };
}

describe('daily Newznab searches', () => {
  before(async () => {
    mock.method(SettingsRepository, 'getAll', async () => []);
    mock.method(SettingsRepository, 'getVersion', async () => 0);
    try {
      await settingsStore.initialise();
    } finally {
      mock.restoreAll();
    }
  });
  const daily = ['2024', '10/25'];
  const numeric = ['2', '3'];
  const season = ['2'];
  const pack = release('Daily.Show.S02.1080p');
  const invalid = new NabApiError(200, 'Incorrect parameter');

  it('keeps a matching daily release without another request', async () => {
    const item = release('Daily.Show.2024.10.25');
    const { run, calls } = fixture([[item]]);
    assert.deepEqual((await run()).results, [item]);
    assert.deepEqual(calls, [daily]);
  });

  it('retains a daily hit if a later page is rejected, with and without a total', async () => {
    const item = release('Daily.Show.2024.10.25');
    for (const total of [2, undefined]) {
      const { run, calls } = fixture(
        [{ results: [item], total }, invalid],
        'episode',
        true
      );
      assert.deepEqual((await run()).results, [item]);
      assert.deepEqual(calls, [daily, [...daily, 'offset=1']]);
    }
  });

  it('retries numerically after a partial daily result has no matching air date', async () => {
    const { run, calls } = fixture(
      [
        { results: [release('Daily.Show.2024.10.24')], total: 2 },
        invalid,
        { results: [pack], total: 1 },
      ],
      'season',
      true
    );
    assert.deepEqual((await run()).results, [pack]);
    assert.deepEqual(calls, [daily, [...daily, 'offset=1'], season]);
  });

  it('retries with mapped TVDB numbering and then the season for episodeFirst', async () => {
    const { run, calls } = fixture([invalid, [], [pack]]);
    assert.deepEqual((await run()).results, [pack]);
    assert.deepEqual(calls, [daily, numeric, season]);
  });

  it('uses a season request for a finished season in dynamic mode', async () => {
    const { run, calls } = fixture(
      [[release('Daily.Show.2024.10.24')], [pack]],
      'dynamic'
    );
    assert.deepEqual(
      (await run({ ...metadata, ongoingSeason: false })).results,
      [pack]
    );
    assert.deepEqual(calls, [daily, season]);
  });

  it('retries a standard incorrect-parameter response with a numeric episode', async () => {
    const item = release('Daily.Show.S02E03');
    const { run, calls } = fixture(
      [new NabApiError(201, 'Invalid ep'), [item]],
      'episode'
    );
    assert.deepEqual((await run()).results, [item]);
    assert.deepEqual(calls, [daily, numeric]);
  });

  it('uses an episode request for an ongoing season in dynamic mode', async () => {
    const { run, calls } = fixture([[], []], 'dynamic');
    assert.deepEqual(
      (await run({ ...metadata, ongoingSeason: true })).results,
      []
    );
    assert.deepEqual(calls, [daily, numeric]);
  });

  it('keeps an ordinary episode hit and skips the season request', async () => {
    const item = release('Daily.Show.S02E03');
    const { run, calls } = fixture([[item]]);
    assert.deepEqual((await run({ ...metadata, isDateBased: false })).results, [
      item,
    ]);
    assert.deepEqual(calls, [numeric]);
  });

  it('propagates auth, transport and numeric parameter errors', async () => {
    for (const error of [
      new NabApiError(100, 'Incorrect credentials'),
      new NabApiError(200, 'Missing parameter: key'),
      new Error('HTTP 429'),
    ]) {
      const { run, calls } = fixture([error]);
      await assert.rejects(run(), (e) => e === error);
      assert.deepEqual(calls, [daily]);
    }
    const { run, calls } = fixture([invalid, invalid]);
    await assert.rejects(run(), (e) => e === invalid);
    assert.deepEqual(calls, [daily, numeric]);
  });
});

describe('Newznab language attributes', () => {
  it('prefers explicit audio and subtitle values independently', () => {
    const info = parseNabParsedFileInfo({
      explicitAudioLanguages: 'es, es',
      explicitSubtitleLanguages: 'en',
      audioLanguages: 'en',
      subtitleLanguages: 'es',
    });
    assert.deepEqual(info?.languages, ['Spanish']);
    assert.deepEqual(info?.subtitles, ['English']);
    assert.equal(info?.mediaInfoQuality, 'indexer');
  });

  it('falls back for unrecognised or missing explicit values', () => {
    const info = parseNabParsedFileInfo({
      explicitAudioLanguages: 'und',
      audioLanguages: 'en',
      subtitleLanguages: 'es',
    });
    assert.deepEqual(info?.languages, ['English']);
    assert.deepEqual(info?.subtitles, ['Spanish']);
  });
});
