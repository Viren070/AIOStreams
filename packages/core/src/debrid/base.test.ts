import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  raceTimeout,
  DebridError,
  isAbortTimeoutError,
  timeoutError,
} from './base.js';

describe('raceTimeout', () => {
  test('rejects with a DebridError (TIMEOUT, 408) when the wrapped promise is slow', async () => {
    const slow = new Promise((resolve) =>
      setTimeout(() => resolve('late'), 50)
    );

    await assert.rejects(raceTimeout(slow, 10), (err: unknown) => {
      assert.ok(err instanceof DebridError);
      assert.equal(err.statusCode, 408);
      assert.equal(err.code, 'TIMEOUT');
      return true;
    });
  });

  test('resolves normally when the promise settles before the timeout', async () => {
    const fast = Promise.resolve('ok');
    assert.equal(await raceTimeout(fast, 50), 'ok');
  });
});

describe('isAbortTimeoutError', () => {
  test('true for AbortSignal.timeout()-style DOMException', () => {
    const err = new DOMException('timed out', 'TimeoutError');
    assert.equal(isAbortTimeoutError(err), true);
  });

  test('true for a manually aborted AbortController', () => {
    const err = new DOMException('aborted', 'AbortError');
    assert.equal(isAbortTimeoutError(err), true);
  });

  test('true for an already-wrapped DebridError with code TIMEOUT', () => {
    assert.equal(isAbortTimeoutError(timeoutError('slow')), true);
  });

  test('false for a DebridError with a different code', () => {
    const err = new DebridError('not found', {
      statusCode: 404,
      statusText: 'Not Found',
      code: 'NOT_FOUND',
      headers: {},
      body: null,
      type: 'api_error',
    });
    assert.equal(isAbortTimeoutError(err), false);
  });

  test('false for an unrelated error', () => {
    assert.equal(isAbortTimeoutError(new Error('boom')), false);
  });
});
