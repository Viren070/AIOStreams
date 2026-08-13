import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseDeepbridVideoFiles,
  createDeepbridPlaybackToken,
  decodeDeepbridPlaybackToken,
} from './addon.js';
import {
  isDeepbridArchiveName,
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
