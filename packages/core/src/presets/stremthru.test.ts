import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { constants } from '../utils/index.js';
import { stremthruSpecialCases } from './stremthru.js';

describe('StremThru Offcloud credentials', () => {
  it('uses the API key instead of the legacy email and password pair', () => {
    assert.equal(
      stremthruSpecialCases[constants.OFFCLOUD_SERVICE],
      undefined
    );
  });

  it('keeps only the API key required for the Offcloud service', () => {
    const credentials =
      constants.SERVICE_DETAILS[constants.OFFCLOUD_SERVICE].credentials;
    const required = Object.fromEntries(
      credentials.map(({ id, required }) => [id, required])
    );

    assert.deepEqual(required, {
      apiKey: true,
      email: false,
      password: false,
    });
  });
});
