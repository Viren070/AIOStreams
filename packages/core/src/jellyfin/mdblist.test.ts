import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mdbListJsonUrl,
  mdbListName,
  mdbListTitles,
  parseMdbListUrl,
} from './mdblist.js';

describe('parseMdbListUrl', () => {
  it('reads a list link', () => {
    assert.deepEqual(
      parseMdbListUrl('https://mdblist.com/lists/hdlists/christmas-movies'),
      { user: 'hdlists', slug: 'christmas-movies' }
    );
  });

  it('takes the forms people paste', () => {
    for (const link of [
      'mdblist.com/lists/hdlists/christmas-movies',
      'https://www.mdblist.com/lists/hdlists/christmas-movies/',
      'https://mdblist.com/lists/hdlists/christmas-movies/json',
      'https://mdblist.com/lists/hdlists/christmas-movies?sort=rank',
      '  https://mdblist.com/lists/hdlists/christmas-movies#top  ',
    ]) {
      assert.deepEqual(
        parseMdbListUrl(link),
        { user: 'hdlists', slug: 'christmas-movies' },
        link
      );
    }
  });

  it('keeps names with dots, underscores and capitals', () => {
    assert.deepEqual(
      parseMdbListUrl('https://mdblist.com/lists/leo.ninja_Monkey/Kids-2'),
      { user: 'leo.ninja_Monkey', slug: 'Kids-2' }
    );
  });

  it('refuses anything that is not an MDBList list', () => {
    for (const link of [
      '',
      'christmas-movies',
      'https://example.com/lists/hdlists/christmas-movies',
      'https://mdblist.com.example.com/lists/a/b',
      'https://evil.com/?u=https://mdblist.com/lists/a/b',
      'https://mdblist.com/lists/hdlists',
      'https://mdblist.com/movie/tt0111161',
      'https://mdblist.com/lists/a/b/c',
      'https://mdblist.com/lists/../b',
      'https://user@mdblist.com/lists/a/b',
      'https://mdblist.com:8443/lists/a/b',
      'ftp://mdblist.com/lists/a/b',
    ]) {
      assert.equal(parseMdbListUrl(link), null, link);
    }
  });
});

describe('mdbListJsonUrl', () => {
  it('asks for the public JSON of the list', () => {
    assert.equal(
      mdbListJsonUrl({ user: 'hdlists', slug: 'christmas-movies' }),
      'https://mdblist.com/lists/hdlists/christmas-movies/json'
    );
  });
});

describe('mdbListTitles', () => {
  it('lists films and shows by IMDb id, in the list order', () => {
    const body = [
      { rank: 2, imdb_id: 'tt0386676', mediatype: 'show', title: 'The Office' },
      { rank: 1, imdb_id: 'tt4729430', mediatype: 'movie', title: 'Klaus' },
    ];
    assert.deepEqual(mdbListTitles(body), [
      { type: 'movie', id: 'tt4729430' },
      { type: 'series', id: 'tt0386676' },
    ]);
  });

  it('keeps the given order when ranks are missing', () => {
    const body = [
      { imdb_id: 'tt3', mediatype: 'movie' },
      { imdb_id: 'tt1', mediatype: 'movie' },
    ];
    assert.deepEqual(
      mdbListTitles(body).map((t) => t.id),
      ['tt3', 'tt1']
    );
  });

  it('skips entries it cannot play and repeats', () => {
    const body = [
      { rank: 1, imdb_id: 'tt1', mediatype: 'movie' },
      { rank: 2, imdb_id: null, mediatype: 'movie' },
      { rank: 3, imdb_id: 'nm0000123', mediatype: 'movie' },
      { rank: 4, imdb_id: 'tt2', mediatype: 'person' },
      { rank: 5, imdb_id: 'tt1', mediatype: 'movie' },
      null,
      'tt9',
    ];
    assert.deepEqual(mdbListTitles(body), [{ type: 'movie', id: 'tt1' }]);
  });

  it('gives nothing for a body that is not a list', () => {
    assert.deepEqual(mdbListTitles({ error: 'not found' }), []);
    assert.deepEqual(mdbListTitles(null), []);
  });
});

describe('mdbListName', () => {
  it('names the playlist after the list', () => {
    assert.equal(
      mdbListName({ user: 'hdlists', slug: 'christmas-movies' }),
      'Christmas movies'
    );
    assert.equal(mdbListName({ user: 'u', slug: 'top_250' }), 'Top 250');
  });
});
