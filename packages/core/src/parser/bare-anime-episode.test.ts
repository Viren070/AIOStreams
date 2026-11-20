import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reconcileBareAnimeEpisode } from './utils.js';

describe('bare absolute anime episode recovery', () => {
  it('recovers a known absolute episode and preserves other parsed fields', () => {
    const parsed = {
      title: 'Example Anime 159',
      seasonPack: true,
      resolution: '1080p',
    };
    assert.deepEqual(
      reconcileBareAnimeEpisode(parsed, ['Example Anime'], [159]),
      {
        ...parsed,
        title: 'Example Anime',
        episodes: [159],
        seasonPack: false,
      }
    );
    assert.equal(parsed.title, 'Example Anime 159');
  });
  it('accepts normalized aliases, leading zeros, versions, and relative absolute numbering', () => {
    assert.deepEqual(
      reconcileBareAnimeEpisode(
        { title: 'EXAMPLE: Anime 0159v2' },
        ['Example Anime'],
        [300, 159]
      ),
      { title: 'EXAMPLE: Anime', episodes: [159], seasonPack: false }
    );
  });
  for (const fixture of [
    { title: 'Example Anime 158', expected: 159 },
    { title: 'Different Anime 159', expected: 159 },
    { title: 'Example Anime 1.5', expected: 1.5 },
    { title: 'Example Anime 0', expected: 0 },
    { title: 'Example Anime 2020', expected: 2020 },
    { title: 'Example Anime 1080', expected: 1080 },
    { title: 'Example Anime 159', expected: undefined },
  ]) {
    it(`does not recover ambiguous or unrequested ${fixture.title} (${fixture.expected})`, () => {
      const parsed = { title: fixture.title };
      assert.equal(
        reconcileBareAnimeEpisode(
          parsed,
          ['Example Anime'],
          [fixture.expected]
        ),
        parsed
      );
    });
  }
  it('keeps numeric titles intact when the complete title is a known alias', () => {
    const parsed = { title: 'Example Anime 159' };
    assert.equal(
      reconcileBareAnimeEpisode(
        parsed,
        ['Example Anime', 'Example Anime 159'],
        [159]
      ),
      parsed
    );
  });
  for (const coordinates of [{ seasons: [2] }, { episodes: [158] }]) {
    it(`does not override parsed ${Object.keys(coordinates)[0]}`, () => {
      const parsed = { title: 'Example Anime 159', ...coordinates };
      assert.equal(
        reconcileBareAnimeEpisode(parsed, ['Example Anime'], [159]),
        parsed
      );
    });
  }
});
