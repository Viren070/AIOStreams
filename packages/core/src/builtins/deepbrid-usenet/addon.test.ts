import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeepbridQueries,
  chooseDeepbridVideoFiles,
  createDeepbridPlaybackToken,
  decodeDeepbridPlaybackToken,
  resolveDeepbridFiles,
} from './addon.js';
import {
  isDeepbridArchiveName,
  isDeepbridStorageHost,
  isTrustedDeepbridDownloadHost,
  isDeepbridVideoName,
  validateDeepbridDownloadUrl,
} from './client.js';
import {
  DEEPBRID_USENET_FORMATTING_OPTION,
  DeepbridUsenetStreamParser,
  deepbridUsenetFormatPassthrough,
} from '../../presets/deepbridUsenet.js';
import type { Addon, ParsedStream, Stream } from '../../db/index.js';

class TestDeepbridParser extends DeepbridUsenetStreamParser {
  indexer() {
    return this.getIndexer();
  }

  service(stream: Stream, parsed: ParsedStream) {
    return this.getService(stream, parsed);
  }

  filename(stream: Stream, parsed: ParsedStream) {
    return this.getFilename(stream, parsed);
  }

  size(stream: Stream, parsed: ParsedStream) {
    return this.getSize(stream, parsed);
  }

  streamType(stream: Stream, parsed: ParsedStream) {
    return this.getStreamType(stream, undefined, parsed);
  }
}

const parserAddon: Addon = {
  name: 'Deepbrid Usenet',
  manifestUrl: 'https://example.com/manifest.json',
  enabled: true,
  timeout: 30_000,
  preset: { id: '', type: 'deepbrid-usenet', options: {} },
};

test('accepts HTTPS download hosts without embedded credentials', () => {
  assert.equal(
    validateDeepbridDownloadUrl('https://cdn.deepbrid.com/file.mkv').hostname,
    'cdn.deepbrid.com'
  );
  assert.throws(() =>
    validateDeepbridDownloadUrl('http://www.deepbrid.com/file.mkv')
  );
  assert.equal(
    validateDeepbridDownloadUrl('https://storage.example/file.mkv').hostname,
    'storage.example'
  );
  assert.throws(() =>
    validateDeepbridDownloadUrl('https://user:pass@storage.example/file.mkv')
  );
});

test('trusts only Deepbrid API and recovered Finder storage hosts', () => {
  assert.equal(isDeepbridStorageHost('usenet-2.myfast.link'), true);
  assert.equal(isTrustedDeepbridDownloadHost('www.deepbrid.com'), true);
  assert.equal(isTrustedDeepbridDownloadHost('usenet-2.myfast.link'), true);
  assert.equal(isTrustedDeepbridDownloadHost('myfast.link.evil.test'), false);
  assert.equal(isTrustedDeepbridDownloadHost('storage.example'), false);
});

test('round-trips encrypted, signed playback capabilities', () => {
  const payload = {
    apiKey: 'test-only-key-1234567890',
    url: 'https://www.deepbrid.com/download/video.mkv',
    filename: 'video.mkv',
    size: 1234,
  };
  const token = createDeepbridPlaybackToken(payload);
  assert.ok(!token.includes(payload.apiKey));
  assert.deepEqual(decodeDeepbridPlaybackToken(token), payload);
  assert.throws(() => decodeDeepbridPlaybackToken(`${token.slice(0, -1)}x`));
  assert.throws(() =>
    createDeepbridPlaybackToken({
      ...payload,
      url: 'https://storage.example/video.mkv',
    })
  );
});

test('recognizes archive and video names', () => {
  assert.equal(isDeepbridArchiveName('release.part01.rar'), true);
  assert.equal(isDeepbridArchiveName('release.mkv'), false);
  assert.equal(isDeepbridVideoName('release.MKV'), true);
  assert.equal(isDeepbridVideoName('release.nfo'), false);
});

test('selects the requested episode when an expanded season has many files', () => {
  const files = [
    {
      name: 'Show.S01E01.mkv',
      link: 'https://www.deepbrid.com/1',
      size: 1,
      sizeHuman: '',
    },
    {
      name: 'Show.S01E02.mkv',
      link: 'https://www.deepbrid.com/2',
      size: 2,
      sizeHuman: '',
    },
    {
      name: 'Show.S01E03.nfo',
      link: 'https://www.deepbrid.com/3',
      size: 3,
      sizeHuman: '',
    },
  ];
  assert.deepEqual(
    chooseDeepbridVideoFiles(files, {
      type: 'series',
      season: 1,
      episode: 2,
    }).map((file) => file.name),
    ['Show.S01E02.mkv']
  );
});

