import '../streams/filterer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TVDBMetadata } from './tvdb.js';
import { conflictEpisodeBound } from '../streams/title-conflict-episodes.js';
import StreamFilterer from '../streams/filterer.js';
import FileParser from '../parser/file.js';
import { SkyhookMetadata } from './skyhook.js';
import { RegexAccess } from '../utils/regex-access.js';
import { resolveConflictEvidence } from '../streams/title-conflict-evidence.js';
import { Cache } from '../utils/cache.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import {
  createTestStreamContext,
  initialiseTestSettings,
} from '../../test/helpers.js';

const page = (
  id: number,
  episodes: unknown[],
  next: string | null,
  total: number
) => ({
  status: 'success',
  data: {
    series: { id, name: 'Example', status: { name: 'Ended' } },
    episodes,
  },
  links: { next, total_items: total },
});

describe('authenticated competitor episode catalogs', () => {
  it('stops pagination when the shared budget aborts and does not cache partial results', async (t) => {
    await initialiseTestSettings(t);
    const client = new TVDBMetadata({ apiKey: 'test' });
    t.mock.method(client as any, 'ensureToken', async () => {});
    const controller = new AbortController();
    let calls = 0;
    let complete = false;
    t.mock.method(
      (client as any).api,
      'request',
      async (_endpoint: string, options: any) => {
        calls++;
        if (!complete) controller.abort();
        return options.schema.parse(
          page(
            98765999,
            [{ seasonNumber: 1, number: 1 }],
            complete ? null : '?page=1',
            complete ? 1 : 2
          )
        );
      }
    );
    assert.equal(
      await client.getEpisodeCatalog(98765999, controller.signal),
      undefined
    );
    assert.equal(calls, 1);
    complete = true;
    assert.equal(
      conflictEpisodeBound((await client.getEpisodeCatalog(98765999))!),
      1
    );
    assert.equal(calls, 2, 'a cancelled partial catalog must not be cached');
  });

  it('retains a known ongoing status without fetching another page', async (t) => {
    await initialiseTestSettings(t);
    const client = new TVDBMetadata({ apiKey: 'test' });
    t.mock.method(client as any, 'ensureToken', async () => {});
    const request = t.mock.method(
      (client as any).api,
      'request',
      async (_endpoint: string, options: any) => {
        const data = page(
          98765998,
          [{ seasonNumber: 1, number: 1 }],
          '?page=1',
          2
        );
        data.data.series.status.name = 'Continuing';
        return options.schema.parse(data);
      }
    );
    const catalog = await client.getEpisodeCatalog(98765998);
    assert.equal(catalog?.status, 'Continuing');
    assert.deepEqual(catalog?.episodes, []);
    assert.equal(conflictEpisodeBound(catalog!), undefined);
    assert.equal(request.mock.callCount(), 1);
  });
  it('fetches every page, validates the response and caches the complete catalog', async (t) => {
    await initialiseTestSettings(t);
    const client = new TVDBMetadata({ apiKey: 'test' });
    t.mock.method(client as any, 'ensureToken', async () => {});
    const calls: string[] = [];
    t.mock.method(
      (client as any).api,
      'request',
      async (endpoint: string, options: any) => {
        calls.push(endpoint);
        return options.schema.parse(
          page(
            98765001,
            [{ seasonNumber: 1, number: calls.length, absoluteNumber: 0 }],
            calls.length === 1 ? '?page=1' : null,
            2
          )
        );
      }
    );
    const catalog = await client.getEpisodeCatalog(98765001);
    assert.equal(conflictEpisodeBound(catalog!), 2);
    assert.equal(catalog?.episodes[0].absoluteEpisodeNumber, undefined);
    assert.deepEqual(calls, [
      '/series/98765001/episodes/default?page=0',
      '/series/98765001/episodes/default?page=1',
    ]);
    assert.deepEqual(await client.getEpisodeCatalog(98765001), catalog);
    assert.equal(calls.length, 2);
  });

  for (const failure of [
    'network',
    'wrong-id',
    'malformed',
    'empty-page',
    'page-limit',
    'count-mismatch',
  ]) {
    it(`does not return or cache a partial catalog after ${failure}`, async (t) => {
      await initialiseTestSettings(t);
      const client = new TVDBMetadata({ apiKey: 'test' });
      t.mock.method(client as any, 'ensureToken', async () => {});
      const id =
        98765100 +
        [
          'network',
          'wrong-id',
          'malformed',
          'empty-page',
          'page-limit',
          'count-mismatch',
        ].indexOf(failure);
      let calls = 0;
      let recovered = false;
      t.mock.method(
        (client as any).api,
        'request',
        async (_endpoint: string, options: any) => {
          calls++;
          if (recovered)
            return options.schema.parse(
              page(id, [{ seasonNumber: 1, number: 1 }], null, 1)
            );
          if (calls === 1)
            return options.schema.parse(
              page(id, [{ seasonNumber: 1, number: 1 }], '?page=1', 2)
            );
          if (failure === 'network') throw new Error('offline');
          return options.schema.parse(
            page(
              failure === 'wrong-id' ? id + 1 : id,
              failure === 'empty-page'
                ? []
                : [
                    {
                      seasonNumber: 1,
                      number: failure === 'malformed' ? undefined : calls,
                    },
                  ],
              failure === 'page-limit' || failure === 'empty-page'
                ? '?page=2'
                : null,
              failure === 'count-mismatch' ? 99 : 2
            )
          );
        }
      );
      assert.equal(await client.getEpisodeCatalog(id), undefined);
      assert.ok(calls <= 10);
      recovered = true;
      assert.equal(
        conflictEpisodeBound((await client.getEpisodeCatalog(id))!),
        1,
        'failed lookups do not poison the cache'
      );
    });
  }
});

