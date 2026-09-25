import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Headers } from 'undici';
import { parseRetryAfter, RateLimitedError, rateLimitKey } from './http.js';

describe('parseRetryAfter', () => {
  test('parses delay-seconds', () => {
    assert.equal(parseRetryAfter('120'), 120);
  });

  test('parses an HTTP-date', () => {
    const future = new Date(Date.now() + 60000);
    const seconds = parseRetryAfter(future.toUTCString());
    assert.ok(seconds !== undefined && seconds > 55 && seconds <= 60);
  });

  test('returns undefined for missing or invalid values', () => {
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter(''), undefined);
    assert.equal(parseRetryAfter('not a date'), undefined);
  });

  test('rejects non-standard delay-seconds values', () => {
    assert.equal(parseRetryAfter('1e6'), undefined);
    assert.equal(parseRetryAfter('0x10'), undefined);
    assert.equal(parseRetryAfter('1.5'), undefined);
    assert.equal(parseRetryAfter('-1'), undefined);
    assert.equal(parseRetryAfter('+1'), undefined);
  });
});

describe('RateLimitedError', () => {
  test('formats a human-readable retry-after duration', () => {
    const error = new RateLimitedError(90);
    assert.equal(error.name, 'RateLimitedError');
    assert.equal(error.message, 'Too Many Requests (retry after 1m 30s)');
  });
});

describe('rateLimitKey', () => {
  const key = (url: string, headers: Record<string, string> = {}) =>
    rateLimitKey(new URL(url), new Headers(headers), '');

  test('shares the key across searches with the same API key', () => {
    assert.equal(
      key('https://indexer.test/api?t=search&q=a&apikey=one'),
      key('https://indexer.test/api?t=search&q=b&apikey=one')
    );
  });

  test('separates different API keys in query, header and userinfo', () => {
    assert.notEqual(
      key('https://indexer.test/api?apikey=one'),
      key('https://indexer.test/api?apikey=two')
    );
    assert.notEqual(
      key('https://indexer.test/api', { 'X-Api-Key': 'one' }),
      key('https://indexer.test/api', { 'X-Api-Key': 'two' })
    );
    assert.notEqual(
      key('https://one:pass@indexer.test/api'),
      key('https://two:pass@indexer.test/api')
    );
  });

  test('separates egresses', () => {
    const url = new URL('https://indexer.test/api');
    assert.notEqual(
      rateLimitKey(url, new Headers(), '0'),
      rateLimitKey(url, new Headers(), '1')
    );
  });
});
