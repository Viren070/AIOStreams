import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTorrentTitle } from '@viren070/parse-torrent-title';
import {
  getAnimeSeasonEpisodeMapping,
  reconcileAnimeSeasonEpisode,
} from './anime-season-episode.js';
import type { ExtendedMetadata } from '../streams/context.js';

export const conanMetadata: ExtendedMetadata = {
  title: 'Detective Conan',
  titles: [{ title: 'Detective Conan' }],
  absoluteEpisode: 233,
  resolvedSeasonNumber: 9,
  resolvedSeasonFirstEpisode: 1,
  seasons: [28, 26, 28, 24, 28, 28, 31, 26, 35, 31].map(
    (episode_count, index) => ({ season_number: index + 1, episode_count })
  ),
};

describe('anime season + absolute episode reconciliation', () => {
  const mapping = getAnimeSeasonEpisodeMapping(9, 14, conanMetadata)!;

  for (const token of [
    '233',
    '0233',
    'E233',
    'e0233',
    '- 233',
    '.-.233',
    '233v2',
  ]) {
    it(`maps S09 ${token} to S09E14 using the real parser`, () => {
      const filename = `Detective Conan (2001) S09 ${token}.mkv`;
      const parsed = Object.freeze(parseTorrentTitle(filename));
      const before = structuredClone(parsed);
      const result = reconcileAnimeSeasonEpisode(parsed, filename, mapping);
      assert.deepEqual(result.seasons, [9]);
      assert.deepEqual(result.episodes, [14]);
      assert.equal(result.seasonPack, false);
      assert.deepEqual(parsed, before);
    });
  }

  it('handles adjoining E notation', () => {
    const filename = 'Detective.Conan.S09E233.1080p.mkv';
    assert.deepEqual(
      reconcileAnimeSeasonEpisode(
        parseTorrentTitle(filename),
        filename,
        mapping
      ).episodes,
      [14]
    );
  });

  it('allows hyphen-separated quality suffixes after absolute episodes', () => {
    for (const token of ['233', 'E233']) {
      for (const quality of ['1080p', '720p', '10bit']) {
        const filename = `Detective Conan S09 ${token} - ${quality}.mkv`;
        assert.deepEqual(
          reconcileAnimeSeasonEpisode(
            parseTorrentTitle(filename),
            filename,
            mapping
          ).episodes,
          [14],
          filename
        );
      }
    }
  });

  it('preserves numeric continuations even when the parser extracts only one episode', () => {
    for (const tail of [
      ' - 234',
      ' - 234v2',
      '+234',
      ',234',
      ' E234v2',
      '.5',
      '-0306-16',
    ]) {
      const filename = `Detective Conan S09 E233${tail}.mkv`;
      const parsed = { seasons: [9], episodes: [233] };
      assert.equal(
        reconcileAnimeSeasonEpisode(parsed, filename, mapping),
        parsed,
        filename
      );
    }
  });

  it('recovers wrong bare episodes as their actual relative episodes', () => {
    for (const [absolute, relative] of [
      [236, 17],
      [252, 33],
    ]) {
      const filename = `Detective Conan (2001) S09 0${absolute}.mkv`;
      assert.deepEqual(
        reconcileAnimeSeasonEpisode(
          parseTorrentTitle(filename),
          filename,
          mapping
        ).episodes,
        [relative]
      );
    }
  });

  for (const token of [
    'S09',
    'S09E14',
    'S09E15',
    'S08 E233',
    'S09-13',
    'S09-233',
    'S09 E233-E234',
    'S09 233-234',
    'S09 233.5',
    'S09 233v2.5',
    'S09 233+234',
    'S09 233,234',
    'S09 233 234',
    'S09 E233E234',
    'S09 240',
    'S09 1080p',
    'S09 2001',
    'S09 999',
    'S09 233 S10E1',
  ]) {
    it(`preserves ambiguous, conflicting or unrelated ${token}`, () => {
      const filename = `Detective Conan ${token}.mkv`;
      const parsed = parseTorrentTitle(filename);
      assert.equal(
        reconcileAnimeSeasonEpisode(parsed, filename, mapping),
        parsed
      );
    });
  }

  it('does not use a parent folder to identify an unnamed file', () => {
    const filename = 'Detective Conan S09 233/unknown.mkv';
    const parsed = { seasons: [9] };
    assert.equal(
      reconcileAnimeSeasonEpisode(parsed, filename, mapping),
      parsed
    );
  });

  it('preserves a valid local E45 when absolute 45 would mean E5', () => {
    const metadata = {
      ...conanMetadata,
      absoluteEpisode: 45,
      resolvedSeasonNumber: 3,
      seasons: [20, 20, 50, 12].map((episode_count, i) => ({
        season_number: i + 1,
        episode_count,
      })),
    };
    const overlap = getAnimeSeasonEpisodeMapping(3, 5, metadata);
    assert.ok(overlap);
    for (const token of ['E45', '45', '045']) {
      const filename = `Show S03 ${token}.mkv`;
      const parsed = parseTorrentTitle(filename);
      assert.equal(
        reconcileAnimeSeasonEpisode(parsed, filename, overlap),
        parsed
      );
    }
  });

  it('requires complete, consistent and historical season metadata', () => {
    for (const patch of [
      { seasons: undefined },
      { seasons: conanMetadata.seasons!.filter((s) => s.season_number !== 4) },
      { seasons: [...conanMetadata.seasons!, conanMetadata.seasons![0]] },
      {
        seasons: conanMetadata.seasons!.map((s) => ({
          ...s,
          episode_count: 0,
        })),
      },
      { seasons: conanMetadata.seasons!.slice(0, 9) },
      { absoluteEpisode: 234 },
      { resolvedSeasonFirstEpisode: 220 },
      { resolvedSeasonFirstEpisode: undefined },
      { resolvedSeasonNumber: 1 },
      { isDateBased: true },
    ]) {
      assert.equal(
        getAnimeSeasonEpisodeMapping(9, 14, { ...conanMetadata, ...patch }),
        undefined
      );
    }
    assert.equal(getAnimeSeasonEpisodeMapping(9, 36, conanMetadata), undefined);
    assert.equal(getAnimeSeasonEpisodeMapping(0, 14, conanMetadata), undefined);
  });
});
