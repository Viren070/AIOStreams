import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Load the core entry point first; config.ts and the services import each other.
import '../index.js';
import { validateOption, type Option } from './config.js';
import { encryptString } from './crypto.js';

// getEnvironmentServiceDetails() hands DEFAULT_SERVICE_CREDENTIALS and
// FORCED_SERVICE_CREDENTIALS values to the config encrypted, whatever the
// credential's type.
const encrypted = (value: string) => encryptString(value).data!;
const url = 'http://altmount:8080';

const option = (type: 'string' | 'password' | 'url', extra = {}): Option =>
  ({ id: 'url', name: 'URL', type, required: true, ...extra }) as Option;

describe('validateOption', () => {
  for (const type of ['string', 'password', 'url'] as const) {
    it(`decrypts an encrypted default in a ${type} option`, () => {
      assert.equal(validateOption(option(type), encrypted(url), true), url);
    });

    it(`decrypts an encrypted forced value in a ${type} option`, () => {
      const forced = option(type, { forced: encrypted(url) });
      assert.equal(validateOption(forced, 'http://other', true), url);
    });

    it(`keeps a ${type} value encrypted when not asked to decrypt`, () => {
      const value = encrypted(url);
      assert.equal(validateOption(option(type), value, false), value);
    });
  }

  it('leaves plain values alone', () => {
    assert.equal(validateOption(option('string'), url, true), url);
  });

  it('rejects an encrypted value it cannot decrypt', () => {
    const wrongKey = encryptString(url, Buffer.alloc(32, 1)).data!;
    assert.throws(() => validateOption(option('string'), wrongKey, true));
  });
});
