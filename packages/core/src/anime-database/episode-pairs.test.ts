import assert from 'node:assert/strict';
import { it } from 'node:test';
import '../utils/index.js';
import { parseTorrentTitleCached } from '../parser/title.js';
import {
  hashNzbUrl,
  isEpisodeWrong,
  selectFileInTorrentOrNZB,
  type NZB,
} from '../debrid/utils.js';
import { isItemMatch } from '../builtins/library/matching.js';
import { IdParser } from '../utils/id-parser.js';
import { isSeasonAbsoluteEpisodePairWrong } from './episode-pairs.js';
import {
  processTorrentsForP2P,
  processTorrents,
  processNZBs,
} from '../builtins/utils/debrid.js';
import { TorboxDebridService } from '../debrid/torbox.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';

const metadata = {
  titles: ['Bleach'],
  season: 17,
  episode: 48,
  absoluteEpisode: 414,
  relativeAbsoluteEpisode: 8,
};

for (const kind of ['torrent', 'nzb'] as const) {
  it(`validates fallback release names for title-less ${kind} inputs`, async (t) => {
    t.mock.method(SettingsRepository, 'getAll', async () => []);
    t.mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
    const title = 'Bleach Sennen Kessen Hen Kashin Tan';
    const request = { ...metadata, localEpisodeTitles: [title] };
    const file = { name: 'Bleach - 08.mkv', size: 1_000_000_000 };
    const nzbUrl = 'https://indexer.example/download/test.nzb?token=test-only';
    const hash =
      kind === 'torrent' ? 'c'.repeat(40) : hashNzbUrl(nzbUrl, false);
    let name = title;
    t.mock.method(
      TorboxDebridService.prototype,
      kind === 'torrent' ? 'checkMagnets' : 'checkNzbs',
      async () => [
        {
          id: 'test',
          hash,
          name,
          status: 'cached',
          files: [file],
        },
      ]
    );
    const input = {
      type: kind,
      hash: 'c'.repeat(40),
      sources: [],
      confirmed: true,
    };
    const services = [{ id: 'torbox' as const, credential: 'test-only' }];
    const search = () =>
      kind === 'torrent'
        ? processTorrents(
            [{ ...input, type: 'torrent' }],
            services,
            'tt0434665:17:48',
            request
          )
        : processNZBs(
            [
              {
                type: 'usenet',
                nzb: nzbUrl,
                hash: hashNzbUrl(nzbUrl),
                confirmed: true,
              } satisfies NZB,
            ],
            services,
            'tt0434665:17:48',
            request
          );
    const valid = await search();
    assert.deepEqual(valid.errors, []);
    assert.equal(valid.results.length, 1);
    assert.equal(valid.results[0].title, title);
    assert.equal(valid.results[0].file, file);
    for (const wrong of [
      'Bleach Sennen Kessen Hen Soukoku Tan - 08',
      `${title} - 07`,
    ]) {
      name = wrong;
      const rejected = await search();
      assert.deepEqual(rejected.errors, []);
      assert.equal(rejected.results.length, 0, wrong);
    }
  });
}

it('uses the resolved download name as outer context for a title-less input', async () => {
  const title = 'Bleach Sennen Kessen Hen Kashin Tan';
  const file = { name: 'Bleach - 08.mkv', size: 1_000_000_000 };
  const parsed = new Map(
    [title, file.name].map((name) => [name, parseTorrentTitleCached(name)])
  );
  assert.equal(
    await selectFileInTorrentOrNZB(
      { type: 'torrent', hash: 'c'.repeat(40), sources: [] },
      { id: 'test', name: title, status: 'cached', files: [file] },
      parsed,
      { ...metadata, localEpisodeTitles: [title] }
    ),
    file
  );
});

it('preserves the verified outer part during P2P inner-file selection', async () => {
  const title = 'Bleach Sennen Kessen Hen Kashin Tan';
  const request = { ...metadata, localEpisodeTitles: [title] };
  const generic = { name: 'Bleach - 08.mkv', size: 1_000_000_000 };
  const wrong = {
    name: 'Bleach Sennen Kessen Hen Soukoku Tan - 08.mkv',
    size: 2_000_000_000,
  };
  const torrent = {
    type: 'torrent' as const,
    title,
    hash: 'c'.repeat(40),
    sources: [],
    files: [wrong, generic],
  };
  const results = await processTorrentsForP2P([torrent], request);
  assert.equal(results.length, 1);
  assert.equal(results[0].file, generic);
  assert.deepEqual(
    await processTorrentsForP2P([{ ...torrent, files: [wrong] }], request),
    []
  );
});