test('returns all playable videos for movies', () => {
  const files = [
    {
      name: 'Movie.mkv',
      link: 'https://www.deepbrid.com/1',
      size: 1,
      sizeHuman: '',
    },
    {
      name: 'Movie.sample.mp4',
      link: 'https://www.deepbrid.com/2',
      size: 2,
      sizeHuman: '',
    },
    {
      name: 'Movie.nfo',
      link: 'https://www.deepbrid.com/3',
      size: 3,
      sizeHuman: '',
    },
  ];
  assert.deepEqual(
    chooseDeepbridVideoFiles(files, { type: 'movie' }).map((file) => file.name),
    ['Movie.mkv']
  );
});

test('does not guess among multiple wrong episode files', () => {
  const files = [
    {
      name: 'Show.S01E03.mkv',
      link: 'https://www.deepbrid.com/1',
      size: 1,
      sizeHuman: '',
    },
    {
      name: 'Show.S01E04.mkv',
      link: 'https://www.deepbrid.com/2',
      size: 2,
      sizeHuman: '',
    },
  ];
  assert.deepEqual(
    chooseDeepbridVideoFiles(files, { type: 'series', season: 1, episode: 2 }),
    []
  );
});

test('rejects a single video that explicitly names the wrong episode', () => {
  const files = [
    {
      name: 'Tower.Prep.S01E11.720p.HDTV.mkv',
      link: 'https://usenet-2.myfast.link/11',
      size: 1,
      sizeHuman: '',
    },
  ];
  assert.deepEqual(
    chooseDeepbridVideoFiles(
      files,
      { type: 'series', season: 1, episode: 9 },
      'Tower Prep S01E09'
    ),
    []
  );
});

test('keeps a single video with no episode marker for a matched release', () => {
  const files = [
    {
      name: 'video.mkv',
      link: 'https://usenet-2.myfast.link/video',
      size: 1,
      sizeHuman: '',
    },
  ];
  assert.deepEqual(
    chooseDeepbridVideoFiles(
      files,
      { type: 'series', season: 1, episode: 9 },
      'Tower Prep S01E09'
    ),
    files
  );
});

test('selects short episode names only inside a confirmed season pack', () => {
  const files = [
    {
      name: 'Tower Prep - 01 - New Kid.mkv',
      link: 'https://usenet-2.myfast.link/1',
      size: 1,
      sizeHuman: '',
    },
    {
      name: 'Tower Prep - 02 - Monitored.mkv',
      link: 'https://usenet-2.myfast.link/2',
      size: 1,
      sizeHuman: '',
    },
  ];
  assert.deepEqual(
    chooseDeepbridVideoFiles(
      files,
      { type: 'series', season: 1, episode: 1 },
      'Tower.Prep.S01.Complete.720p.HDTV'
    ).map((file) => file.name),
    ['Tower Prep - 01 - New Kid.mkv']
  );
  assert.deepEqual(
    chooseDeepbridVideoFiles(files, {
      type: 'series',
      season: 1,
      episode: 1,
    }),
    []
  );
});

test('adds an explicit season query without dropping exact episode search', () => {
  const queries = buildDeepbridQueries(
    { title: 'Tower Prep', aliases: [] },
    { type: 'series', season: 1, episode: 1 }
  );
  assert.equal(queries[0], 'Tower Prep S01E01');
  assert.equal(queries.includes('Tower Prep S01'), true);
  assert.equal(queries.includes('Tower Prep'), true);
});

test('parses Deepbrid direct links as formatted Usenet without a fake service', () => {
  const parser = new TestDeepbridParser(parserAddon);
  const stream: Stream = {
    name: '[DB] Deepbrid Usenet',
    description:
      'Example.Show.S01E01.1080p.WEB-DL\nExample.Show.S01E01.1080p.WEB-DL.mkv',
    url: 'https://storage.example/episode.mkv',
    type: 'usenet',
    idMatched: true,
    age: 24,
    behaviorHints: {
      filename: 'Example.Show.S01E01.1080p.WEB-DL.mkv',
      videoSize: 4_294_967_296,
    },
  };

  const parsed = {
    addon: parserAddon,
    type: 'http',
    proxied: false,
  } as ParsedStream;
  assert.equal(parser.indexer(), 'Deepbrid Usenet');
  assert.equal(parser.service(stream, parsed), undefined);
  assert.equal(parser.streamType(stream, parsed), 'usenet');
  assert.equal(
    parser.filename(stream, parsed),
    'Example.Show.S01E01.1080p.WEB-DL.mkv'
  );
  parsed.filename = parser.filename(stream, parsed);
  assert.equal(parser.size(stream, parsed), 4_294_967_296);
});

test('offers only Deepbrid-compatible formatting controls', () => {
  const formatting = DEEPBRID_USENET_FORMATTING_OPTION;
  assert.equal(formatting?.type, 'subsection');
  assert.deepEqual(
    formatting?.subOptions?.map((option) => option.id),
    ['useAioFormatter']
  );
  assert.equal(formatting?.subOptions?.[0]?.default, true);

  const serialized = JSON.stringify(formatting).toLowerCase();
  for (const torrentClawSpecific of [
    'torbox',
    'truespec',
    'cache-on-play',
    'score',
    'remapping',
  ]) {
    assert.equal(serialized.includes(torrentClawSpecific), false);
  }
});

