import assert from 'node:assert/strict';
import test from 'node:test';
import {
  providerBackupTier,
  providerSetFingerprint,
  type ProviderConfig,
} from './types.js';

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider',
    host: 'news.example.test',
    port: 563,
    tls: true,
    maxConnections: 4,
    priority: 1,
    ...patch,
  };
}

test('maps legacy backup accounts to emergency tier 1', () => {
  assert.equal(providerBackupTier(provider()), 0);
  assert.equal(providerBackupTier(provider({ isBackup: true })), 1);
});

test('numeric emergency tiers override the legacy backup flag', () => {
  assert.equal(providerBackupTier(provider({ backupTier: 3 })), 3);
  assert.equal(
    providerBackupTier(provider({ backupTier: 0, isBackup: true })),
    0
  );
});

test('provider fingerprint changes when the emergency tier changes', () => {
  const secret = 'test-secret';
  assert.notEqual(
    providerSetFingerprint([provider({ backupTier: 1 })], secret),
    providerSetFingerprint([provider({ backupTier: 2 })], secret)
  );
});
