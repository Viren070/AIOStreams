import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanTitle, normaliseTitle } from './utils.js';

describe('cleanTitle word boundaries', () => {
  for (const separator of ['/', '\\', '|', '_', '-', ':', ';', '.']) {
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

  for (const [title, expected] of [
    ['K.C. Undercover', 'k c undercover'],
    ['K.C Undercover', 'k c undercover'],
    ['K C Undercover', 'k c undercover'],
    ['S.W.A.T.', 's w a t'],
    ['SWAT', 'swat'],
    ['Mr. Robot', 'mr robot'],
    ['Dr. House', 'dr house'],
    ['2.0', '2 0'],
    ['Word...Word', 'word word'],
    ['Mike&Molly', 'mike molly'],
    ['Mike & Molly', 'mike molly'],
    ['Law&Order', 'law order'],
    ['Law & Order', 'law order'],
    ['Law and Order', 'law and order'],
  ]) {
    it(`cleans ${JSON.stringify(title)} for text search`, () => {
      assert.equal(cleanTitle(title), expected);
    });
  }
});

describe('ampersand matching remains independent of search cleaning', () => {
  it('keeps ampersand and spelled-out titles equivalent for title matching', () => {
    assert.equal(
      normaliseTitle('Law & Order'),
      normaliseTitle('Law and Order')
    );
    assert.equal(normaliseTitle('Law&Order'), normaliseTitle('Law and Order'));
  });
});

describe('additional search separators', () => {
  for (const separator of '‐‑–—,…：；／＼｜＿．') {
    it(`preserves boundaries around ${JSON.stringify(separator)}`, () => {
      assert.equal(cleanTitle(`Word${separator}Word`), 'word word');
    });
  }

  it('collapses adjacent separator variants and whitespace', () => {
    assert.equal(cleanTitle('  Word—…,Word／＿Word  '), 'word word word');
  });

  for (const [title, expected] of [
    ['(Un)Well', 'unwell'],
    ["Don't", 'dont'],
    ['Don’t', 'dont'],
    ['M*A*S*H', 'mash'],
    ['mother!', 'mother'],
  ]) {
    it(`preserves existing treatment of ${JSON.stringify(title)}`, () => {
      assert.equal(cleanTitle(title), expected);
    });
  }
});
