import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  upsertMany: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock('../utils/index.js', () => ({
  appConfig: { streams: { connectionLimits: {}, sessionIdleTimeout: 60 } },
  encryptString: (value: string) => ({
    success: true,
    data: Buffer.from(value).toString('base64url'),
  }),
  decryptString: (value: string) => ({
    success: true,
    data: Buffer.from(value, 'base64url').toString(),
  }),
  fromUrlSafeBase64: (value: string) =>
    Buffer.from(value, 'base64url').toString(),
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
import { formatStreamSource, parseStreamSource, sourceSlug } from './source.js';
import { ProxyDataSchema } from '../proxy/token.js';
import {
  decodeUsenetStreamToken,
  encodeUsenetStreamToken,
  withUsenetStreamSource,
} from '../usenet/integration/tokens.js';

const input = {
  username: 'fixture-user',
  transport: 'proxy' as const,
  targetKey: 'target',
};

describe('playback source attribution', () => {
  it('carries a bounded source onto the live session only', async () => {
    mocks.info.mockClear();
    mocks.upsertMany.mockClear();
    const registry = new StreamRegistry();
    const opened = registry.open(
      { ...input, sourceAddon: ' Comet ', sourceService: 'RealDebrid' },
      1000
    );
    if (!opened.ok) throw new Error('fixture failed');
    expect(registry.snapshot(1100)[0]).toMatchObject({
      sourceAddon: 'comet',
      sourceService: 'realdebrid',
    });
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    opened.handle.trackDownstream({
      write: () => true,
      on: () => undefined,
    } as never);
    registry.checkStalls(7000);
    vi.restoreAllMocks();
    expect(mocks.info.mock.calls.at(-1)?.[0]).toMatchObject({
      event: 'playback_stall_started',
      source_addon: 'comet',
      source_service: 'realdebrid',
    });
    await registry.flush(8000);
    expect(JSON.stringify(mocks.upsertMany.mock.calls)).not.toMatch(
      /comet|realdebrid|source/i
    );
  });

  it('leaves an unknown source absent and learns it from a later read', () => {
    const registry = new StreamRegistry();
    registry.open(input, 1000);
    const [live] = registry.snapshot(1100);
    expect(live.sourceAddon).toBeUndefined();
    expect(live.sourceService).toBeUndefined();
    registry.open({ ...input, sourceService: 'torbox' }, 1200);
    expect(registry.snapshot(1300)[0].sourceService).toBe('torbox');
  });

  it('lets a failover redirect replace the listed source', () => {
    const registry = new StreamRegistry();
    const opened = registry.open(
      { ...input, sourceAddon: 'comet', sourceService: 'realdebrid' },
      1000
    );
    if (!opened.ok) throw new Error('fixture failed');
    opened.handle.setSource(parseStreamSource('/torbox')!);
    const [live] = registry.snapshot(1100);
    expect(live.sourceAddon).toBeUndefined();
    expect(live.sourceService).toBe('torbox');
  });

  it('bounds labels to short lowercase slugs', () => {
    expect(sourceSlug('Torrentio')).toBe('torrentio');
    expect(sourceSlug('a b\n<c>/d')).toBe('abcd');
    expect(sourceSlug('x'.repeat(100))).toHaveLength(32);
    expect(sourceSlug('  ')).toBeUndefined();
    expect(sourceSlug(42)).toBeUndefined();
    expect(formatStreamSource({ addon: 'Comet', service: 'torbox' })).toBe(
      'comet/torbox'
    );
    expect(parseStreamSource('comet/torbox')).toEqual({
      addon: 'comet',
      service: 'torbox',
    });
    expect(parseStreamSource(['comet/torbox'])).toBeUndefined();
  });

  it('still plays proxy tokens without or with a malformed source', () => {
    const url = 'https://cdn.example/file';
    expect(ProxyDataSchema.parse({ url }).source).toBeUndefined();
    expect(
      ProxyDataSchema.parse({ url, source: { addon: 'comet' } }).source
    ).toEqual({ addon: 'comet' });
    const malformed = ProxyDataSchema.parse({ url, source: { addon: 7 } });
    expect(malformed).toMatchObject({ url, source: undefined });
  });

  it('names the addon in a native usenet stream url compatibly', () => {
    const legacy = encodeUsenetStreamToken({
      nzb: 'https://indexer.example/nzb',
      hash: 'abc',
      filename: 'file.mkv',
    });
    expect(decodeUsenetStreamToken(legacy)?.sourceAddon).toBeUndefined();
    const url = `https://aio.example/api/v1/usenet/stream/${legacy}/file.mkv?x=1`;
    const named = withUsenetStreamSource(url, 'newznab');
    const match = /\/stream\/([^/]+)\/file\.mkv\?x=1$/.exec(named);
    expect(match).not.toBeNull();
    expect(decodeUsenetStreamToken(match![1])).toMatchObject({
      hash: 'abc',
      sourceAddon: 'newznab',
    });
    expect(withUsenetStreamSource('https://cdn.example/f', 'newznab')).toBe(
      'https://cdn.example/f'
    );
  });
});
