import { before, after, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { RegexAccess } from '../utils/regex-access.js';
import { NativeUsenetService } from '../debrid/aiostreams.js';
import { TorboxDebridService } from '../debrid/torbox.js';
import {
  processNZBs,
  processTorrents,
  processTorrentsForP2P,
  filterUnprocessedTorrentsPreDownload,
} from '../builtins/utils/debrid.js';
import StreamFilterer from './filterer.js';
import FileParser from '../parser/file.js';
import { parseTorrentTitleCached } from '../parser/title.js';
import { selectFileInTorrentOrNZB } from '../debrid/utils.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import type { StreamContext } from './context.js';
import { PlaybackInfoSchema, type DebridDownload } from '../debrid/base.js';

const title = 'Harbour Mystery: The Case of Room 30';
const names = [
  '[Group] Harbour Mystery - The Case of Room 30 (1080p) [6BD3ED0A].mkv',
  '[Group] Harbour Mystery - The Case of Room 30 (720p) [3B6CFA75].mkv',
  '[Group] Harbour Mystery - The Case of Room 30 (480p) [4CAE7FA5].mkv',
  'SubsExample-Harbour Mystery-The Case of Room 30 (1080p) [6BD3ED0A].mkv',
];
const stream = (filename: string, overrides: Partial<ParsedStream> = {}) =>
  ({
    id: filename,
    type: 'usenet',
    filename,
    parsedFile: FileParser.parse(filename),
    addon: { name: 'Test', preset: { id: 'newznab' } },
    ...overrides,
  }) as ParsedStream;
const metadata = {
  title,
  titles: [{ title, language: 'en' }],
  year: 2026,
  country: 'JP',
};
const context = (overrides: Record<string, unknown> = {}) =>
  ({
    type: 'movie',
    id: 'tt1234567',
    isAnime: false,
    parsedId: { type: 'imdbId', value: 'tt1234567' },
    getMetadata: async () => metadata,
    getEpisodeRuntime: async () => undefined,
    getReleaseDates: async () => undefined,
    getEpisodeAirDate: async () => undefined,
    getPermittedPatterns: async () => ({ allowed: [], denied: [] }),
    toExpressionContext: () => ({}),
    ...overrides,
  }) as unknown as StreamContext;
const options = {
  titleMatching: {
    enabled: true,
    mode: 'exact',
    similarityThreshold: 1,
    ambiguousResults: 'discard',
  },
  seasonEpisodeMatching: { enabled: true, strict: true },
  yearMatching: { enabled: true, strict: false },
} as UserData;

const streamTypes = [
  'usenet',
  'stremio-usenet',
  'p2p',
  'debrid',
  'http',
] as const;

describe('movie release recovery through validation, filtering and playback', () => {
  before(async () => {
    mock.method(SettingsRepository, 'getAll', async () => []);
    mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    mock.method(RegexAccess, 'isRegexAllowed', async () => false);
  });
  after(() => mock.restoreAll());
  it('recovers the entire title with exact title matching and episode rejection enabled', async () => {
    for (const type of streamTypes) {
      const kept = await new StreamFilterer(options).filter(
        names.map((name) => stream(name, { type })),
        context()
      );
      assert.equal(kept.length, names.length, type);
      for (const release of kept) {
        assert.equal(release.parsedFile?.title, title);
        assert.deepEqual(release.parsedFile?.episodes, []);
      }
    }
  });
  it('uses the same recovery before NZB validation and inner-file selection', async (t) => {
    t.mock.method(NativeUsenetService.prototype, 'checkNzbs', async () => []);
    const result = await processNZBs(
      names.map((name, i) => ({
        type: 'usenet' as const,
        title: name,
        hash: String(i),
        nzb: `https://example.com/${i}.nzb`,
      })),
      [
        {
          id: 'aiostreams',
          credential: Buffer.from(
            JSON.stringify({ aiostreamsAuth: 'test-only' })
          ).toString('base64url'),
        },
      ],
      'tt1234567',
      { mediaType: 'movie', titles: [title], year: 2026 }
    );
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
      result.results.map((item) => item.title),
      names
    );
    const files = [
      {
        name: names[0].replace('Room 30', 'Room 31'),
        index: 0,
        size: 100000000,
      },
      { name: names[0], index: 1, size: 100000000 },
      {
        name: names[0].replace(' (1080p)', ' S00E01 (1080p)'),
        index: 2,
        size: 150000000,
      },
      {
        name: names[0].replace(' (1080p)', ' S01E01 (1080p)'),
        index: 3,
        size: 150000000,
      },
    ];
    const parsed = new Map(
      files.map((file) => [file.name, parseTorrentTitleCached(file.name)])
    );
    const before = structuredClone(parsed);
    const selected = await selectFileInTorrentOrNZB(
      {
        type: 'usenet',
        title: names[0],
        hash: 'test',
        nzb: 'https://example.com/test.nzb',
      },
      { files, status: 'cached' } as DebridDownload,
      parsed,
      { mediaType: 'movie', titles: [title], year: 2026 }
    );
    assert.equal(selected?.index, 1);
    assert.deepEqual(parsed, before);
  });
  it('recovers TorBox NZBs and torrents, including inner-file selection and P2P', async (t) => {
    const files = [
      {
        name: names[0].replace('Room 30', 'Room 31'),
        index: 0,
        size: 100000000,
      },
      { name: names[0], index: 1, size: 100000000 },
      {
        name: names[0].replace(' (1080p)', ' S00E01 (1080p)'),
        index: 2,
        size: 150000000,
      },
      {
        name: names[0].replace(' (1080p)', ' S01E01 (1080p)'),
        index: 3,
        size: 150000000,
      },
    ];
    t.mock.method(
      TorboxDebridService.prototype,
      'checkNzbs',
      async (nzbs: { hash: string }[]) =>
        nzbs.map(({ hash }) => ({
          hash,
          name: names[0],
          status: 'cached',
          files,
        }))
    );
    t.mock.method(
      TorboxDebridService.prototype,
      'checkMagnets',
      async (hashes: string[]) =>
        hashes.map((hash) => ({
          hash,
          name: names[0],
          status: 'cached',
          files,
        }))
    );
    const playbackMetadata = {
      mediaType: 'movie' as const,
      titles: [title],
      year: 2026,
    };
    const services = [{ id: 'torbox' as const, credential: 'test-only' }];
    const nzb = {
      type: 'usenet' as const,
      title: names[0],
      hash: 'nzb',
      nzb: 'https://example.com/movie.nzb',
      size: 100000000,
    };
    const torrent = {
      type: 'torrent' as const,
      title: names[0],
      hash: '1'.repeat(40),
      sources: [],
      size: 100000000,
      files,
    };
    for (const result of [
      await processNZBs([nzb], services, 'tt1234567', playbackMetadata),
      await processTorrents([torrent], services, 'tt1234567', playbackMetadata),
    ]) {
      assert.deepEqual(result.errors, []);
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].file?.index, 1);
      assert.equal(result.results[0].service?.id, 'torbox');
    }
    assert.equal(
      (await processTorrentsForP2P([torrent], playbackMetadata))[0]?.file
        ?.index,
      1
    );
    assert.equal(
      filterUnprocessedTorrentsPreDownload([torrent], playbackMetadata).length,
      1
    );
    for (const release of [nzb, torrent]) {
      const restored = PlaybackInfoSchema.parse({
        ...release,
        metadata: playbackMetadata,
      });
      assert.equal(restored.metadata?.mediaType, 'movie');
      const old = PlaybackInfoSchema.parse({
        ...release,
        metadata: { titles: [title] },
      });
      assert.equal(old.metadata?.mediaType, undefined);
    }
  });
  it('retains all explicit season/episode and strict title/year/country protections', async () => {
    const bad = [
      names[0].replace('Room 30', 'Room 31'),
      names[0].replace('The Case', 'A Different Case'),
      names[0].replace(' (1080p)', ' E30 (1080p)'),
      names[0].replace(' (1080p)', ' S00E01 (1080p)'),
      names[0].replace(' (1080p)', ' S01E30 (1080p)'),
      names[0].replace(' (1080p)', ' 30-31 (1080p)'),
      names[0].replace(' (1080p)', ' Extra (1080p)'),
      names[0].replace(' (1080p)', ' 2019 (1080p)'),
    ].map((name) => stream(name));
    const country = stream(names[0]);
    country.parsedFile!.country = 'US';
    bad.push(country);
    for (const type of streamTypes) {
      assert.deepEqual(
        await new StreamFilterer(options).filter(
          bad.map((item) => ({
            ...item,
            type,
            parsedFile: structuredClone(item.parsedFile),
          })),
          context()
        ),
        [],
        type
      );
    }
    assert.deepEqual(
      await new StreamFilterer({
        ...options,
        yearMatching: { enabled: true, strict: true },
      }).filter([stream(names[0])], context()),
      []
    );
  });
  it('does not override merged folder numbering or series processing', async () => {
    const conflict = stream(names[0]);
    conflict.parsedFile!.episodes = [1];
    const folder = stream(names[0]);
    folder.parsedFile!.seasons = [0];
    assert.deepEqual(
      await new StreamFilterer(options).filter([conflict, folder], context()),
      []
    );
    const series = context({
      type: 'series',
      parsedId: { season: '1', episode: '1' },
    });
    assert.deepEqual(
      await new StreamFilterer(options).filter([stream(names[0])], series),
      []
    );
  });
});
