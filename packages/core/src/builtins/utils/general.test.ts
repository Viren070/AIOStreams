import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../../utils/index.js';
import { ageInHoursSince } from './general.js';

describe('ageInHoursSince', () => {
  it('rounds up to the next full hour', () => {
    const date = new Date(Date.now() - 47.5 * 60 * 60 * 1000).toISOString();
    assert.equal(ageInHoursSince(date), 48);
  });

  it('returns undefined for an unparsable date', () => {
    assert.equal(ageInHoursSince('not-a-date'), undefined);
  });

  it('returns undefined for a date in the future', () => {
    const date = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    assert.equal(ageInHoursSince(date), undefined);
  });
});
