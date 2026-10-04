import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../index.js';
import { AnimeRepository } from '../db/repositories/anime.js';
import { AnimeDatabase } from './database.js';
import { parseTorrentTitleCached } from '../parser/title.js';
import { normaliseTitle, titleMatchWithLang } from '../parser/utils.js';
import { selectBestRecord, filterCandidatesBySeasonType } from './selector.js';
import { AnimeType, type AnimeRecord } from './types.js';

// Reduced from the candidate records logged for tt0434665:3:2 and :3:13.
// The original covers TVDB seasons 1–16. TYBW aliases count the continuation
// as seasons 2/3/4, whereas TVDB places all its parts in season 17.
const counts = [20, 21, 22, 28, 18, 22, 20, 16, 22, 16, 7, 17, 36, 51, 26, 24];
let absoluteStart = 1;
const episodeMappings = counts.map((count, i) => {
  const start = absoluteStart;
  absoluteStart += count;
  return {
    anidbSeason: 1,
    tvdbSeason: i + 1,
    start,
    end: start + count - 1,
    offset: 1 - start,
  };
});
const original: AnimeRecord = {
  rid: 2163,
  type: AnimeType.TV,
  ids: { imdbId: 'tt0434665', thetvdbId: 74796, themoviedbId: 30984 },
  title: 'Bleach',
  synonyms: ['BLEACH', 'bleach tv'],
  imdb: { id: 'tt0434665', fromSeason: 1, fromEpisode: 1 },
  tvdb: { seasonNumber: 'a', episodeMappings },
  tmdb: { seasonNumber: 1 },
  trakt: { seasonNumber: 1 },
};
const parts: AnimeRecord[] = [1, 14, 27, 41].map((fromEpisode, i) => ({
  rid: 12317 + i,
  type: AnimeType.TV,
  ids: { ...original.ids },
  title: `Bleach: Thousand-Year Blood War Part ${i + 1}`,
  synonyms: i < 3 ? [`Bleach Season ${i + 2}`, 'BLEACH TYBW'] : ['BLEACH TYBW'],
  tvdb: { seasonNumber: 17, fromEpisode },
  tmdb: { seasonNumber: 2, fromEpisode },
}));
const records = [original, ...parts];
function lookup(candidates: AnimeRecord[], season: number, episode: number) {
  return selectBestRecord(
    filterCandidatesBySeasonType(candidates, season, 'imdbId'),
    'imdbId',
    'tt0434665',
    season,
    episode
  );
}

describe('IMDb season ranges corroborated by explicit episode mappings', () => {
  for (const [season, episode] of [
    [2, 2],
    [3, 1],
    [3, 2],
    [3, 4],
    [3, 13],
    [3, 22],
    [4, 2],
    [5, 2],
    [16, 24],
  ]) {
    it(`keeps the original Bleach entry for S${season}E${episode}`, () => {
      assert.equal(lookup(records, season, episode), original);
      assert.equal(lookup([...records].reverse(), season, episode), original);
    });
  }
  it('keeps an exact IMDb continuation authoritative', () => {
    const native = { ...parts[1], imdb: { fromSeason: 3, fromEpisode: 1 } };
    assert.equal(lookup([original, native], 3, 2), native);
  });
  it('does not corroborate missing or out-of-range episode mappings', () => {
    const noRanges = { ...original, tvdb: { seasonNumber: 'a' as const } };
    assert.equal(lookup([noRanges, parts[1]], 3, 2), parts[1]);
    assert.equal(lookup([original, parts[1]], 3, 23), parts[1]);
  });
  it('does not use specials, incomplete ranges, invalid offsets or unrelated seasons', () => {
    for (const rule of [
      { anidbSeason: 0, tvdbSeason: 3, start: 1, end: 10 },
      { anidbSeason: 1, tvdbSeason: 3, start: 1 },
      { anidbSeason: 1, tvdbSeason: 3, start: 10, end: 1 },
      { anidbSeason: 1, tvdbSeason: 3, start: 1, end: 10, offset: NaN },
      { anidbSeason: 1, tvdbSeason: 3, start: 1, end: 10, offset: 0.5 },
      { anidbSeason: 1, tvdbSeason: 4, start: 1, end: 10 },
    ]) {
      const changed = {
        ...original,
        tvdb: { seasonNumber: 'a' as const, episodeMappings: [rule] },
      };
      assert.equal(lookup([changed, parts[1]], 3, 2), parts[1]);
    }
  });
  it('does not reinterpret native TMDB numbering as IMDb/TVDB numbering', () => {
    assert.equal(
      selectBestRecord(records, 'themoviedbId', 30984, 2, 15),
      parts[1]
    );
  });
});

for (const episode of [2, 13]) {
  it(`keeps TYBW aliases out of the original S3E${episode} lookup and title matching`, async (t) => {
    t.mock.method(AnimeRepository, 'findCandidates', async () => records);
    const db = AnimeDatabase.getInstance();
    const entries = [
      await db.getEntryById('imdbId', 'tt0434665', 3, episode),
      (await db.selectorFor('imdbId', 'tt0434665'))(3, episode),
    ];
    for (const entry of entries) {
      assert.equal(entry?.title, 'Bleach');
      const titles = [entry!.title!, ...(entry!.synonyms ?? [])].map(
        (title) => ({ title })
      );
      assert.ok(
        titles.every(({ title }) => !/TYBW|Blood War|Season 3/.test(title))
      );
      for (const [title, expected] of [
        ['Bleach', true],
        ['BLEACH.Thousand-Year.Blood.War', false],
      ] as const) {
        const parsed = parseTorrentTitleCached(
          `${title}.S03E${String(episode).padStart(2, '0')}.720p.HEVC.x265-MeGusta`
        );
        assert.deepEqual(parsed.seasons, [3]);
        assert.deepEqual(parsed.episodes, [episode]);
        assert.equal(
          titleMatchWithLang(normaliseTitle(parsed.title!), titles, {
            threshold: 0.85,
            limitTitles: 100,
          }).matched,
          expected
        );
      }
    }
  });
}

it('preserves TYBW cour boundaries beyond the original mapped seasons', () => {
  for (const [episode, part] of [
    [1, 0],
    [13, 0],
    [14, 1],
    [26, 1],
    [27, 2],
    [40, 2],
    [41, 3],
    [48, 3],
  ]) {
    assert.equal(lookup(records, 17, episode), parts[part]);
  }
});
