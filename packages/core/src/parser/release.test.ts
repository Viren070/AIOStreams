import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recoverMovieRelease, recoverNzbRelease } from './release.js';
import { parseTorrentTitleCached } from './title.js';

const title = 'Harbour Mystery: The Case of Room 30';
const metadata = { mediaType: 'movie', titles: [title] };
const releases = [
  '[Group] Harbour Mystery - The Case of Room 30 (1080p) [6BD3ED0A].mkv',
  '[Group] Harbour Mystery - The Case of Room 30 [720p][3B6CFA75].mkv',
  'Harbour Mystery - The Case of Room 30 480p',
  'SubsExample-Harbour Mystery-The Case of Room 30 (1080p) [6BD3ED0A].mkv',
  'ExampleSubs.Harbour.Mystery.The.Case.of.Room.30.1080p.mkv',
  'Example-Raws_Harbour_Mystery_The_Case_of_Room_30_[720p].mkv',
];

describe('exact metadata anchored movie release recovery', () => {
  for (const name of releases) {
    it(`recovers ${name} without mutating the parser cache`, () => {
      const parsed = parseTorrentTitleCached(name);
      const before = structuredClone(parsed);
      const recovered = recoverMovieRelease(name, parsed, metadata);
      assert.equal(recovered.title, title);
      assert.deepEqual(recovered.episodes, []);
      assert.equal(recovered.episodeTitle, undefined);
      assert.deepEqual(parsed, before);
      assert.equal(parseTorrentTitleCached(name), parsed);
    });
  }
  it('supports different numeric titles and separator-only aliases', () => {
    for (const known of [
      'Adventure 13',
      'Room 1408',
      'Mission 0',
      'Racing 30 Years',
    ]) {
      const name = `[Group] ${known} (1080p) [01234567].mkv`;
      const result = recoverMovieRelease(name, parseTorrentTitleCached(name), {
        mediaType: 'movie',
        titles: [known, known.replaceAll(' ', '.')],
      });
      assert.equal(result.title, known);
      assert.deepEqual(result.episodes ?? [], []);
    }
  });
  it('preserves explicit year and country evidence', () => {
    const name = `${title} 2019 1080p.mkv`;
    const parsed = { ...parseTorrentTitleCached(name), country: 'US' };
    const recovered = recoverMovieRelease(name, parsed, metadata);
    assert.equal(recovered.year, '2019');
    assert.equal(recovered.country, 'US');
  });
  it('does not guess a movie request or repair anime episode numbering here', () => {
    const name = releases[0];
    const parsed = parseTorrentTitleCached(name);
    for (const meta of [
      undefined,
      { titles: [title] },
      { ...metadata, mediaType: 'series' },
      { ...metadata, mediaType: 'anime', isAnime: true },
      { ...metadata, titles: [] },
      { ...metadata, titles: ['The Case of Room 30'] },
    ]) {
      assert.equal(recoverMovieRelease(name, parsed, meta), parsed);
    }
  });
  for (const name of [
    '[Group] Harbour Mystery - The Case of Room 31 (1080p).mkv',
    '[Group] Harbour Mystery - Another Case of Room 30 (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 01 (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 30 (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 E30 (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 S00E01 (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 S01E30 (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 30-31 (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 30.5 (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 v2 (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 Vol 1 (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 Extra (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 Sample (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 Trailer (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 Directors Cut (1080p).mkv',
    'Other Movie Harbour Mystery - The Case of Room 30 (1080p).mkv',
    'Unrelated-Harbour Mystery-The Case of Room 30 (1080p).mkv',
    '[Group] Harbour Mystery - The Case of Room 30 (1080p).txt',
    '[Group] Harbour Mystery - The Case of Room 30 (1080p).nzb',
  ]) {
    it(`does not reinterpret ${name}`, () => {
      const parsed = parseTorrentTitleCached(name);
      assert.equal(recoverMovieRelease(name, parsed, metadata), parsed);
    });
  }
  it('preserves conflicting parsed coordinates', () => {
    const name = releases[0];
    for (const evidence of [
      { seasons: [0] },
      { seasons: [1] },
      { episodes: [1] },
      { episodes: [30, 31] },
      { volumes: [30] },
      { date: '2026-10-02' },
    ]) {
      const parsed = { ...parseTorrentTitleCached(name), ...evidence };
      assert.equal(recoverMovieRelease(name, parsed, metadata), parsed);
    }
  });
  it('leaves genuinely different overlapping aliases ambiguous', () => {
    const name = 'OtherSubs Harbour Mystery 30 (1080p).mkv';
    const parsed = parseTorrentTitleCached(name);
    assert.equal(
      recoverMovieRelease(name, parsed, {
        mediaType: 'movie',
        titles: ['OtherSubs Harbour Mystery 30', 'Harbour Mystery 30'],
      }),
      parsed
    );
  });
  it('keeps anime NZB recovery and wrong-episode evidence independent', () => {
    const name = 'ExampleSubs Shared Adventure 111 720p';
    const parsed = parseTorrentTitleCached(name);
    const result = recoverNzbRelease(name, parsed, {
      mediaType: 'series',
      isAnime: true,
      titles: ['Shared Adventure'],
      episode: 110,
    });
    assert.equal(result.title, 'Shared Adventure');
    assert.deepEqual(result.episodes, [111]);
  });
});
