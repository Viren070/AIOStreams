import { before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// Imported dynamically: preset metadata reads settings, which must be loaded first.
const { settingsStore } = await import('../config/index.js');
const { SettingsRepository } = await import('../db/repositories/settings.js');
await import('../index.js');
const { NewznabPreset } = await import('./newznab.js');

before(async () => {
  mock.method(SettingsRepository, 'getAll', async () => []);
  mock.method(SettingsRepository, 'getVersion', async () => 0);
  await settingsStore.initialise();
});

const storedHealthProxy = {
  enabled: true,
  backbones: [],
  providerHosts: '',
  showUnknown: false,
  singleIp: true,
};

function decodeManifestConfig(url: string): Record<string, any> {
  const segment = url.split('/').at(-2)!;
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

describe('newznab health proxy option removed', () => {
  it('is no longer offered', () => {
    const ids = NewznabPreset.METADATA.OPTIONS.map((o: any) => o.id);
    assert.ok(!ids.includes('zyclopsHealthProxy'));
  });

  it('builds a manifest from a stored enabled-but-incomplete option without throwing', () => {
    // Configs saved with the option enabled keep the value. It must be ignored:
    // this used to throw "requires either a Backbone selection or a Provider Host".
    const url = (NewznabPreset as any).generateManifestUrl({} as any, [], {
      api: { url: 'https://indexer.example/api', apiKey: 'k' },
      zyclopsHealthProxy: storedHealthProxy,
    });
    const config = decodeManifestConfig(url);
    assert.equal(config.url, 'https://indexer.example/api');
    assert.ok(!('zyclopsHealthProxy' in config));
  });
});
