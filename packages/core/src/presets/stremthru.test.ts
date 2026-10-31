import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import '../index.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';
import { stremthruSpecialCases, StremThruPreset } from './stremthru.js';
import { StreamFusionPreset } from './streamfusion.js';
import { getServiceCredential } from '../main/serviceWrapper.js';
import { constants } from '../utils/index.js';

before(async () => {
  mock.method(SettingsRepository, 'getAll', async () => []);
  mock.method(SettingsRepository, 'getVersion', async () => 0);
  await settingsStore.initialise();
});

describe('Offcloud and PikPak StremThru credentials', () => {
  it('marks Offcloud email and password as optional in SERVICE_DETAILS while keeping apiKey required', () => {
    const offcloud = constants.SERVICE_DETAILS[constants.OFFCLOUD_SERVICE];
    const apiKeyField = offcloud.credentials.find((c) => c.id === 'apiKey');
    const emailField = offcloud.credentials.find((c) => c.id === 'email');
    const passwordField = offcloud.credentials.find((c) => c.id === 'password');

    assert.equal(apiKeyField?.required, true);
    assert.equal(emailField?.required, false);
    assert.equal(passwordField?.required, false);
  });

  it('uses apiKey for Offcloud in StremThru and Builtin presets instead of email:password', () => {
    assert.equal(stremthruSpecialCases[constants.OFFCLOUD_SERVICE], undefined);

    const userData = {
      services: [
        {
          id: constants.OFFCLOUD_SERVICE,
          enabled: true,
          credentials: {
            apiKey: 'oc-secret-api-key',
          },
        },
      ],
    } as any;

    const cred = (StremThruPreset as any).getServiceCredential(
      constants.OFFCLOUD_SERVICE,
      userData,
      stremthruSpecialCases
    );
    assert.equal(cred, 'oc-secret-api-key');
  });

  it('formats PikPak credentials as email:password in serviceWrapper and stremthruSpecialCases', () => {
    assert.equal(
      getServiceCredential({
        id: constants.OFFCLOUD_SERVICE,
        credentials: { apiKey: 'oc-key' },
      }),
      'oc-key'
    );
    assert.equal(
      getServiceCredential({
        id: constants.PIKPAK_SERVICE,
        credentials: { email: 'user@example.com', password: 'secret' },
      }),
      'user@example.com:secret'
    );
    assert.equal(
      getServiceCredential({
        id: constants.PIKPAK_SERVICE,
        credentials: {},
      }),
      undefined
    );
  });

  it('validates Offcloud email and password when used with StreamFusion', async () => {
    const userDataMissingEmail = {
      services: [
        {
          id: constants.OFFCLOUD_SERVICE,
          enabled: true,
          credentials: { apiKey: 'oc-key' },
        },
      ],
    } as any;

    await assert.rejects(
      () =>
        StreamFusionPreset.generateAddons(userDataMissingEmail, {
          streamFusionApiKey: 'sf-key',
        }),
      /Offcloud email and password are required for StreamFusion/
    );
  });
});
