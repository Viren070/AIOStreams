import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), ban: vi.fn() }));
vi.mock('../utils/index.js', () => ({ appConfig: { streams: { connectionLimits: { '*': 1 }, sessionIdleTimeout: 60 } } }));
vi.mock('../config/schema/streams.js', () => ({ PER_USER_LIMIT_KEY: '*', GLOBAL_LIMIT_KEY: '**' }));
vi.mock('../logging/logger.js', () => ({ createLogger: () => mocks }));
vi.mock('../db/repositories/stream-sessions.js', () => ({ StreamSessionRepository: {} }));
vi.mock('./bans.js', () => ({ findStreamBan: mocks.ban, refreshStreamBans: vi.fn() }));
vi.mock('./bandwidth.js', () => ({ bandwidthSnapshot: () => ({ byUser: new Map(), global: 0 }), globalBandwidthLimit: () => 0, userBandwidthLimit: () => 0, refreshBandwidthUsage: vi.fn() }));
vi.mock('./instance-id.js', () => ({ instanceId: () => 'fixture-instance' }));
vi.mock('./client-ip.js', () => ({ recordedClientIp: () => undefined }));
import { StreamRegistry } from './registry.js';
const input = { username: 'fixture-user', transport: 'proxy' as const, targetKey: 'secret-target', clientIp: '192.0.2.42', displayUrl: 'https://secret-capability', filename: 'secret-title' };

describe('structured admission logging', () => {
  it('records denied new targets without leaking capabilities; seeks still join', () => {
    mocks.warn.mockClear();
    const registry = new StreamRegistry();
    const initial = registry.open(input, 1000);
    expect(initial.ok).toBe(true);
    expect(registry.open(input, 1100).ok).toBe(true);
    expect(mocks.warn).not.toHaveBeenCalled();
    const denied = registry.open({ ...input, targetKey: 'another-secret-target' }, 1200);
    expect(denied).toMatchObject({ ok: false, verdict: { reason: 'connection_user' } });
    const fields = mocks.warn.mock.calls[0][0];
    expect(fields).toMatchObject({ event: 'playback_admission_refused', phase: 'create', active_sessions: 1, instance_id: 'fixture-instance', reason: 'connection_user' });
    expect(JSON.stringify(fields)).not.toMatch(/secret|192\.0\.2/);
  });
  it('ties a denied resume to its existing session and preserves the verdict', () => {
    mocks.warn.mockClear();
    const registry = new StreamRegistry();
    const opened = registry.open(input, 1000);
    if (!opened.ok) throw new Error('fixture failed');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    opened.handle.close();
    clock.mockRestore();
    expect(registry.open({ ...input, targetKey: 'other-target' }, 2000).ok).toBe(true);
    const denied = registry.open(input, 12000);
    expect(denied).toMatchObject({ ok: false, verdict: { reason: 'connection_user' } });
    expect(mocks.warn.mock.calls[0][0]).toMatchObject({ phase: 'resume', session_id: opened.handle.sessionId, active_sessions: 1 });
  });
});
