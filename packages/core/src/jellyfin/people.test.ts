import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Load the core entry point first; its modules import each other.
import '../index.js';
import type { TMDBPersonCredit, TMDBPerson } from '../metadata/tmdb.js';
import type { TMDBMetadata } from '../metadata/tmdb.js';
import {
  creditedParts,
  creditSummary,
  personKindOf,
  tmdbCredits,
} from './people.js';

const credit = (
  tmdbId: number,
  parts: TMDBPersonCredit['parts'],
  extra: Partial<TMDBPersonCredit> = {}
): TMDBPersonCredit => ({
  tmdbId,
  mediaType: 'movie',
  title: `Title ${tmdbId}`,
  genreIds: [],
  popularity: tmdbId,
  voteCount: 100,
  roles: parts.flatMap((p) => (p.role ? [p.role] : [])),
  parts,
  ...extra,
});

const person = (
  credits: TMDBPersonCredit[],
  department = 'Directing'
): TMDBPerson => ({ tmdbId: 1, name: 'Someone', department, credits });

describe('personKindOf', () => {
  it('names the kinds title crews are sent as', () => {
    assert.equal(personKindOf('Acting'), 'Actor');
    assert.equal(personKindOf('Directing', 'Director'), 'Director');
    assert.equal(personKindOf('Writing', 'Screenplay'), 'Writer');
    assert.equal(personKindOf('Writing', 'Creator'), 'Writer');
    assert.equal(personKindOf('Sound', 'Original Music Composer'), 'Composer');
    assert.equal(personKindOf('Sound', 'Music'), 'Composer');
    assert.equal(personKindOf('Production', 'Executive Producer'), 'Producer');
    assert.equal(personKindOf('Editing', 'Editor'), 'Editor');
  });

  it('keeps the department where no kind covers the job', () => {
    assert.equal(personKindOf('Directing', 'Assistant Director'), 'Directing');
    assert.equal(personKindOf('Sound', 'Sound Mixer'), 'Sound');
    assert.equal(personKindOf('Production', 'Casting'), 'Production');
    assert.equal(personKindOf('Camera', 'Director of Photography'), 'Camera');
  });
});

describe('creditedParts', () => {
  it('leaves out honorary credits', () => {
    const parts = creditedParts(
      credit(1, [
        { department: 'Writing', role: 'Characters' },
        { department: 'Directing', role: 'Director' },
      ])
    );
    assert.deepEqual(parts, [{ type: 'Director', role: 'Director' }]);
  });

  it('keeps a part in the cast that names no character', () => {
    assert.deepEqual(creditedParts(credit(1, [{ department: 'Acting' }])), [
      { type: 'Actor' },
    ]);
  });
});

describe('tmdbCredits', () => {
  const directed = credit(1, [{ department: 'Directing', role: 'Director' }]);
  const written = credit(2, [{ department: 'Writing', role: 'Screenplay' }]);
  const both = credit(3, [
    { department: 'Directing', role: 'Director' },
    { department: 'Writing', role: 'Writer' },
  ]);
  const acted = credit(4, [{ department: 'Acting', role: 'Himself' }], {
    mediaType: 'tv',
  });
  const thanked = credit(5, [{ department: 'Crew', role: 'Thanks' }]);
  const all = person([directed, written, both, acted, thanked]);
  const ids = (credits: TMDBPersonCredit[]) =>
    credits.map((c) => c.tmdbId).sort();

  it('keeps every kind of work without a filter, leaving out honorary credits', () => {
    assert.deepEqual(ids(tmdbCredits(all)), [1, 2, 3, 4]);
  });

  it('keeps a title for any kind asked for', () => {
    assert.deepEqual(ids(tmdbCredits(all, undefined, ['Director'])), [1, 3]);
    assert.deepEqual(
      ids(tmdbCredits(all, undefined, ['Writer', 'Actor'])),
      [2, 3, 4]
    );
  });

  it('filters by movies and shows as well', () => {
    assert.deepEqual(ids(tmdbCredits(all, ['movie'], ['Actor'])), []);
    assert.deepEqual(ids(tmdbCredits(all, ['series'], ['Actor'])), [4]);
  });
});

describe('creditSummary', () => {
  it('counts each title once per kind, by movies and shows, most first', () => {
    // A tie keeps the order of the better known title, here the show.
    const summary = creditSummary({
      tmdb: {} as TMDBMetadata,
      person: person([
        credit(1, [{ department: 'Directing', role: 'Director' }]),
        credit(2, [
          { department: 'Directing', role: 'Director' },
          { department: 'Writing', role: 'Screenplay' },
          { department: 'Writing', role: 'Story' },
        ]),
        credit(3, [{ department: 'Acting', role: 'Himself' }], {
          mediaType: 'tv',
        }),
      ]),
    });
    assert.deepEqual(summary, {
      credits: [
        { type: 'Director', movies: 2, series: 0 },
        { type: 'Actor', movies: 0, series: 1 },
        { type: 'Writer', movies: 1, series: 0 },
      ],
      knownFor: 'Director',
    });
  });

  it('knows a composer by the Sound department', () => {
    const summary = creditSummary({
      tmdb: {} as TMDBMetadata,
      person: person(
        [credit(1, [{ department: 'Sound', role: 'Original Music Composer' }])],
        'Sound'
      ),
    });
    assert.equal(summary.knownFor, 'Composer');
  });
});
