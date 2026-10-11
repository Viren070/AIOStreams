import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPlaybackSink } from '@aiostreams/core';
import type { JellyfinRequestContext } from './context.js';

const state = vi.hoisted(() => ({
  config: {
    watchState: { reportEnabled: true, pullEnabled: true, maxSinks: 10 },
  },
  refused: vi.fn(async (_url: string) => false),
}));
vi.mock('@aiostreams/core', () => ({
  config: state.config,
  Cache: { getInstance: () => ({}) },
  createLogger: () => ({ debug: vi.fn() }),
  isRefusedUrl: state.refused,
}));
vi.mock('./context.js', () => ({
  personasOf: (data: { jellyfin?: { personas?: unknown[] } }) =>
    data.jellyfin?.personas ?? [],
}));
vi.mock('./items.js', () => ({}));

import { watchHistorySync } from './handoff.js';

function sink(name: string, id = name, viewers = false): ResolvedPlaybackSink {
  return {
    name,
    instanceId: id,
    presetId: id,
    baseUrl: `https://tracker.example/${id}`,
    query: '?token=secret',
    events: ['played'],
    pullable: true,
    types: ['movie'],
    viewers,
  };
}
function context(
  primary: ResolvedPlaybackSink[],
  own: ResolvedPlaybackSink[] = primary,
  persona: Record<string, unknown> | null = null,
  primaryPicks?: string[],
  others: Record<string, unknown>[] = [],
  failed: unknown[] = []
): JellyfinRequestContext {
  const engine = (sinks: ResolvedPlaybackSink[]) => ({
    getPlaybackSinks: () => sinks,
    getFailedAddons: () =>
      failed.filter((entry) => 'preset' in (entry as object)),
    hasAddonInitialisationErrors: (picks?: readonly string[]) =>
      failed.some((entry) => {
        const addon = entry as { instanceId: string; preset?: { id: string } };
        return !picks || picks.includes(addon.preset?.id ?? addon.instanceId);
      }),
  });
  return {
    persona,
    userData: {
      jellyfin: {
        primary: { trackers: primaryPicks },
        personas: [...others, ...(persona ? [persona] : [])],
      },
    },
    primaryEngine: async () => engine(primary),
    engine: async () => engine(own),
  } as unknown as JellyfinRequestContext;
}

beforeEach(() => {
  Object.assign(state.config.watchState, {
    reportEnabled: true,
    pullEnabled: true,
    maxSinks: 10,
  });
  state.refused.mockReset().mockResolvedValue(false);
});

