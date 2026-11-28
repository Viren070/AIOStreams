import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getAnimeReleaseTitle, getSiblingTitles } from './sibling-titles.js';
import { AnimeType, type AnimeEntry } from './types.js';

describe('known anime sibling titles', () => {
  it('excludes normalized shared aliases and deduplicates sibling names', () => {
    const chosen = {
      rid: 1,
      type: AnimeType.TV,
      ids: {},
      title: 'Example',
      synonyms: ['Shared Name'],
    };
    const sibling = {
      rid: 2,
      type: AnimeType.TV,
      ids: {},
      title: 'Example Kan',
      synonyms: ['Shared.Name', 'Example.Kan'],
    };
    assert.deepEqual(getSiblingTitles(chosen, [chosen, sibling, sibling]), [
      'Example.Kan',
    ]);
  });

  const entry = {
    title: 'Example',
    synonyms: ['Shared Name'],
    siblingTitles: ['Example Kan'],
  } as AnimeEntry;
  it('does not exclude titles when the selected record has no usable titles', () => {
    assert.deepEqual(
      getSiblingTitles({ rid: 1, type: AnimeType.TV, ids: {} }, [
        { rid: 2, type: AnimeType.TV, ids: {}, title: 'Example Kan' },
      ]),
      []
    );
  });
  for (const filename of [
    '[Group].Example.Kan.-.02.[BD.1080p].mkv',
    'group-example.kan.e02.720p.mkv',
    'Example-Kan-S03E02.mkv',
    'Example_Kan_02v2.mkv',
    'Example Kan 3x02.mkv',
  ]) {
    it(`recovers the known title in ${filename}`, () => {
      assert.equal(
        getAnimeReleaseTitle('Example', filename, entry),
        'Example Kan'
      );
    });
  }
  it('keeps the same title when that part is requested', () => {
    const requested = {
      ...entry,
      title: 'Example Kan',
      siblingTitles: ['Example'],
    };
    assert.equal(
      getAnimeReleaseTitle('Example', 'Example Kan - 02.mkv', requested),
      'Example Kan'
    );
  });
  it('ignores spacing without removing the episode boundary', () => {
    assert.equal(
      getAnimeReleaseTitle('Example Name', 'ExampleName Kan - 02.mkv', {
        ...entry,
        siblingTitles: ['Example Name Kan'],
      }),
      'Example Name Kan'
    );
  });
  it('prefers the complete known title when its name contains a number', () => {
    assert.equal(
      getAnimeReleaseTitle('Example', 'Example 86 Kan - 02.mkv', {
        ...entry,
        siblingTitles: ['Example 86 Kan'],
      }),
      'Example 86 Kan'
    );
  });
  for (const filename of [
    'Example - 02 [KAN].mkv',
    'Example - 02 - Example Kan.mkv',
    'Example Kan Fansub - 02.mkv',
    'Other Example Kan - 02.mkv',
    'Example Kaan - 02.mkv',
  ]) {
    it(`does not infer a sibling title from ${filename}`, () => {
      assert.equal(getAnimeReleaseTitle('Example', filename, entry), 'Example');
    });
  }
  it('preserves existing parsing when sibling metadata is unavailable', () => {
    assert.equal(
      getAnimeReleaseTitle('Example', 'Example Kan - 02.mkv', null),
      'Example'
    );
  });
});
