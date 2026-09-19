import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recoverAnimeRelease } from './anime-release.js';
import { parseTorrentTitleCached } from './title.js';

const metadata = { isAnime: true, titles: ['One Piece'], episode: 110 };

describe('metadata anchored anime release recovery', () => {
  for (const name of [
    'HorribleSubs One Piece 110 1080p',
    'HorribleSubs One Piece 110 720p',
    '[K-F] One Piece 110 [3CD64B59]',
    '[OtherGroup] One Piece 110 [720p]',
    '[K-F] One Piece 110 [720p][3CD64B59].mkv',
    'DifferentSubs One Piece 110 1080p',
    'Different-Raws One Piece 110 [3CD64B59].mkv',
    'One Piece 110',
    'HorribleSubs One Piece 110 720p.mkv',
  ]) {
    it(`recovers ${name}`, () => {
      const parsed = parseTorrentTitleCached(name);
      const before = structuredClone(parsed);
      const result = recoverAnimeRelease(name, parsed, metadata);
      assert.equal(result.title, 'One Piece');
      assert.deepEqual(result.episodes, [110]);
      assert.deepEqual(parsed, before, 'must not mutate cached parsing');
    });
  }
  it('treats separator-only title aliases as the same identity', () => {
    const name = '[Group] Dan Machi 01 [720p]';
    const result = recoverAnimeRelease(name, parseTorrentTitleCached(name), {
      isAnime: true,
      titles: ['Dan Machi', 'Dan.Machi'],
      episode: 1,
    });
    assert.deepEqual(result.episodes, [1]);
  });
  for (const name of [
    '[Group] Re Zero 01 [720p]',
    '[Group] Re-Zero 01 [720p]',
  ]) {
    it(`matches a sanitized colon title: ${name}`, () => {
      const result = recoverAnimeRelease(name, parseTorrentTitleCached(name), {
        isAnime: true,
        titles: ['Re:Zero'],
        episode: 1,
      });
      assert.equal(result.title, 'Re:Zero');
      assert.deepEqual(result.episodes, [1]);
    });
  }
  it('supports other anime and does not copy the requested episode', () => {
    const name = 'OtherSubs Naruto 111 720p';
    const result = recoverAnimeRelease(name, parseTorrentTitleCached(name), {
      isAnime: true,
      titles: ['Naruto'],
      episode: 110,
    });
    assert.equal(result.title, 'Naruto');
    assert.deepEqual(result.episodes, [111]);
  });
  for (const name of [
    'Movie One Piece 110 1080p',
    'One Piece Movie 110 1080p',
    'One Piece Film Red 110 1080p',
    'VIZ Media - One Piece Vol 110 2025 HYBRID MANGA eBook-21A1',
    'HorribleSubs One Piece 110-111 720p',
    'HorribleSubs One Piece 110 111 720p',
    'HorribleSubs One Piece 110 720p.txt',
    'HorribleSubs One Piece 2025 1080p',
    'HorribleSubs One Piece 0 1080p',
    'HorribleSubs One Piece 110 Manga',
    'HorribleSubs One Piece 1100x720p',
    'HorribleSubs One Piece 110 1080p English',
  ]) {
    it(`does not reinterpret ambiguous or unrelated text: ${name}`, () => {
      const parsed = parseTorrentTitleCached(name);
      assert.equal(recoverAnimeRelease(name, parsed, metadata), parsed);
    });
  }
  it('requires anime metadata and the correct exact title', () => {
    const name = 'HorribleSubs One Piece 110 720p';
    const parsed = parseTorrentTitleCached(name);
    for (const meta of [
      undefined,
      { titles: ['One Piece'] },
      { isAnime: true, titles: ['Piece'] },
    ]) {
      assert.equal(recoverAnimeRelease(name, parsed, meta), parsed);
    }
  });
  it('does not override explicit seasons, episodes, dates, years or volumes', () => {
    const name = 'HorribleSubs One Piece 110 720p';
    for (const evidence of [
      { episodes: [11] },
      { seasons: [2] },
      { year: 2023 },
      { date: '2023-01-01' },
      { volumes: [110] },
    ]) {
      const parsed = { ...parseTorrentTitleCached(name), ...evidence };
      assert.equal(recoverAnimeRelease(name, parsed, metadata), parsed);
    }
  });
});
