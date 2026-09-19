import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IdParser } from '../../utils/id-parser.js';
import { isItemMatch } from './matching.js';

describe('library matching with dotted metadata titles', () => {
  const requested = IdParser.parse('tt6111130:2:4', 'series')!;

  it('keeps joined acronyms matching dotted metadata', () => {
    assert.equal(
      isItemMatch(
        'SWAT.S02E04.1080p.WEB-DL.mkv',
        {
          titles: ['S.W.A.T.'],
        },
        requested
      ),
      true
    );
  });

  it('keeps joined and spaced K.C. Undercover releases matching', () => {
    const kcRequested = IdParser.parse('tt3598030:2:4', 'series')!;
    for (const title of ['KC', 'K.C']) {
      assert.equal(
        isItemMatch(
          `${title}.Undercover.S02E04.1080p.WEB-DL.mkv`,
          {
            titles: ['K.C. Undercover'],
          },
          kcRequested
        ),
        true
      );
    }
  });

  it('still rejects a different episode of a matching acronym title', () => {
    assert.equal(
      isItemMatch(
        'SWAT.S02E05.1080p.WEB-DL.mkv',
        {
          titles: ['S.W.A.T.'],
        },
        requested
      ),
      false
    );
  });

  it('still rejects an unrelated title with the requested episode', () => {
    assert.equal(
      isItemMatch(
        'Friends.S02E04.1080p.WEB-DL.mkv',
        {
          titles: ['S.W.A.T.'],
        },
        requested
      ),
      false
    );
  });
});

describe('library matching with ampersands', () => {
  const requested = IdParser.parse('tt0098844:1:4', 'series')!;

  for (const metadataTitle of ['Law & Order', 'Law&Order', 'Law and Order']) {
    it(`matches spelled-out releases against ${metadataTitle}`, () => {
      assert.equal(
        isItemMatch(
          'Law.and.Order.S01E04.1080p.WEB-DL.mkv',
          {
            titles: [metadataTitle],
          },
          requested
        ),
        true
      );
    });
  }

  it('matches ampersand releases against spelled-out metadata', () => {
    assert.equal(
      isItemMatch(
        'Law & Order S01E04 1080p WEB-DL.mkv',
        {
          titles: ['Law and Order'],
        },
        requested
      ),
      true
    );
  });

  it('still rejects the wrong episode', () => {
    assert.equal(
      isItemMatch(
        'Law.and.Order.S01E05.1080p.WEB-DL.mkv',
        {
          titles: ['Law & Order'],
        },
        requested
      ),
      false
    );
  });
});

describe('library compatibility for additional search separators', () => {
  const requested = IdParser.parse('tt6111130:2:4', 'series')!;
  for (const separator of '‐‑–—,…：；／＼｜＿．') {
    it(`keeps existing joined-title matches for ${JSON.stringify(separator)}`, () => {
      assert.equal(
        isItemMatch(
          'SWAT.S02E04.1080p.WEB-DL.mkv',
          {
            titles: [`S${separator}W${separator}A${separator}T`],
          },
          requested
        ),
        true
      );
    });
  }
});
