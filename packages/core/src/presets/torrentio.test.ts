import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Use the normal core entry point to initialise the preset's dependency graph.
import '../index.js';
import type { ParsedStream, UserData } from '../db/index.js';
import type { ServiceId } from '../utils/index.js';
import { TorrentioParser, TorrentioPreset } from './torrentio.js';

const parser = Object.create(TorrentioParser.prototype) as {
  parseServiceData: (name: string) => ParsedStream['service'] | undefined;
};

const preset = TorrentioPreset as unknown as {
  generateManifestUrl: (
    userData: UserData,
    services: ServiceId[],
    options: Record<string, any>
  ) => string;
};

const userData = {
  services: [
    { id: 'highway', enabled: true, credentials: { apiKey: 'hw-token' } },
  ],
} as unknown as UserData;

describe('Torrentio HighWay support', () => {
  it('detects cached HighWay streams', () => {
    assert.deepEqual(parser.parseServiceData('[HW+] Torrentio\n1080p'), {
      id: 'highway',
      cached: true,
    });
  });

  it('detects uncached HighWay streams', () => {
    assert.deepEqual(
      parser.parseServiceData('[HW download] Torrentio\n1080p'),
      { id: 'highway', cached: false }
    );
  });

  it('adds the HighWay token to the manifest URL', () => {
    assert.equal(
      preset.generateManifestUrl(userData, ['highway'], {
        url: 'https://torrentio.strem.fun',
      }),
      'https://torrentio.strem.fun/highway%3Dhw-token/manifest.json'
    );
  });
});
