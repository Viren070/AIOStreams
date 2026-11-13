import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { constants } from '../utils/index.js';
import { getServiceCredential } from './serviceWrapper.js';

describe('getServiceCredential', () => {
  it('encodes PikPak credentials for StremThru basic auth', () => {
    assert.equal(
      getServiceCredential({
        id: constants.PIKPAK_SERVICE,
        credentials: {
          email: 'user@example.com',
          password: 'secret:with:colons',
        },
      }),
      'user@example.com:secret:with:colons'
    );
  });

  it('encodes Offcloud credentials for StremThru basic auth', () => {
    assert.equal(
      getServiceCredential({
        id: constants.OFFCLOUD_SERVICE,
        credentials: {
          email: 'user@example.com',
          password: 'secret:with:colons',
        },
      }),
      'user@example.com:secret:with:colons'
    );
  });

  it('skips incomplete email/password credentials', () => {
    assert.equal(
      getServiceCredential({
        id: constants.PIKPAK_SERVICE,
        credentials: { email: 'user@example.com', apiKey: 'legacy' },
      }),
      undefined
    );
    assert.equal(
      getServiceCredential({
        id: constants.OFFCLOUD_SERVICE,
        credentials: { password: 'secret' },
      }),
      undefined
    );
  });
});
