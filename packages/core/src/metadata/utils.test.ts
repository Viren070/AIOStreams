import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateTitles } from './utils.js';

describe('deduplicateTitles', () => {
  it('keeps every language of a title several languages share', () => {
    assert.deepEqual(
      deduplicateTitles([
        { title: 'Престиж', language: 'ru' },
        { title: 'Престиж', language: 'bg' },
        { title: 'Престиж', language: 'uk' },
      ]),
      [{ title: 'Престиж', language: undefined, languages: ['ru', 'bg', 'uk'] }]
    );
  });

  it('keeps the language of a title only one language uses', () => {
    assert.deepEqual(
      deduplicateTitles([
        { title: 'The Prestige', language: 'en' },
        { title: 'the prestige' },
      ]),
      [{ title: 'The Prestige', language: undefined, languages: ['en'] }]
    );
  });

  it('still resolves a shared title to the original language', () => {
    assert.deepEqual(
      deduplicateTitles(
        [
          { title: 'Shingeki no Kyojin', language: 'ja' },
          { title: 'Shingeki no Kyojin', language: 'pt' },
        ],
        'ja'
      ),
      [
        {
          title: 'Shingeki no Kyojin',
          language: 'ja',
          languages: ['ja', 'pt'],
        },
      ]
    );
  });

  it('carries the languages of trusted titles through a second pass', () => {
    const tmdb = deduplicateTitles([
      { title: 'Престиж', language: 'ru' },
      { title: 'Престиж', language: 'bg' },
    ]).map((t) => ({ ...t, trusted: true }));
    assert.deepEqual(
      deduplicateTitles([
        { title: 'Престиж' },
        ...tmdb,
        { title: 'Престиж', language: 'en' },
      ]),
      [{ title: 'Престиж', language: undefined, languages: ['ru', 'bg'] }]
    );
  });
});
