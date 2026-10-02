import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../index.js';
import StreamFilterer from './filterer.js';
import FileParser from '../parser/file.js';
import { parseTorrentTitleCached } from '../parser/title.js';
import {
  recoverAnimeRelease,
  isRecoveredAnimeEpisodeWrong,
} from '../parser/anime-release.js';
import {
  isTitleWrong,
  isEpisodeWrong,
  selectFileInTorrentOrNZB,
} from '../debrid/utils.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import type { StreamContext } from './context.js';
import type { DebridDownload } from '../debrid/base.js';

const names = [
  'HorribleSubs One Piece 110 1080p',
  'HorribleSubs One Piece 110 720p',
  '[K-F] One Piece 110 [3CD64B59]',
  '[K-F]_One_Piece_110_[3CD64B59].avi',
  'HorribleSubs One Piece 110 720p.mkv',
];
const metadata = {
  isAnime: true,
  titles: ['One Piece'],
  season: 7,
  episode: 19,
  absoluteEpisode: 110,
};
function stream(filename: string, id = filename): ParsedStream {
  return {
    id,
    filename,
    type: 'usenet',
    parsedFile: FileParser.parse(filename),
    addon: { name: 'Test', preset: { id: 'newznab' } },
  } as ParsedStream;
}
function context(kitsu: boolean): StreamContext {
  return {
    type: 'series',
    id: kitsu ? 'kitsu:12:110' : 'tt0388629:7:19',
    isAnime: true,
    parsedId: { season: kitsu ? 1 : 7, episode: kitsu ? 110 : 19 },
    getPermittedPatterns: async () => ({ allowed: [], denied: [] }),
    getMetadata: async () => ({
      title: 'One Piece',
      titles: [{ title: 'One Piece', language: 'en' }],
      year: 1999,
      absoluteEpisode: 110,
      relativeAbsoluteEpisode: 110,
    }),
    getReleaseDates: async () => undefined,
    getEpisodeAirDate: async () => undefined,
    getEpisodeRuntime: async () => undefined,
    toExpressionContext: () => ({}),
  } as unknown as StreamContext;
}
const userData = {
  titleMatching: {
    enabled: true,
    mode: 'exact',
    similarityThreshold: 0.96,
    ambiguousResults: 'discard',
  },
  seasonEpisodeMatching: { enabled: true, strict: true },
} as UserData;

describe('anime NZB recovery through validation, matching and selection', () => {
  it('passes early title checks while rejecting a wrong recovered episode', () => {
    for (const name of names) {
      const recovered = recoverAnimeRelease(
        name,
        parseTorrentTitleCached(name),
        metadata
      );
      assert.equal(isTitleWrong(recovered, metadata), false);
      assert.equal(isEpisodeWrong(recovered, metadata), false);
    }
    const relative = 'HorribleSubs One Piece 19 720p';
    assert.equal(
      isRecoveredAnimeEpisodeWrong(
        recoverAnimeRelease(
          relative,
          parseTorrentTitleCached(relative),
          metadata
        ),
        metadata
      ),
      true
    );
    const wrong = 'HorribleSubs One Piece 111 720p';
    assert.equal(
      isEpisodeWrong(
        recoverAnimeRelease(wrong, parseTorrentTitleCached(wrong), metadata),
        metadata
      ),
      true
    );
  });
  for (const kitsu of [true, false]) {
    it(`retains all release forms under strict ${kitsu ? 'Kitsu' : 'IMDb'} matching`, async () => {
      const result = await new StreamFilterer(userData).filter(
        names.map(stream),
        context(kitsu)
      );
      assert.equal(result.length, names.length);
      for (const item of result) {
        assert.equal(item.parsedFile?.title, 'One Piece');
        assert.deepEqual(item.parsedFile?.episodes, [110]);
      }
    });
    it(`rejects wrong episodes and unrelated titles under ${kitsu ? 'Kitsu' : 'IMDb'}`, async () => {
      const result = await new StreamFilterer(userData).filter(
        [
          stream('HorribleSubs One Piece 111 720p'),
          stream('HorribleSubs One Piece 19 720p'),
          stream('Movie One Piece 110 1080p'),
        ],
        context(kitsu)
      );
      assert.equal(result.length, 0);
    });
  }
  it('does not propagate a recovered mismatch across duplicate stream ids', async () => {
    const result = await new StreamFilterer(userData).filter(
      [
        stream('HorribleSubs One Piece 111 720p', 'duplicate-id'),
        stream('HorribleSubs One Piece 110 720p', 'duplicate-id'),
      ],
      context(true)
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]?.filename, 'HorribleSubs One Piece 110 720p');
  });
  it('selects the matching inner video during playback without mutating parsing', async () => {
    const files = [19, 110, 111].map((ep, index) => ({
      name: `OtherSubs One Piece ${ep} 720p.mkv`,
      index,
      size: 100000000,
    }));
    const parsed = new Map(
      files.map((file) => [file.name, parseTorrentTitleCached(file.name)])
    );
    const original = structuredClone(parsed);
    const selected = await selectFileInTorrentOrNZB(
      {
        type: 'usenet',
        title: names[0],
        hash: 'test',
        nzb: 'https://example.com/test.nzb',
      },
      { files, status: 'cached' } as DebridDownload,
      parsed,
      metadata
    );
    assert.equal(selected?.index, 1);
    assert.deepEqual(parsed, original);
  });
});
