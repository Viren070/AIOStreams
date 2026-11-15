import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rewatchNextIndex } from './rewatch.js';

/** An episode played at `at` (a day number), or never played. */
const ep = (at?: number, aired = true) => ({
  played: at !== undefined,
  aired,
  lastPlayedAt: at ?? null,
});

describe('rewatchNextIndex', () => {
  it('goes on from the episode played last, though the next one was watched before', () => {
    // Watched through to the end on days 1-5, then episodes 1-2 again on days 10-11.
    const show = [ep(10), ep(11), ep(3), ep(4), ep(5)];
    assert.equal(rewatchNextIndex(show), 2);
  });

  it('finds the last play by its date, not by where it sits in the show', () => {
    // An import can give every row of a show one timestamp; the dates still differ.
    const show = [ep(1), ep(20), ep(3), ep(4), ep(5), ep(6)];
    assert.equal(rewatchNextIndex(show), 2);
  });

  it('offers an episode the first watch skipped', () => {
    const show = [ep(10), ep(11), ep(), ep(4)];
    assert.equal(rewatchNextIndex(show), 2);
  });

  it('passes over episodes that have not aired', () => {
    const show = [ep(10), ep(11), ep(undefined, false), ep(4)];
    assert.equal(rewatchNextIndex(show), 3);
  });

  it('leaves a show watched in order to the usual Next Up', () => {
    assert.equal(rewatchNextIndex([ep(1), ep(2), ep(3), ep()]), -1);
    assert.equal(rewatchNextIndex([ep(1), ep(2), ep(3)]), -1);
  });

  it('takes the furthest episode when plays share a date', () => {
    assert.equal(rewatchNextIndex([ep(5), ep(5), ep(5), ep()]), -1);
  });

  it('needs a dated play to go on from', () => {
    assert.equal(rewatchNextIndex([]), -1);
    assert.equal(rewatchNextIndex([ep(), ep()]), -1);
    const undated = { played: true, aired: true, lastPlayedAt: null };
    assert.equal(rewatchNextIndex([undated, undated, ep()]), -1);
  });
});
