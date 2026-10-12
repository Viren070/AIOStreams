import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isEpisodeTitleLanguageTag } from './episode-title.js';

describe('language labels misparsed as episode names', () => {
  it('recognises complete labels in multiple languages and formats', () => {
    for (const tag of [
      'SUBFRENCH',
      'subeng',
      'Sub.Spanish',
      'Subbed German',
      'French Dub',
      'English Subtitles',
      'dub-kor',
      'vostfr',
      'SUB.Japanese',
    ])
      assert.equal(isEpisodeTitleLanguageTag(tag), true, tag);
  });
  it('preserves meaningful names, embedded labels and unknown languages', () => {
    for (const title of [
      'French',
      'Sub Zero',
      'Dub Trouble',
      'SUBFRENCH Returns',
      'English Subtitles Are Missing',
      'Pilot',
      'Original',
      'Sub Atlantis',
      'Episode 10',
    ])
      assert.equal(isEpisodeTitleLanguageTag(title), false, title);
  });
});
