import { EventEmitter } from 'node:events';
import type { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  upsertMany: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock('../utils/index.js', () => ({
  appConfig: { streams: { connectionLimits: {}, sessionIdleTimeout: 60 } },
}));
vi.mock('../config/schema/streams.js', () => ({
  PER_USER_LIMIT_KEY: '*',
  GLOBAL_LIMIT_KEY: '**',
}));
vi.mock('../logging/logger.js', () => ({ createLogger: () => mocks }));
vi.mock('../db/repositories/stream-sessions.js', () => ({
  StreamSessionRepository: {
    addBandwidth: vi.fn(),
    upsertMany: mocks.upsertMany,
    pendingStops: async () => [],
  },
}));
vi.mock('./bans.js', () => ({
  findStreamBan: () => undefined,
  refreshStreamBans: vi.fn(),
}));
vi.mock('./bandwidth.js', () => ({
  bandwidthSnapshot: () => ({ byUser: new Map(), global: 0 }),
  globalBandwidthLimit: () => 0,
  userBandwidthLimit: () => 0,
  refreshBandwidthUsage: vi.fn(),
}));
vi.mock('./instance-id.js', () => ({ instanceId: () => 'fixture-instance' }));
vi.mock('./client-ip.js', () => ({ recordedClientIp: () => undefined }));
import { StreamRegistry } from './registry.js';
import type { StreamHandle } from './types.js';

const input = {
  username: 'fixture-user',
  transport: 'proxy' as const,
  targetKey: 'secret-target',
  clientIp: '192.0.2.42',
  userAgent: 'Stremio/secret-agent',
  displayUrl: 'https://secret-capability',
  filename: 'secret-title',
};

let clock = 0;

class Sink extends EventEmitter {
  accepting = true;
  write = vi.fn(() => this.accepting);
}

function stallEvents(name: string) {
  return mocks.info.mock.calls
    .map(([fields]) => fields)
    .filter((fields) => fields.event === name);
}

function openAt(registry: StreamRegistry, at: number) {
  clock = at;
  const opened = registry.open(input, at);
  if (!opened.ok) throw new Error('fixture failed');
  const sink = new Sink();
  opened.handle.trackDownstream(sink as unknown as Writable);
  return { handle: opened.handle, sink };
}

function serve(handle: StreamHandle, sink: Sink, at: number, bytes = 100) {
  clock = at;
  handle.addUpstreamBytes(bytes);
  (sink as unknown as Writable).write(Buffer.alloc(bytes));
}

describe('playback transport telemetry', () => {
  beforeEach(() => {
    mocks.info.mockClear();
    mocks.upsertMany.mockClear();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
  });
  afterEach(() => vi.restoreAllMocks());

  it('counts upstream receipt separately from downstream writes', () => {
    const registry = new StreamRegistry();
    const { handle, sink } = openAt(registry, 1000);
    clock = 1500;
    handle.addUpstreamBytes(1000);
    clock = 2000;
    (sink as unknown as Writable).write(Buffer.alloc(600));
    const [live] = registry.snapshot(2100);
    expect(live).toMatchObject({ upstreamBytes: 1000, bytesServed: 600 });
    expect(live.upstreamBytesPerSec).toBeGreaterThan(0);
    expect(registry.snapshot(20_000)[0].upstreamBytesPerSec).toBe(0);
  });

  it('times backpressure from a refused write until drain', () => {
    const registry = new StreamRegistry();
    const { handle, sink } = openAt(registry, 1000);
    sink.accepting = false;
    serve(handle, sink, 1000);
    expect(registry.snapshot(1500)[0]).toMatchObject({
      backpressured: true,
      backpressureMs: 500,
    });
    clock = 1800;
    sink.emit('drain');
    expect(registry.snapshot(3000)[0]).toMatchObject({
      backpressured: false,
      backpressureMs: 800,
    });
  });

  it('reports a startup stall that resumes', () => {
    const registry = new StreamRegistry();
    const { handle, sink } = openAt(registry, 1000);
    registry.checkStalls(5900);
    expect(stallEvents('playback_stall_started')).toHaveLength(0);
    expect(registry.snapshot(6500)[0]).toMatchObject({
      stalls: 1,
      stalledMs: 5500,
    });
    registry.checkStalls(6500);
    expect(stallEvents('playback_stall_started')[0]).toMatchObject({
      stall_cause: 'startup',
      session_id: handle.sessionId,
      instance_id: 'fixture-instance',
      transport: 'proxy',
      username: 'fixture-user',
    });
    serve(handle, sink, 7000);
    expect(stallEvents('playback_stall_ended')[0]).toMatchObject({
      stall_cause: 'startup',
      stall_outcome: 'resumed',
      stall_duration_ms: 6000,
      upstream_bytes: 100,
      bytes_served: 100,
    });
    expect(registry.snapshot(7100)[0]).toMatchObject({
      stalls: 1,
      stalledMs: 6000,
    });
  });

  it('blames the client when it stops accepting writes', () => {
    const registry = new StreamRegistry();
    const { handle, sink } = openAt(registry, 1000);
    sink.accepting = false;
    serve(handle, sink, 1000);
    registry.checkStalls(7000);
    expect(stallEvents('playback_stall_started')[0].stall_cause).toBe(
      'downstream'
    );
    clock = 8000;
    sink.emit('drain');
    sink.accepting = true;
    serve(handle, sink, 8000);
    expect(stallEvents('playback_stall_ended')[0]).toMatchObject({
      stall_cause: 'downstream',
      stall_outcome: 'resumed',
      stall_duration_ms: 7000,
    });
  });

  it('blames the source when nothing arrives and closes with the read', () => {
    const registry = new StreamRegistry();
    const { handle, sink } = openAt(registry, 1000);
    serve(handle, sink, 1000);
    registry.checkStalls(7000);
    expect(stallEvents('playback_stall_started')[0].stall_cause).toBe(
      'upstream'
    );
    clock = 9000;
    handle.close();
    expect(stallEvents('playback_stall_ended')[0]).toMatchObject({
      stall_cause: 'upstream',
      stall_outcome: 'closed',
      stall_duration_ms: 8000,
    });
    expect(registry.snapshot(9100)[0]).toMatchObject({
      stalls: 1,
      stalledMs: 8000,
    });
  });

  it('calls a stall unknown when upstream bytes do not reach the client', () => {
    const registry = new StreamRegistry();
    const { handle, sink } = openAt(registry, 1000);
    serve(handle, sink, 1000);
    clock = 3000;
    handle.addUpstreamBytes(100);
    registry.checkStalls(7000);
    expect(stallEvents('playback_stall_started')[0].stall_cause).toBe(
      'unknown'
    );
  });

  it('refines the cause when upstream bytes arrive during a stall', () => {
    const registry = new StreamRegistry();
    const { handle, sink } = openAt(registry, 1000);
    serve(handle, sink, 1000);
    registry.checkStalls(7000);
    clock = 7500;
    handle.addUpstreamBytes(100);
    registry.checkStalls(8000);
    serve(handle, sink, 9000);
    expect(stallEvents('playback_stall_ended')[0].stall_cause).toBe('unknown');
  });

  it('catches a stall shorter than the tick interval when bytes resume', () => {
    const registry = new StreamRegistry();
    const { handle, sink } = openAt(registry, 1000);
    serve(handle, sink, 1000);
    serve(handle, sink, 7000);
    expect(stallEvents('playback_stall_started')[0].stall_cause).toBe(
      'upstream'
    );
    expect(stallEvents('playback_stall_ended')[0]).toMatchObject({
      stall_cause: 'upstream',
      stall_outcome: 'resumed',
      stall_duration_ms: 6000,
    });
  });

  it('does not treat a pause without an open read as a stall', () => {
    const registry = new StreamRegistry();
    const { handle, sink } = openAt(registry, 1000);
    serve(handle, sink, 1000);
    clock = 1500;
    handle.close();
    registry.checkStalls(30_000);
    expect(registry.snapshot(30_000)[0]).toMatchObject({
      stalls: 0,
      stalledMs: 0,
    });
    const resumed = openAt(registry, 30_000);
    serve(resumed.handle, resumed.sink, 32_000);
    registry.checkStalls(33_000);
    expect(stallEvents('playback_stall_started')).toHaveLength(0);
  });

  it('does not guess at stalls on reads without an observed client', () => {
    const registry = new StreamRegistry();
    clock = 1000;
    const opened = registry.open({ ...input, transport: 'usenet' }, 1000);
    if (!opened.ok) throw new Error('fixture failed');
    opened.handle.addUpstreamBytes(100);
    opened.handle.addBytes(100);
    registry.checkStalls(30_000);
    expect(registry.snapshot(30_000)[0].stalls).toBe(0);
    expect(stallEvents('playback_stall_started')).toHaveLength(0);
  });

  it('ends a running stall when the session is stopped', () => {
    const registry = new StreamRegistry();
    const { handle } = openAt(registry, 1000);
    registry.checkStalls(7000);
    clock = 8000;
    registry.kill(handle.sessionId);
    expect(stallEvents('playback_stall_ended')[0]).toMatchObject({
      stall_outcome: 'closed',
      stall_duration_ms: 7000,
    });
  });

  it('logs no capability, address, title or client string', () => {
    const registry = new StreamRegistry();
    const { handle, sink } = openAt(registry, 1000);
    registry.checkStalls(7000);
    serve(handle, sink, 8000);
    const events = [
      ...stallEvents('playback_stall_started'),
      ...stallEvents('playback_stall_ended'),
    ];
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toMatch(/secret|192\.0\.2|Stremio/);
  });

  it('keeps telemetry out of persisted rows', async () => {
    const registry = new StreamRegistry();
    const { handle, sink } = openAt(registry, 1000);
    sink.accepting = false;
    serve(handle, sink, 1000);
    registry.checkStalls(7000);
    await registry.flush(8000);
    expect(mocks.upsertMany).toHaveBeenCalled();
    expect(JSON.stringify(mocks.upsertMany.mock.calls)).not.toMatch(
      /upstream|backpressure|stall/i
    );
  });
});
