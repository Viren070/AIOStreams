import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  sync: vi.fn(),
  contextFromCredentials: vi.fn(),
  ctx: {
    uuid: 'account',
    persona: { id: 'own', name: 'Own' },
    userData: {},
    watch: { uuid: 'account', persona: 'own' },
    apiKey: null as unknown,
  },
}));
vi.mock('@aiostreams/core', () => ({
  config: {},
  createLogger: () => ({}),
  JellyfinRepository: { getUserConfiguration: async () => ({}) },
  personaUserId: (uuid: string, persona: string) => `${uuid}:${persona}`,
  serverId: () => 'server',
  mintToken: () => 'token',
}));
vi.mock('./context.js', () => ({
  jf: (handler: Function) => (req: unknown, res: unknown) =>
    handler(req, res, state.ctx),
  jfOptional: (handler: Function) => handler,
  param: vi.fn(),
  personaLocked: () => false,
  accountLocked: () => false,
  watchScopeOf: (uuid: string, persona: { id: string } | null) => ({
    uuid,
    persona: persona?.id ?? '',
  }),
  lockTag: () => '',
  contextFromCredentials: state.contextFromCredentials,
}));
vi.mock('./items.js', () => ({}));
vi.mock('./system.js', () => ({ serverName: () => 'Server' }));
vi.mock('./handoff.js', () => ({ watchHistorySync: state.sync }));

import router, { authenticationResult } from './users.js';

async function me(
  query: Record<string, unknown> = { IncludeWatchHistorySync: 'true' }
) {
  const route = router.stack.find(
    (layer) => layer.route?.path === '/Users/Me'
  )!.route!;
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  await route.stack[0].handle(
    { query, params: { userId: 'other-persona' } } as unknown as Request,
    response as unknown as Response,
    vi.fn()
  );
  return response;
}

beforeEach(() => {
  state.sync.mockReset();
  state.contextFromCredentials.mockReset();
  state.ctx.apiKey = null;
});

describe('WatchHistorySync user response boundary', () => {
  it.each([
    {},
    { IncludeWatchHistorySync: 'false' },
    { IncludeWatchHistorySync: ['true', 'false'] },
  ])(
    'does not resolve addons for ordinary or ambiguous user reads: %j',
    async (query) => {
      const res = await me(query);
      expect(state.sync).not.toHaveBeenCalled();
      expect(res.json.mock.calls[0][0]).not.toHaveProperty('WatchHistorySync');
    }
  );

  it('uses only the authenticated context and preserves a confirmed empty list', async () => {
    state.sync.mockResolvedValue({ services: [] });
    const res = await me();
    expect(state.sync).toHaveBeenCalledTimes(1);
    expect(state.sync).toHaveBeenCalledWith(state.ctx);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        Id: 'account:own',
        WatchHistorySync: { services: [] },
      })
    );
  });

  it('omits unknown status rather than serializing a null or empty object', async () => {
    state.sync.mockResolvedValue(undefined);
    const res = await me();
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('WatchHistorySync');
  });

  it('does not resolve tracking services for an API key', async () => {
    state.ctx.apiKey = { id: 'key' };
    const res = await me();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(state.sync).not.toHaveBeenCalled();
  });

  it('keeps authentication free of tracking-service resolution', async () => {
    const result = await authenticationResult(
      {
        jfClient: {
          name: 'test',
          device: 'test',
          deviceId: 'test',
          version: '1',
        },
      } as never,
      'account',
      'encrypted-secret',
      {} as never,
      state.ctx.persona as never
    );
    expect(result.User).not.toHaveProperty('WatchHistorySync');
    expect(state.sync).not.toHaveBeenCalled();
    expect(state.contextFromCredentials).not.toHaveBeenCalled();
  });
});
