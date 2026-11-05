import { describe, expect, it } from 'vitest';
import {
  mergePresets,
  mergeTemplateUpdate,
  planTemplateUpdate,
} from '../templates/merge';

const preset = (instanceId: string, extra: Record<string, unknown> = {}) => ({
  instanceId,
  type: instanceId,
  enabled: true,
  options: {},
  ...extra,
});

describe('planTemplateUpdate', () => {
  const base = {
    sortCriteria: { global: [{ key: 'quality', direction: 'desc' }] },
    excludedKeywords: ['cam'],
    timeout: 5000,
  };

  it('applies fields the user never changed without asking', () => {
    const mine = { ...base };
    const theirs = { ...base, excludedKeywords: ['cam', 'ts'] };
    const plan = planTemplateUpdate(base as any, mine as any, theirs as any);
    expect(plan.changed).toEqual(['excludedKeywords']);
    expect(plan.conflicts).toEqual([]);
  });

  it('flags a field both the user and the update changed', () => {
    const mine = { ...base, timeout: 9000 };
    const theirs = { ...base, timeout: 7000 };
    const plan = planTemplateUpdate(base as any, mine as any, theirs as any);
    expect(plan.conflicts.map((c) => c.field)).toEqual(['timeout']);
  });

  it('ignores a field the update leaves alone, even if the user changed it', () => {
    const mine = { ...base, timeout: 9000 };
    const theirs = { ...base, excludedKeywords: ['cam', 'ts'] };
    const plan = planTemplateUpdate(base as any, mine as any, theirs as any);
    expect(plan.changed).not.toContain('timeout');
  });

  it('does not ask when the user and the update agree', () => {
    const mine = { ...base, timeout: 7000 };
    const theirs = { ...base, timeout: 7000 };
    const plan = planTemplateUpdate(base as any, mine as any, theirs as any);
    expect(plan.conflicts).toEqual([]);
  });

  it('never asks about services', () => {
    const plan = planTemplateUpdate(
      { services: [] } as any,
      { services: [{ id: 'torbox', enabled: true }] } as any,
      { services: [{ id: 'realdebrid', enabled: true }] } as any
    );
    expect(plan.changed).toEqual([]);
  });

  it('lists every differing field when there is no baseline', () => {
    const plan = planTemplateUpdate(
      undefined,
      { timeout: 9000, excludedKeywords: ['cam'] } as any,
      { timeout: 7000, excludedKeywords: ['cam'] } as any
    );
    expect(plan.hasBaseline).toBe(false);
    expect(plan.conflicts.map((c) => c.field)).toEqual(['timeout']);
  });

  it('does not count addons the user added as a conflict', () => {
    const basePresets = [preset('a'), preset('b')];
    const plan = planTemplateUpdate(
      { presets: basePresets } as any,
      { presets: [...basePresets, preset('mine')] } as any,
      { presets: [preset('a', { enabled: false }), preset('b')] } as any
    );
    expect(plan.changed).toEqual(['presets']);
    expect(plan.conflicts).toEqual([]);
  });
});

describe('planTemplateUpdate changes', () => {
  it('lists each change with before and after, flagging conflicts', () => {
    const base = {
      timeout: 5000,
      excludedKeywords: ['cam'],
      presets: [preset('a')],
    };
    const mine = {
      timeout: 9000,
      excludedKeywords: ['cam'],
      presets: [preset('a'), preset('mine')],
    };
    const theirs = {
      timeout: 7000,
      excludedKeywords: ['cam', 'ts'],
      presets: [preset('a'), preset('new')],
    };
    const plan = planTemplateUpdate(base as any, mine as any, theirs as any);
    const byField = Object.fromEntries(plan.changes.map((c) => [c.field, c]));
    expect(byField.timeout).toMatchObject({
      mine: 9000,
      theirs: 7000,
      conflict: true,
    });
    expect(byField.excludedKeywords.conflict).toBe(false);
    expect((byField.presets.theirs as any[]).map((p) => p.instanceId)).toEqual([
      'a',
      'new',
      'mine',
    ]);
    expect(byField.presets.conflict).toBe(false);
  });
});

describe('mergePresets', () => {
  it('keeps user-added addons and drops template addons the user removed', () => {
    const base = [preset('a'), preset('b')];
    const mine = [preset('a'), preset('mine')];
    const theirs = [
      preset('a', { options: { v: 2 } }),
      preset('b'),
      preset('c'),
    ];
    expect(mergePresets(base, mine, theirs)).toEqual([
      preset('a', { options: { v: 2 } }),
      preset('c'),
      preset('mine'),
    ]);
  });
});

describe('mergeTemplateUpdate', () => {
  const base = {
    timeout: 5000,
    excludedKeywords: ['cam'],
    presets: [preset('a')],
  };

  it('replaces every template field on a first apply', () => {
    const prev = { uuid: 'u', timeout: 9000 };
    expect(
      mergeTemplateUpdate(prev, { timeout: 5000 }, null, new Set(), undefined)
    ).toEqual({ uuid: 'u', timeout: 5000 });
  });

  it('applies only changed fields and honours keepMine', () => {
    const prev = { ...base, timeout: 9000, excludedKeywords: ['cam', 'mine'] };
    const incoming = {
      ...base,
      timeout: 7000,
      excludedKeywords: ['cam', 'ts'],
    };
    const plan = planTemplateUpdate(base as any, prev as any, incoming as any);
    const next = mergeTemplateUpdate(
      prev,
      incoming,
      plan,
      new Set(['timeout']),
      base
    );
    expect(next.timeout).toBe(9000);
    expect(next.excludedKeywords).toEqual(['cam', 'ts']);
  });

  it('keeps the user credentials when the update leaves them blank', () => {
    const prev = {
      services: [{ id: 'torbox', enabled: true, credentials: { apiKey: 'k' } }],
    };
    const incoming = {
      services: [{ id: 'torbox', enabled: true, credentials: { apiKey: '' } }],
    };
    const plan = planTemplateUpdate({} as any, prev as any, incoming as any);
    const next = mergeTemplateUpdate(prev, incoming, plan, new Set(), {});
    expect(next.services[0].credentials.apiKey).toBe('k');
  });

  it('keeps addons the user added when taking the template addons', () => {
    const prev = { ...base, presets: [preset('a'), preset('mine')] };
    const incoming = { ...base, presets: [preset('a'), preset('new')] };
    const plan = planTemplateUpdate(base as any, prev as any, incoming as any);
    const next = mergeTemplateUpdate(prev, incoming, plan, new Set(), base);
    expect(next.presets.map((p: any) => p.instanceId)).toEqual([
      'a',
      'new',
      'mine',
    ]);
  });
});
