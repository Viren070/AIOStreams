import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerLockErrorClass,
  resolveErrorCtor,
  flattenError,
  stringifyLockResult,
  parseLockResult,
} from './distributed-lock.js';

class TestDebridError extends Error {
  code: string;
  type: string;
  statusCode: number;
  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.code = code;
    this.type = 'api_error';
    this.statusCode = statusCode;
  }
}
registerLockErrorClass(TestDebridError);

class UnregisteredError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'UnregisteredError';
  }
}

describe('distributed-lock error serialization', () => {
  test('a registered class survives a value-shaped round-trip with prototype, message, and fields intact', () => {
    const err = new TestDebridError(
      'ACTIVE_LIMIT: too many downloads',
      'STORE_LIMIT_EXCEEDED',
      500
    );
    const wire = stringifyLockResult({
      value: { error: err, failedOver: true },
    });
    const revived = parseLockResult<{
      value: { error: Error; failedOver: boolean };
    }>(wire);

    assert.ok(revived.value.error instanceof TestDebridError);
    assert.equal(
      revived.value.error.message,
      'ACTIVE_LIMIT: too many downloads'
    );
    assert.equal(
      (revived.value.error as TestDebridError).code,
      'STORE_LIMIT_EXCEEDED'
    );
    assert.equal((revived.value.error as TestDebridError).statusCode, 500);
    assert.equal(revived.value.failedOver, true);
  });

  test('a registered class survives a thrown-error round-trip too', () => {
    const err = new TestDebridError('rate limited', 'TOO_MANY_REQUESTS', 429);
    const wire = stringifyLockResult({ error: err });
    const revived = parseLockResult<{ error: Error }>(wire);

    assert.ok(revived.error instanceof TestDebridError);
    assert.equal(revived.error.message, 'rate limited');
    assert.equal((revived.error as TestDebridError).code, 'TOO_MANY_REQUESTS');
  });

  test('an unregistered class loses its exact prototype but keeps its data', () => {
    const err = new UnregisteredError('boom', 'X1');
    const wire = stringifyLockResult({ error: err });
    const revived = parseLockResult<{ error: Error }>(wire);

    assert.equal(revived.error instanceof UnregisteredError, false);
    assert.ok(revived.error instanceof Error);
    assert.equal(revived.error.message, 'boom');
    assert.equal((revived.error as any).code, 'X1');
  });

  test('native Error subclasses resolve via globalThis with zero registration', () => {
    const err = new TypeError('bad argument');
    const wire = stringifyLockResult({ error: err });
    const revived = parseLockResult<{ error: Error }>(wire);

    assert.ok(revived.error instanceof TypeError);
    assert.equal(revived.error.message, 'bad argument');
  });

  test('a native class with a getter-only `name` (e.g. DOMException) round-trips without throwing', () => {
    const err = new DOMException('The operation was aborted', 'TimeoutError');
    const wire = stringifyLockResult({ error: err });
    const revived = parseLockResult<{ error: Error }>(wire);

    assert.ok(revived.error instanceof DOMException);
    assert.equal(revived.error.name, 'TimeoutError');
    assert.equal(revived.error.message, 'The operation was aborted');
  });

  test('resolveErrorCtor resolves registered, native, and unresolvable names', () => {
    assert.equal(resolveErrorCtor('TestDebridError'), TestDebridError);
    assert.equal(resolveErrorCtor('TypeError'), TypeError);
    assert.equal(resolveErrorCtor('SomeClassThatDoesNotExist'), undefined);
    assert.equal(resolveErrorCtor(undefined), undefined);
    // a global non-Error function must never be mistaken for one
    assert.equal(resolveErrorCtor('Array'), undefined);
  });

  test('a circular `cause` is dropped, never reaching the wire, and the rest of the error still round-trips', () => {
    const circular: any = {};
    circular.self = circular;
    const err = new TestDebridError('with circular cause', 'UNKNOWN', 500);
    (err as any).cause = circular;

    const flat = flattenError(err);
    assert.equal('cause' in flat, false);

    const wire = stringifyLockResult({ error: err });
    const revived = parseLockResult<{ error: Error }>(wire);
    assert.ok(revived.error instanceof TestDebridError);
    assert.equal(revived.error.message, 'with circular cause');
    assert.equal((revived.error as any).cause, undefined);
  });

  test('an error field named like a protocol key cannot clobber it', () => {
    const err = new TestDebridError('collision', 'UNKNOWN', 500);
    (err as any).__lockError = false;
    (err as any).className = 'not-the-real-class-name';

    const wire = stringifyLockResult({ error: err });
    const revived = parseLockResult<{ error: Error }>(wire);
    assert.ok(revived.error instanceof TestDebridError);
    assert.equal(revived.error.message, 'collision');
  });

  test('a circular field elsewhere (e.g. body) falls back to a minimal error instead of throwing', () => {
    const circular: any = {};
    circular.self = circular;
    const err = new TestDebridError('with circular body', 'UNKNOWN', 500);
    (err as any).body = circular;

    const wire = stringifyLockResult({ error: err });
    assert.doesNotThrow(() => JSON.parse(wire));

    const revived = parseLockResult<{ error: Error }>(wire);
    assert.ok(revived.error instanceof Error);
    assert.equal(revived.error.message, 'Unserializable lock result');
  });

  test('plain, error-free values round-trip unchanged', () => {
    const value = {
      url: 'https://example.com/stream',
      failedOver: false,
      label: 'A',
    };
    const wire = stringifyLockResult({ value });
    const revived = parseLockResult<{ value: typeof value }>(wire);
    assert.deepEqual(revived.value, value);
  });
});