it('reconciles a newer validated TVDB ongoing status with cached bounds across clients and the full filter', async (t) => {
  await initialiseTestSettings(t);
  t.mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  t.mock.method(SkyhookMetadata.prototype, 'getShow', async () => null);
  t.mock.method(TVDBMetadata.prototype as any, 'ensureToken', async () => {});
  const id = 98766550;
  const catalog = {
    tvdbId: id,
    title: 'Shared Show',
    status: 'Ended',
    episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
  };
  await Cache.getInstance('tvdb:episodeCatalog:v2').set(id, catalog, 60);
  const sample = new TVDBMetadata({ apiKey: 'test' });
  let releaseStatus!: () => void;
  const statusReady = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  const getCatalog = TVDBMetadata.prototype.getEpisodeCatalog;
  t.mock.method(
    TVDBMetadata.prototype,
    'getEpisodeCatalog',
    async function (tvdbId, signal) {
      const result = await getCatalog.call(this, tvdbId, signal);
      if (result?.status === 'Ended') setImmediate(releaseStatus);
      return result;
    }
  );
  t.mock.method(
    Object.getPrototypeOf((sample as any).api),
    'request',
    async (_endpoint: string, options: any) => {
      await statusReady;
      return options.schema.parse({
        status: 'success',
        data: {
          id,
          name: 'Shared Show',
          slug: 'shared-show',
          image: null,
          nameTranslations: [],
          overviewTranslations: [],
          aliases: [],
          score: 0,
          lastUpdated: '2026-01-01',
          year: '2021',
          status: {
            id: 1,
            name: 'Continuing',
            recordType: 'series',
            keepUpdated: true,
          },
          originalLanguage: 'eng',
        },
      });
    }
  );
  const filename = 'Shared.Show.S03E05.mkv';
  const release = {
    id: 'one',
    type: 'usenet',
    filename,
    parsedFile: {
      ...FileParser.parse(filename),
      mediaInfoQuality: 'indexer',
      audioTracks: [{ lang: 'eng', original: true }],
    },
    addon: { preset: { id: 'newznab' } },
  } as ParsedStream;
  const metadata = {
    title: 'Shared Show',
    titles: [{ title: 'Shared Show' }],
    tvdbId: 1,
    year: 1998,
    country: 'US',
    originalLanguage: 'en',
    seasons: [{ season_number: 3, episode_count: 10 }],
    titleConflicts: [
      { title: 'Shared Show', tvdbId: id, year: 2021, country: 'US' },
    ],
  };
  const resolved = await resolveConflictEvidence({
    metadata,
    streams: [release],
    titleConflicts: new Map([['sharedshow', metadata.titleConflicts]]),
    titleKey: () => 'sharedshow',
    releaseEpisode: () => 5,
    releaseSeason: () => 3,
    auth: { tvdbApiKey: 'test' },
  });
  assert.equal(
    resolved.originalLanguages.get(id),
    'en',
    'independently valid language remains usable'
  );
  assert.equal(
    resolved.numberingBounds.has(id),
    false,
    'ongoing status vetoes the older ended bound'
  );
  const later = new TVDBMetadata({ apiKey: 'test' });
  assert.equal(
    await later.getEpisodeCatalog(id),
    undefined,
    'the cached series observation also protects a later client'
  );
  const context = createTestStreamContext({
    type: 'series',
    id: 'tt0108850:3:5',
    isAnime: false,
    parsedId: { type: 'imdbId', value: 'tt0108850', season: '3', episode: '5' },
    getMetadata: async () => metadata,
  });
  assert.equal(
    (
      await new StreamFilterer({
        tvdbApiKey: 'test',
        titleMatching: { enabled: true, ambiguousResults: 'discard' },
      } as UserData).filter([release], context)
    ).length,
    0
  );
});
