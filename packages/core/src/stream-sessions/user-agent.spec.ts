import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upsertMany: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('../utils/index.js', () => ({ appConfig: { streams: { connectionLimits: {}, sessionIdleTimeout: 60 } } }));
vi.mock('../config/schema/streams.js', () => ({ PER_USER_LIMIT_KEY: '*', GLOBAL_LIMIT_KEY: '**' }));
vi.mock('../logging/logger.js', () => ({ createLogger: () => mocks }));
vi.mock('../db/repositories/stream-sessions.js', () => ({ StreamSessionRepository: { addBandwidth: vi.fn(), upsertMany: mocks.upsertMany, pendingStops: async () => [] } }));
vi.mock('./bans.js', () => ({ findStreamBan: () => undefined, refreshStreamBans: vi.fn() }));
vi.mock('./bandwidth.js', () => ({ bandwidthSnapshot: () => ({ byUser: new Map(), global: 0 }), globalBandwidthLimit: () => 0, userBandwidthLimit: () => 0, refreshBandwidthUsage: vi.fn() }));
vi.mock('./instance-id.js', () => ({ instanceId: () => 'fixture-instance' }));
vi.mock('./client-ip.js', () => ({ recordedClientIp: () => undefined }));
import { StreamRegistry, boundedUserAgent } from './registry.js';
const input = { username: 'fixture-user', transport: 'proxy' as const, targetKey: 'target', clientIp: '192.0.2.42' };

describe('playback client attribution', () => {
  it('keeps the opening request user agent on the live session only', async () => {
    mocks.upsertMany.mockClear();
    const registry = new StreamRegistry();
    expect(registry.open({ ...input, userAgent: 'Stremio/1.0 (webOS)' }, 1000).ok).toBe(true);
    expect(registry.open({ ...input, userAgent: 'other-client' }, 1100).ok).toBe(true);
    expect(registry.snapshot(1200)[0].userAgent).toBe('Stremio/1.0 (webOS)');
    await registry.flush(1300);
    expect(JSON.stringify(mocks.upsertMany.mock.calls)).not.toMatch(/Stremio|userAgent/);
  });
  it('fills a session opened without a user agent from a later read', () => {
    const registry = new StreamRegistry();
    registry.open(input, 1000);
    registry.open({ ...input, userAgent: 'ExoPlayer' }, 1100);
    expect(registry.snapshot(1200)[0].userAgent).toBe('ExoPlayer');
  });
  it('bounds client-controlled values', () => {
    expect(boundedUserAgent(' a\u0000b\nc ')).toBe('abc');
    expect(boundedUserAgent('x'.repeat(1000))).toHaveLength(256);
    expect(boundedUserAgent('\u0007 ')).toBeUndefined();
    expect(boundedUserAgent(undefined)).toBeUndefined();
  });
});