describe('current-user WatchHistorySync advertisement', () => {
  it.each([
    null,
    { id: 'own', history: 'own', trackers: [] },
    { id: 'shared', history: 'shared' },
  ])(
    'does not initialize addons when this history explicitly selects no trackers: %j',
    async (persona) => {
      const ctx = context([], [], persona, []);
      ctx.primaryEngine = vi
        .fn()
        .mockRejectedValue(new Error('must not initialize'));
      ctx.engine = vi.fn().mockRejectedValue(new Error('must not initialize'));
      expect(await watchHistorySync(ctx)).toEqual({ services: [] });
      expect(ctx.primaryEngine).not.toHaveBeenCalled();
      expect(ctx.engine).not.toHaveBeenCalled();
    }
  );

  it('treats a selected own-persona failure as unknown', async () => {
    const ctx = context([], [], {
      id: 'own',
      history: 'own',
      trackers: ['missing'],
    });
    ctx.engine = async () =>
      ({
        hasAddonInitialisationErrors: () => true,
      }) as never;
    expect(await watchHistorySync(ctx)).toBeUndefined();
  });

  it('keeps successful explicit selections when an unrelated preset fails', async () => {
    const tracker = sink('Selected');
    expect(
      await watchHistorySync(
        context(
          [tracker],
          [],
          null,
          [tracker.presetId!],
          [],
          [{ instanceId: 'unrelated' }]
        )
      )
    ).toEqual({ services: ['Selected'] });
  });

  it('shares primary selections, not a shared persona variant tracker', async () => {
    const a = sink('Trakt'),
      b = sink('Other tracker');
    expect(
      await watchHistorySync(
        context([a, b], [b], { id: 'shared', history: 'shared' }, [a.presetId!])
      )
    ).toEqual({ services: ['Trakt'] });
  });

  it('isolates automatic own histories from primary and other persona claims', async () => {
    const a = sink('Primary'),
      b = sink('Mine'),
      c = sink('Other');
    expect(
      await watchHistorySync(
        context([a], [a, b, c], { id: 'mine', history: 'own' }, undefined, [
          { id: 'other', history: 'own', trackers: [c.presetId] },
        ])
      )
    ).toEqual({ services: ['Mine'] });
  });

  it('honors explicit selections and first-owner claims', async () => {
    const a = sink('Primary'),
      b = sink('Mine'),
      c = sink('Other');
    expect(
      await watchHistorySync(
        context(
          [a],
          [a, b, c],
          {
            id: 'mine',
            history: 'own',
            trackers: [a.presetId, b.presetId, c.presetId],
          },
          undefined,
          [{ id: 'other', history: 'own', trackers: [c.presetId] }]
        )
      )
    ).toEqual({ services: ['Mine'] });
  });

  it('permits a tracker with isolated viewers for an own persona', async () => {
    const a = sink('Shared service', 'viewer', true);
    expect(
      await watchHistorySync(context([a], [a], { id: 'mine', history: 'own' }))
    ).toEqual({ services: ['Shared service'] });
    expect(a.query).toBe('?token=secret');
  });

  it('emits only normalized labels and deduplicates without leaking routing data', async () => {
    const names = ['  Custom   tracker  ', 'custom tracker', 'Suivi été'];
    const result = await watchHistorySync(
      context(names.map((n, i) => sink(n, String(i))))
    );
    expect(result).toEqual({ services: ['Custom tracker', 'Suivi été'] });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it.each([
    'https://host/secret',
    'user:password',
    'user@host',
    'bad\nname',
    'x'.repeat(81),
    '',
    'bad\u202ename',
  ])('treats an unsafe label as unknown: %j', async (name) => {
    expect(await watchHistorySync(context([sink(name)]))).toBeUndefined();
  });

  it('filters refused addresses, inactive directions and applies the dispatch cap', async () => {
    const a = sink('Refused'),
      b = { ...sink('Inactive'), events: [], pullable: false };
    state.refused.mockImplementation(async (url) => url === a.baseUrl);
    state.config.watchState.maxSinks = 2;
    expect(await watchHistorySync(context([a, b, sink('Beyond cap')]))).toEqual(
      { services: [] }
    );
  });

  it('reflects global direction settings', async () => {
    state.config.watchState.reportEnabled = false;
    expect(
      await watchHistorySync(
        context([{ ...sink('Push only'), pullable: false }])
      )
    ).toEqual({ services: [] });
    state.config.watchState.pullEnabled = false;
    expect(await watchHistorySync(context([sink('Disabled')]))).toEqual({
      services: [],
    });
  });

  it('distinguishes no configured trackers from failed resolution or policy lookup', async () => {
    expect(await watchHistorySync(context([]))).toEqual({ services: [] });
    const broken = context([]);
    broken.primaryEngine = async () => {
      throw new Error('secret credentials');
    };
    expect(await watchHistorySync(broken)).toBeUndefined();
    state.refused.mockRejectedValue(new Error('lookup failed'));
    expect(await watchHistorySync(context([sink('Unknown')]))).toBeUndefined();
  });

  it('treats preset-generation failures as unknown too', async () => {
    expect(
      await watchHistorySync(
        context(
          [],
          [],
          null,
          undefined,
          [],
          [{ instanceId: 'preset-that-failed' }]
        )
      )
    ).toBeUndefined();
  });

  it('does not assert empty or complete service information when a selected addon failed', async () => {
    const failed = [{ instanceId: 'missing', preset: { id: 'missing' } }];
    expect(
      await watchHistorySync(context([], [], null, undefined, [], failed))
    ).toBeUndefined();
    expect(
      await watchHistorySync(context([], [], null, [], [], failed))
    ).toEqual({ services: [] });
  });
});