for (const [relative, absolute] of [
  [34, 400],
  [35, 401],
  [37, 403],
  [38, 404],
]) {
  it(`rejects S17E${relative}-${absolute} for both recent episodes, but keeps its actual episode`, () => {
    const name = `Bleach.(2004)-S17E${relative}-${absolute}-SHADOWS.GONE.[WEBDL-1080p][8bit][h264][AAC.2.0][JA]-VARYG.mkv`;
    const parsed = parseTorrentTitleCached(name);
    const before = [...parsed.episodes!];
    assert.ok(parsed.episodes?.includes(48)); // Reproduce the parser ambiguity.
    for (const episode of [47, 48]) {
      const request = { ...metadata, episode, absoluteEpisode: episode + 366 };
      assert.equal(isEpisodeWrong(parsed, request, name), true);
      assert.equal(
        isItemMatch(
          name,
          request,
          IdParser.parse(`tt0434665:17:${episode}`, 'series')!
        ),
        false
      );
    }
    assert.equal(
      isEpisodeWrong(
        parsed,
        { ...metadata, episode: relative, absoluteEpisode: absolute },
        name
      ),
      false
    );
    assert.deepEqual(parsed.episodes, before); // Cached parsing is request-independent.
  });
}

it('uses metadata offsets for other anime and underscore-separated labels', () => {
  const name = 'Example_Anime_S02E03-027_1080p.mkv';
  const parsed = parseTorrentTitleCached(name);
  assert.equal(
    isEpisodeWrong(
      parsed,
      { titles: [], season: 2, episode: 8, absoluteEpisode: 32 },
      name
    ),
    true
  );
  assert.equal(
    isEpisodeWrong(
      parsed,
      { titles: [], season: 2, episode: 3, absoluteEpisode: 27 },
      name
    ),
    false
  );
});

it('preserves genuine short ranges and explicitly labeled range endpoints', () => {
  for (const name of ['Bleach S17E45-48.mkv', 'Bleach S17E34-E400.mkv']) {
    const parsed = parseTorrentTitleCached(name);
    assert.equal(isEpisodeWrong(parsed, metadata, name), false);
  }
  const name = 'Example S02E01-12.mkv';
  assert.equal(
    isEpisodeWrong(
      parseTorrentTitleCached(name),
      { titles: [], season: 2, episode: 8, absoluteEpisode: 32 },
      name
    ),
    false
  );
});

it('preserves season packs, two-episode ranges and enumerated batches', () => {
  const names = [
    'Bleach S17',
    'Bleach S17E34-35.mkv',
    'Bleach S17E34-E35.mkv',
    'Bleach S17E34E35.mkv',
    'Bleach S17E01-E48',
  ];
  for (const name of names) {
    const parsed = parseTorrentTitleCached(name);
    for (const episode of [34, 35]) {
      const request = { ...metadata, episode, absoluteEpisode: episode + 366 };
      assert.equal(isEpisodeWrong(parsed, request, name), false, name);
      assert.equal(
        isItemMatch(
          name,
          request,
          IdParser.parse(`tt0434665:17:${episode}`, 'series')!
        ),
        true,
        name
      );
    }
    if (name.includes('34')) {
      assert.equal(isEpisodeWrong(parsed, metadata, name), true, name);
    }
  }
});

it('selects the requested file inside season packs and multi-episode batches', async () => {
  const files = [
    { name: 'Bleach S17E34.mkv', size: 2_000_000_000 },
    { name: 'Bleach S17E35.mkv', size: 1_000_000_000 },
  ];
  for (const title of [
    'Bleach S17',
    'Bleach S17E34-35',
    'Bleach S17E34-E35',
    'Bleach S17E34E35',
  ]) {
    const parsed = new Map(
      [title, ...files.map((f) => f.name)].map((name) => [
        name,
        parseTorrentTitleCached(name),
      ])
    );
    for (const episode of [34, 35]) {
      assert.equal(
        await selectFileInTorrentOrNZB(
          { type: 'torrent', title, hash: 'b'.repeat(40), sources: [] },
          { id: 'test', status: 'cached', files },
          parsed,
          { ...metadata, episode, absoluteEpisode: episode + 366 }
        ),
        files[episode - 34],
        `${title}, episode ${episode}`
      );
    }
  }
});

it('preserves an ambiguous same-width batch even when its endpoints equal the metadata offset', () => {
  const name = 'Example Anime S02E01-25.mkv';
  assert.equal(
    isEpisodeWrong(
      parseTorrentTitleCached(name),
      {
        titles: [],
        season: 2,
        episode: 8,
        absoluteEpisode: 32,
      },
      name
    ),
    false
  );
});

it('does not infer pairs without a consistent season and absolute offset', () => {
  const name = 'Bleach S17E34-400.mkv';
  const parsed = parseTorrentTitleCached(name);
  for (const request of [
    undefined,
    { ...metadata, absoluteEpisode: undefined },
    { ...metadata, absoluteEpisode: 415 },
    { ...metadata, season: 2 },
    { ...metadata, absoluteEpisode: 48 },
  ]) {
    assert.equal(
      isSeasonAbsoluteEpisodePairWrong(name, parsed, request),
      false
    );
  }
  assert.equal(
    isSeasonAbsoluteEpisodePairWrong(undefined, parsed, metadata),
    false
  );
  assert.equal(
    isSeasonAbsoluteEpisodePairWrong(
      name,
      { ...parsed, episodes: [34, 48, 400] },
      metadata
    ),
    false
  );
  assert.equal(
    isSeasonAbsoluteEpisodePairWrong(
      'Bleach S17E34-400 S17E48.mkv',
      parsed,
      metadata
    ),
    false
  );
});