test('uses AIOStreams formatting by default and supports an explicit opt-out', () => {
  assert.equal(deepbridUsenetFormatPassthrough(undefined), false);
  assert.equal(deepbridUsenetFormatPassthrough({}), false);
  assert.equal(
    deepbridUsenetFormatPassthrough({ useAioFormatter: true }),
    false
  );
  assert.equal(
    deepbridUsenetFormatPassthrough({ useAioFormatter: false }),
    true
  );
});

test('resolves Deepbrid content in bounded batches and stops at max results', async () => {
  const calls: string[] = [];
  const ranked = ['a', 'b', 'c', 'd'].map((token, index) => ({
    result: {
      token,
      title: `Movie ${token}`,
      category: '',
      categoryName: '',
      kind: '',
      size: 1,
      sizeHuman: '',
      date: '',
      sources: 4 - index,
    },
    score: 100 - index,
    confirmed: true,
  }));

  const resolved = await resolveDeepbridFiles(
    ranked,
    { type: 'movie' },
    {
      concurrency: 2,
      maxResults: 2,
      deadline: Date.now() + 10_000,
      getContent: async (token) => {
        calls.push(token);
        return {
          title: token,
          files: [
            {
              name: `${token}.mkv`,
              link: `https://storage.example/${token}.mkv`,
              size: 1,
              sizeHuman: '',
            },
          ],
          hasPassword: false,
          password: '',
        };
      },
    }
  );

  assert.deepEqual(calls, ['a', 'b']);
  assert.deepEqual(
    resolved.map((item) => item.file.name),
    ['a.mkv', 'b.mkv']
  );
  assert.equal(
    resolved.every((item) => item.archiveExpanded === false),
    true
  );
});

test('returns partial Deepbrid results when another content lookup fails', async () => {
  const ranked = ['good', 'slow'].map((token) => ({
    result: {
      token,
      title: token,
      category: '',
      categoryName: '',
      kind: '',
      size: 1,
      sizeHuman: '',
      date: '',
      sources: 1,
    },
    score: 100,
    confirmed: true,
  }));

  const resolved = await resolveDeepbridFiles(
    ranked,
    { type: 'movie' },
    {
      concurrency: 2,
      maxResults: 10,
      deadline: Date.now() + 10_000,
      getContent: async (token) => {
        if (token === 'slow')
          throw new DOMException('timed out', 'TimeoutError');
        return {
          title: token,
          files: [
            {
              name: `${token}.mkv`,
              link: `https://storage.example/${token}.mkv`,
              size: 1,
              sizeHuman: '',
            },
          ],
          hasPassword: false,
          password: '',
        };
      },
    }
  );

  assert.deepEqual(
    resolved.map((item) => item.file.name),
    ['good.mkv']
  );
});

test('drops failed playback probes and continues into later batches', async () => {
  const calls: string[] = [];
  const ranked = ['dead', 'working'].map((token) => ({
    result: {
      token,
      title: token,
      category: '',
      categoryName: '',
      kind: '',
      size: 1,
      sizeHuman: '',
      date: '',
      sources: 1,
    },
    score: 100,
    confirmed: true,
  }));
  const resolved = await resolveDeepbridFiles(
    ranked,
    { type: 'movie' },
    {
      concurrency: 1,
      maxResults: 1,
      deadline: Date.now() + 10_000,
      getContent: async (token) => ({
        title: token,
        files: [
          {
            name: `${token}.mkv`,
            link: `https://usenet-2.myfast.link/${token}.mkv`,
            size: 1,
            sizeHuman: '',
          },
        ],
        hasPassword: false,
        password: '',
      }),
      probeFile: async (file) => {
        calls.push(file.name);
        return file.name === 'working.mkv';
      },
    }
  );
  assert.deepEqual(calls, ['dead.mkv', 'working.mkv']);
  assert.deepEqual(
    resolved.map((item) => item.file.name),
    ['working.mkv']
  );
});

test('does not begin another Deepbrid batch after its deadline budget is spent', async () => {
  let now = 1_000;
  const calls: string[] = [];
  const ranked = ['first', 'second'].map((token) => ({
    result: {
      token,
      title: token,
      category: '',
      categoryName: '',
      kind: '',
      size: 1,
      sizeHuman: '',
      date: '',
      sources: 1,
    },
    score: 100,
    confirmed: true,
  }));

  const resolved = await resolveDeepbridFiles(
    ranked,
    { type: 'movie' },
    {
      concurrency: 1,
      maxResults: 10,
      deadline: 3_000,
      now: () => now,
      getContent: async (token) => {
        calls.push(token);
        now = 2_500;
        return {
          title: token,
          files: [],
          hasPassword: false,
          password: '',
        };
      },
    }
  );

  assert.deepEqual(calls, ['first']);
  assert.deepEqual(resolved, []);
});
