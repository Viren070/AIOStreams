import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Load the core entry point first; its modules import each other.
import '../index.js';
import { composersFrom } from './tmdb.js';

describe('composersFrom', () => {
  it('takes a movie’s score composer and leaves the music supervisor', () => {
    const found = composersFrom([
      { id: 1, name: 'Director A', job: 'Director' },
      { id: 2, name: 'Composer B', job: 'Original Music Composer' },
      { id: 3, name: 'Supervisor C', job: 'Music Supervisor' },
    ]);
    assert.deepEqual(
      found.map((c) => c.name),
      ['Composer B']
    );
  });

  it('puts a show’s score before its theme, then the most episodes', () => {
    const found = composersFrom([
      {
        id: 1,
        name: 'Theme D',
        jobs: [{ job: 'Main Title Theme Composer', episode_count: 60 }],
      },
      {
        id: 2,
        name: 'Score E',
        jobs: [{ job: 'Original Music Composer', episode_count: 10 }],
      },
      {
        id: 3,
        name: 'Score F',
        jobs: [
          { job: 'Music Supervisor', episode_count: 5 },
          { job: 'Original Music Composer', episode_count: 40 },
        ],
      },
    ]);
    assert.deepEqual(
      found.map((c) => c.name),
      ['Score F', 'Score E', 'Theme D']
    );
  });

  it('ranks a show’s score composers by episodes whatever their job is called', () => {
    const found = composersFrom([
      ...[1, 2, 3].map((episodes) => ({
        id: episodes,
        name: `Score ${episodes}`,
        jobs: [{ job: 'Original Music Composer', episode_count: episodes }],
      })),
      { id: 4, name: 'Music I', jobs: [{ job: 'Music', episode_count: 100 }] },
    ]);
    assert.deepEqual(
      found.map((c) => c.name),
      ['Music I', 'Score 3', 'Score 2']
    );
  });

  it('names each person once, with their photo', () => {
    const found = composersFrom([
      { id: 4, name: 'G', job: 'Music', profile_path: '/g.jpg' },
      {
        id: 4,
        name: 'G',
        job: 'Original Music Composer',
        profile_path: '/g.jpg',
      },
      { id: 5, name: 'H', job: 'Music', profile_path: null },
    ]);
    assert.deepEqual(found, [
      { tmdbId: 4, name: 'G', profilePath: '/g.jpg' },
      { tmdbId: 5, name: 'H' },
    ]);
  });
});