it('keeps correct pairs and bare absolute labels', () => {
  for (const name of ['Bleach S17E48-414.mkv', 'Bleach - 414.mkv']) {
    assert.equal(
      isEpisodeWrong(parseTorrentTitleCached(name), metadata, name),
      false
    );
  }
});

it('selects the correct inner file and rejects an old pair in a debrid batch', async () => {
  const title = 'Bleach S17';
  const old = { name: 'Bleach S17E34-400.mkv', size: 2_000_000_000 };
  const correct = { name: 'Bleach S17E48-414.mkv', size: 1_000_000_000 };
  const parsed = new Map(
    [title, old.name, correct.name].map((name) => [
      name,
      parseTorrentTitleCached(name),
    ])
  );
  const torrent = {
    type: 'torrent' as const,
    title,
    hash: 'a'.repeat(40),
    sources: [],
  };
  assert.equal(
    await selectFileInTorrentOrNZB(
      torrent,
      { id: 'test', status: 'cached', files: [old, correct] },
      parsed,
      metadata
    ),
    correct
  );
  assert.equal(
    await selectFileInTorrentOrNZB(
      torrent,
      { id: 'test', status: 'cached', files: [old] },
      parsed,
      metadata
    ),
    undefined
  );
});

it('rejects wrong-part inner files while preserving generic filenames in a verified part batch', async () => {
  const title = 'Bleach Sennen Kessen Hen Kashin Tan';
  const request = { ...metadata, localEpisodeTitles: [title] };
  const wrong = {
    name: 'Bleach Sennen Kessen Hen Soukoku Tan - 08.mkv',
    size: 2_000_000_000,
  };
  const generic = { name: 'Bleach - 08.mkv', size: 1_000_000_000 };
  const specific = { name: `${title} - 08.mkv`, size: 1_000_000_000 };
  const parsed = new Map(
    [title, wrong.name, generic.name, specific.name].map((name) => [
      name,
      parseTorrentTitleCached(name),
    ])
  );
  const torrent = {
    type: 'torrent' as const,
    title,
    hash: 'c'.repeat(40),
    sources: [],
  };
  for (const correct of [generic, specific]) {
    assert.equal(
      await selectFileInTorrentOrNZB(
        torrent,
        { id: 'test', status: 'cached', files: [wrong, correct] },
        parsed,
        request
      ),
      correct
    );
  }
  assert.equal(
    await selectFileInTorrentOrNZB(
      torrent,
      { id: 'test', status: 'cached', files: [wrong] },
      parsed,
      request
    ),
    undefined
  );
  // Missing outer parsing cannot let an explicitly wrong inner part bypass validation.
  parsed.delete(title);
  assert.equal(
    await selectFileInTorrentOrNZB(
      torrent,
      { id: 'test', status: 'cached', files: [wrong] },
      parsed,
      request
    ),
    undefined
  );
  assert.equal(
    await selectFileInTorrentOrNZB(
      torrent,
      { id: 'test', status: 'cached', files: [specific] },
      parsed,
      request
    ),
    specific
  );
  // A generic filename requires the correct outer part, not merely the franchise title.
  for (const outer of ['Bleach', 'Bleach Sennen Kessen Hen Soukoku Tan']) {
    parsed.set(outer, parseTorrentTitleCached(outer));
    assert.equal(
      await selectFileInTorrentOrNZB(
        { ...torrent, title: outer },
        { id: 'test', status: 'cached', files: [generic] },
        parsed,
        request
      ),
      undefined
    );
  }
});

it('does not let a matching date promote a wrong-part file above a valid batch file', async () => {
  const title = 'Bleach Sennen Kessen Hen Kashin Tan';
  const date = '2026-09-12';
  const request = {
    ...metadata,
    localEpisodeTitles: [title],
    airDates: [date],
  };
  const wrong = {
    name: 'Bleach Sennen Kessen Hen Soukoku Tan - 08.mkv',
    size: 2_000_000_000,
  };
  const correct = { name: 'Bleach - 08.mkv', size: 1_000_000_000 };
  const torrent = {
    type: 'torrent' as const,
    title,
    hash: 'd'.repeat(40),
    sources: [],
  };
  for (const correctHasDate of [false, true]) {
    const parsed = new Map([
      [title, parseTorrentTitleCached(title)],
      [wrong.name, { ...parseTorrentTitleCached(wrong.name), date }],
      [
        correct.name,
        {
          ...parseTorrentTitleCached(correct.name),
          ...(correctHasDate ? { date } : {}),
        },
      ],
    ]);
    assert.equal(
      await selectFileInTorrentOrNZB(
        torrent,
        { id: 'test', status: 'cached', files: [wrong, correct] },
        parsed,
        request
      ),
      correct
    );
    assert.equal(
      await selectFileInTorrentOrNZB(
        torrent,
        { id: 'test', status: 'cached', files: [wrong] },
        parsed,
        request
      ),
      undefined
    );
  }
});
