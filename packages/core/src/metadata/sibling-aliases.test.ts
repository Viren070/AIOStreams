import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assembleTitles, type SourceContributions } from './merge.js';

describe('sibling alias title assembly', () => {
  const contributions: SourceContributions = {
    anime: {
      aliases: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((title) => ({
        title,
      })),
    },
    tmdb: { primaryTitle: 'Alpha', aliases: [{ title: 'TMDB later cour' }] },
    tvdb: { primaryTitle: 'Beta', aliases: [{ title: 'TVDB later cour' }] },
    trakt: { aliases: [{ title: 'Trakt later cour' }] },
  };
  it('suppresses whole-show aliases while keeping primary and anime titles', () => {
    const titles = assembleTitles(contributions, {
      suppressWholeShowAliases: true,
    }).map((t) => t.title);
    for (const title of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
      assert.ok(titles.includes(title));
    for (const title of [
      'TMDB later cour',
      'TVDB later cour',
      'Trakt later cour',
    ])
      assert.ok(!titles.includes(title));
  });
  it('restores aliases when fewer than five distinct titles survive', () => {
    const sparse = {
      ...contributions,
      anime: { aliases: [{ title: 'Alpha' }, { title: 'Alpha' }] },
    };
    assert.deepEqual(
      assembleTitles(sparse, { suppressWholeShowAliases: true }),
      assembleTitles(sparse)
    );
  });
  it('preserves the normal title pool when disabled', () => {
    assert.deepEqual(
      assembleTitles(contributions, { suppressWholeShowAliases: false }),
      assembleTitles(contributions)
    );
  });
});
