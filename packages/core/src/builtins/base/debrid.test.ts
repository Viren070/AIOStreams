import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Use the normal core entry point to initialise the builtins' dependency graph.
import '../../index.js';
import { BaseDebridAddon } from './debrid.js';
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
