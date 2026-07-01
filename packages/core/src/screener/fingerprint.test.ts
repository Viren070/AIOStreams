import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFingerprint,
  isValidFingerprint,
  toUnixSeconds,
} from './fingerprint.js';

// Golden vectors are the faithful output of nzbdavex's WardenFingerprint.Compute
// for the same inputs. If these change, aiostreams lists stop interchanging with
// nzbdavex, treat any diff as a wire-compat break, not a test to "fix".
const SIZE = 1073741824; // 1 GiB
const POSTER = 'a@b.com';
const DATE = 1719705600; // 2024-06-30 00:00:00 UTC

describe('computeFingerprint (davex wd1 wire-compat)', () => {
  it('matches the golden vector for size+poster+date', () => {
    assert.equal(
      computeFingerprint(SIZE, POSTER, DATE),
      'wd1:fbaefac71441d3539764427a8111b8c7'
    );
  });

  it('normalises poster case and surrounding whitespace', () => {
    assert.equal(
      computeFingerprint(SIZE, '  A@B.COM  ', DATE),
      'wd1:fbaefac71441d3539764427a8111b8c7'
    );
  });

  it('matches the golden vector with date only (no poster)', () => {
    assert.equal(
      computeFingerprint(SIZE, null, DATE),
      'wd1:0503cb01e09543055e408e9060dfd1ea'
    );
    assert.equal(computeFingerprint(SIZE, '   ', DATE), 'wd1:0503cb01e09543055e408e9060dfd1ea');
  });

  it('matches the golden vector with poster only (no date)', () => {
    assert.equal(
      computeFingerprint(SIZE, POSTER, null),
      'wd1:d18312f44c157e5c69f656a234986e23'
    );
  });

  it('buckets the posting date to the day', () => {
    const base = computeFingerprint(SIZE, POSTER, DATE);
    assert.equal(computeFingerprint(SIZE, POSTER, DATE + 86399), base);
    assert.notEqual(computeFingerprint(SIZE, POSTER, DATE + 86400), base);
  });

  it('returns null for non-identifying inputs', () => {
    assert.equal(computeFingerprint(0, POSTER, DATE), null);
    assert.equal(computeFingerprint(-1, POSTER, DATE), null);
    assert.equal(computeFingerprint(SIZE, null, null), null);
    assert.equal(computeFingerprint(SIZE, '  ', null), null);
    assert.equal(computeFingerprint(Number.NaN, POSTER, DATE), null);
  });

  it('produces a syntactically valid fingerprint', () => {
    assert.ok(isValidFingerprint(computeFingerprint(SIZE, POSTER, DATE)));
    assert.ok(!isValidFingerprint('wd1:nothex'));
    assert.ok(!isValidFingerprint('xx1:fbaefac71441d3539764427a8111b8c7'));
    assert.ok(!isValidFingerprint(null));
  });
});

describe('toUnixSeconds', () => {
  it('passes through epoch seconds', () => {
    assert.equal(toUnixSeconds(DATE), DATE);
  });

  it('downscales epoch milliseconds', () => {
    assert.equal(toUnixSeconds(DATE * 1000), DATE);
  });

  it('parses an RFC-822 / ISO date string to the same bucket', () => {
    const iso = toUnixSeconds('2024-06-30T00:00:00Z');
    assert.equal(iso, DATE);
    // A feed reporting a string and one reporting seconds agree on the fp.
    assert.equal(
      computeFingerprint(SIZE, POSTER, iso),
      computeFingerprint(SIZE, POSTER, DATE)
    );
  });

  it('accepts ISO date-only and rejects host-dependent date strings', () => {
    // ISO date-only parses as UTC midnight on every host, so it shares the bucket.
    assert.equal(toUnixSeconds('2024-06-30'), DATE);
    // A zoneless time or a non-ISO date is locale-dependent; reject it to keep
    // the wd1 bucket deterministic across servers.
    assert.equal(toUnixSeconds('2024-06-30T00:00:00'), null);
    assert.equal(toUnixSeconds('06/30/2024'), null);
  });

  it('returns null for junk', () => {
    assert.equal(toUnixSeconds(''), null);
    assert.equal(toUnixSeconds('not a date'), null);
    assert.equal(toUnixSeconds(null), null);
    assert.equal(toUnixSeconds(undefined), null);
  });
});
