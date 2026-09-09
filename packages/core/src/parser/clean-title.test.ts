import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanTitle } from './utils.js';

describe('cleanTitle word boundaries', () => {
  for (const separator of ['/', '\\', '|', '_', '-', ':', ';']) {
    it(`preserves words separated by ${JSON.stringify(separator)}`, () => {
      assert.equal(cleanTitle(`Word${separator}Word`), 'word word');
    });
  }
  it('collapses mixed repeated separators without joining words', () => {
    assert.equal(cleanTitle('  Word/_|\\Word  '), 'word word');
  });
  it('preserves ordinary title cleaning', () => {
    assert.equal(cleanTitle("The Show's Title!"), 'the shows title');
  });
});
