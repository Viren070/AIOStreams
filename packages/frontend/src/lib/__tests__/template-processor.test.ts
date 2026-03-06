import { describe, it, expect } from 'vitest';
import {
  getNestedInputValue,
  evaluateTemplateCondition,
  resolveRef,
  applyTemplateConditionals,
  resolveCredentialRefs,
} from '../templates/processors/conditionals';

// ---------------------------------------------------------------------------
// getNestedInputValue
// ---------------------------------------------------------------------------
describe('getNestedInputValue', () => {
  it('returns a top-level value', () => {
    expect(getNestedInputValue({ lang: 'English' }, 'lang')).toBe('English');
  });

  it('resolves a dot-separated path', () => {
    expect(
      getNestedInputValue({ proxy: { url: 'http://proxy' } }, 'proxy.url')
    ).toBe('http://proxy');
  });

  it('resolves a three-level path', () => {
    expect(getNestedInputValue({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('returns undefined for a missing key', () => {
    expect(getNestedInputValue({ a: 1 }, 'b')).toBeUndefined();
  });

  it('returns undefined when traversal hits null', () => {
    expect(getNestedInputValue({ a: null }, 'a.b')).toBeUndefined();
  });

  it('returns undefined when traversal hits undefined', () => {
    expect(getNestedInputValue({ a: undefined }, 'a.b')).toBeUndefined();
  });

  it('returns falsy value 0 without treating it as missing', () => {
    expect(getNestedInputValue({ n: 0 }, 'n')).toBe(0);
  });

  it('returns false without treating it as missing', () => {
    expect(getNestedInputValue({ flag: false }, 'flag')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateTemplateCondition — bare truthiness
// ---------------------------------------------------------------------------
describe('evaluateTemplateCondition — bare truthiness', () => {
  const noSvcs: string[] = [];

  it('is truthy for a non-empty string', () => {
    expect(evaluateTemplateCondition('inputs.x', { x: 'hello' }, noSvcs)).toBe(
      true
    );
  });

  it('is truthy for a non-zero number', () => {
    expect(evaluateTemplateCondition('inputs.n', { n: 5 }, noSvcs)).toBe(true);
  });

  it('is truthy for numeric 0 (explicitly set value)', () => {
    // 0 is NOT falsy in template conditions — it is a valid, explicitly-entered number.
    // Only undefined / null / '' / false / [] are treated as falsy.
    expect(evaluateTemplateCondition('inputs.n', { n: 0 }, noSvcs)).toBe(true);
  });

  it('is truthy for true boolean', () => {
    expect(
      evaluateTemplateCondition('inputs.flag', { flag: true }, noSvcs)
    ).toBe(true);
  });

  it('is truthy for a non-empty array', () => {
    expect(
      evaluateTemplateCondition('inputs.arr', { arr: ['a'] }, noSvcs)
    ).toBe(true);
  });

  it('is falsy for undefined', () => {
    expect(evaluateTemplateCondition('inputs.x', {}, noSvcs)).toBe(false);
  });

  it('is falsy for null', () => {
    expect(evaluateTemplateCondition('inputs.x', { x: null }, noSvcs)).toBe(
      false
    );
  });

  it('is falsy for empty string', () => {
    expect(evaluateTemplateCondition('inputs.x', { x: '' }, noSvcs)).toBe(
      false
    );
  });

  it('is falsy for false', () => {
    expect(
      evaluateTemplateCondition('inputs.flag', { flag: false }, noSvcs)
    ).toBe(false);
  });

  it('is falsy for empty array', () => {
    expect(evaluateTemplateCondition('inputs.arr', { arr: [] }, noSvcs)).toBe(
      false
    );
  });

  it('negation flips truthy to false', () => {
    expect(
      evaluateTemplateCondition('!inputs.flag', { flag: true }, noSvcs)
    ).toBe(false);
  });

  it('negation flips falsy to true', () => {
    expect(
      evaluateTemplateCondition('!inputs.flag', { flag: false }, noSvcs)
    ).toBe(true);
  });

  it('negation of missing input is true', () => {
    expect(evaluateTemplateCondition('!inputs.x', {}, noSvcs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateTemplateCondition — services
// ---------------------------------------------------------------------------
describe('evaluateTemplateCondition — services', () => {
  it('is true when service is in selectedSvcs', () => {
    expect(
      evaluateTemplateCondition('services.realdebrid', {}, ['realdebrid'])
    ).toBe(true);
  });

  it('is false when service is not in selectedSvcs', () => {
    expect(
      evaluateTemplateCondition('services.realdebrid', {}, ['torbox'])
    ).toBe(false);
  });

  it('negated service is false when service present', () => {
    expect(evaluateTemplateCondition('!services.torbox', {}, ['torbox'])).toBe(
      false
    );
  });

  it('negated service is true when service absent', () => {
    expect(evaluateTemplateCondition('!services.torbox', {}, [])).toBe(true);
  });

  it('services with operator always returns false (not supported)', () => {
    // services.* only supports bare truthiness; operator form falls through to false
    expect(
      evaluateTemplateCondition('services.torbox == pro', {}, ['torbox'])
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateTemplateCondition — bare services (any service selected)
// ---------------------------------------------------------------------------
describe('evaluateTemplateCondition — bare services', () => {
  it('is true when at least one service is selected', () => {
    expect(evaluateTemplateCondition('services', {}, ['torbox'])).toBe(true);
  });

  it('is true when multiple services are selected', () => {
    expect(
      evaluateTemplateCondition('services', {}, ['torbox', 'realdebrid'])
    ).toBe(true);
  });

  it('is false when no services are selected', () => {
    expect(evaluateTemplateCondition('services', {}, [])).toBe(false);
  });

  it('negated: !services is false when services are present', () => {
    expect(evaluateTemplateCondition('!services', {}, ['torbox'])).toBe(false);
  });

  it('negated: !services is true when no services', () => {
    expect(evaluateTemplateCondition('!services', {}, [])).toBe(true);
  });

  it('and compound: services and inputs.flag — true only when both hold', () => {
    expect(
      evaluateTemplateCondition('services and inputs.flag', { flag: true }, [
        'torbox',
      ])
    ).toBe(true);
    expect(
      evaluateTemplateCondition('services and inputs.flag', { flag: true }, [])
    ).toBe(false);
    expect(
      evaluateTemplateCondition('services and inputs.flag', { flag: false }, [
        'torbox',
      ])
    ).toBe(false);
  });

  it('and compound — trailing: inputs.flag and services', () => {
    expect(
      evaluateTemplateCondition('inputs.flag and services', { flag: true }, [
        'torbox',
      ])
    ).toBe(true);
    expect(
      evaluateTemplateCondition('inputs.flag and services', { flag: true }, [])
    ).toBe(false);
  });

  it('or compound — trailing: inputs.flag or services', () => {
    // flag false, no services → false
    expect(
      evaluateTemplateCondition('inputs.flag or services', { flag: false }, [])
    ).toBe(false);
    // flag false, services present → true
    expect(
      evaluateTemplateCondition('inputs.flag or services', { flag: false }, [
        'torbox',
      ])
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateTemplateCondition — == operator
// ---------------------------------------------------------------------------
describe('evaluateTemplateCondition — == operator', () => {
  const noSvcs: string[] = [];

  it('matches a string value', () => {
    expect(
      evaluateTemplateCondition('inputs.tier == pro', { tier: 'pro' }, noSvcs)
    ).toBe(true);
  });

  it('does not match a different value', () => {
    expect(
      evaluateTemplateCondition('inputs.tier == pro', { tier: 'basic' }, noSvcs)
    ).toBe(false);
  });

  it('does not match when rhs is empty (op regex requires ≥1 char on rhs)', () => {
    // The operator regex requires at least one character on the right-hand side.
    // "inputs.x == " (empty rhs) falls through to bare truthiness, which is false
    // for an undefined input.
    expect(evaluateTemplateCondition('inputs.x == ', {}, noSvcs)).toBe(false);
  });

  it('negated equality: false when equal', () => {
    expect(
      evaluateTemplateCondition('!inputs.tier == pro', { tier: 'pro' }, noSvcs)
    ).toBe(false);
  });

  it('negated equality: true when not equal', () => {
    expect(
      evaluateTemplateCondition(
        '!inputs.tier == pro',
        { tier: 'basic' },
        noSvcs
      )
    ).toBe(true);
  });

  it('works with subsection dot-path', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.proxy.type == socks5',
        { proxy: { type: 'socks5' } },
        noSvcs
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateTemplateCondition — != operator
// ---------------------------------------------------------------------------
describe('evaluateTemplateCondition — != operator', () => {
  const noSvcs: string[] = [];

  it('is true when value does not match', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.lang != none',
        { lang: 'English' },
        noSvcs
      )
    ).toBe(true);
  });

  it('is false when value matches', () => {
    expect(
      evaluateTemplateCondition('inputs.lang != none', { lang: 'none' }, noSvcs)
    ).toBe(false);
  });

  it('undefined treated as empty string', () => {
    expect(evaluateTemplateCondition('inputs.lang != none', {}, noSvcs)).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------------------
// evaluateTemplateCondition — includes operator
// ---------------------------------------------------------------------------
describe('evaluateTemplateCondition — includes operator', () => {
  const noSvcs: string[] = [];

  it('is true when array contains the value', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.filters includes dvPassthrough',
        { filters: ['dvPassthrough', 'nzbOnly'] },
        noSvcs
      )
    ).toBe(true);
  });

  it('is false when array does not contain the value', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.filters includes sdrPassthrough',
        { filters: ['dvPassthrough'] },
        noSvcs
      )
    ).toBe(false);
  });

  it('works on a string value (substring match)', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.flags includes foo',
        { flags: 'foobar' },
        noSvcs
      )
    ).toBe(true);
  });

  it('is false when value is undefined', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.filters includes dvPassthrough',
        {},
        noSvcs
      )
    ).toBe(false);
  });

  it('negation of includes', () => {
    expect(
      evaluateTemplateCondition(
        '!inputs.filters includes dvPassthrough',
        { filters: ['dvPassthrough'] },
        noSvcs
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveRef
// ---------------------------------------------------------------------------
describe('resolveRef', () => {
  it('resolves an inputs reference', () => {
    expect(resolveRef('inputs.lang', { lang: 'French' }, [])).toBe('French');
  });

  it('resolves a nested inputs reference', () => {
    expect(
      resolveRef('inputs.proxy.url', { proxy: { url: 'http://x' } }, [])
    ).toBe('http://x');
  });

  it('resolves a services reference to true when present', () => {
    expect(resolveRef('services.torbox', {}, ['torbox'])).toBe(true);
  });

  it('resolves a services reference to false when absent', () => {
    expect(resolveRef('services.torbox', {}, [])).toBe(false);
  });

  it('returns undefined for unknown namespace', () => {
    expect(resolveRef('unknown.thing', {}, [])).toBeUndefined();
  });

  it('bare services: resolves to the selected services array when services present', () => {
    expect(resolveRef('services', {}, ['torbox'])).toEqual(['torbox']);
    expect(resolveRef('services', {}, ['torbox', 'realdebrid'])).toEqual([
      'torbox',
      'realdebrid',
    ]);
  });

  it('bare services: resolves to an empty array when no services selected', () => {
    expect(resolveRef('services', {}, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyTemplateConditionals — __if
// ---------------------------------------------------------------------------
describe('applyTemplateConditionals — __if', () => {
  const noSvcs: string[] = [];

  it('includes an object when __if condition is true', () => {
    const result = applyTemplateConditionals(
      [{ __if: 'inputs.flag', value: 'A' }],
      { flag: true },
      noSvcs
    );
    expect(result).toEqual([{ value: 'A' }]);
  });

  it('excludes an object when __if condition is false', () => {
    const result = applyTemplateConditionals(
      [{ __if: 'inputs.flag', value: 'A' }],
      { flag: false },
      noSvcs
    );
    expect(result).toEqual([]);
  });

  it('strips the __if key from the kept object', () => {
    const result = applyTemplateConditionals(
      [{ __if: 'inputs.flag', expression: 'expr1', enabled: true }],
      { flag: true },
      noSvcs
    );
    expect(result[0]).not.toHaveProperty('__if');
    expect(result[0]).toEqual({ expression: 'expr1', enabled: true });
  });

  it('keeps non-conditional objects untouched', () => {
    const result = applyTemplateConditionals(
      [
        { expression: 'always' },
        { __if: 'inputs.flag', expression: 'conditional' },
      ],
      { flag: false },
      noSvcs
    );
    expect(result).toEqual([{ expression: 'always' }]);
  });

  it('handles multiple conditions independently', () => {
    const result = applyTemplateConditionals(
      [
        { __if: 'inputs.a', value: 'A' },
        { __if: 'inputs.b', value: 'B' },
        { __if: 'inputs.c', value: 'C' },
      ],
      { a: true, b: false, c: true },
      noSvcs
    );
    expect(result).toEqual([{ value: 'A' }, { value: 'C' }]);
  });

  it('works with services.* condition', () => {
    const result = applyTemplateConditionals(
      [
        { __if: 'services.torbox', type: 'torbox-search' },
        { __if: 'services.realdebrid', type: 'rd-addon' },
      ],
      {},
      ['torbox']
    );
    expect(result).toEqual([{ type: 'torbox-search' }]);
  });

  it('works with == operator condition', () => {
    const result = applyTemplateConditionals(
      [
        { __if: 'inputs.tier == pro', expression: 'pro-expr' },
        { __if: 'inputs.tier == basic', expression: 'basic-expr' },
      ],
      { tier: 'pro' },
      noSvcs
    );
    expect(result).toEqual([{ expression: 'pro-expr' }]);
  });

  it('works with includes operator condition', () => {
    const result = applyTemplateConditionals(
      [
        { __if: 'inputs.opts includes dvPassthrough', expression: 'dv' },
        { __if: 'inputs.opts includes sdrPassthrough', expression: 'sdr' },
      ],
      { opts: ['dvPassthrough'] },
      noSvcs
    );
    expect(result).toEqual([{ expression: 'dv' }]);
  });

  it('recurses into kept object values', () => {
    const result = applyTemplateConditionals(
      [
        {
          __if: 'inputs.flag',
          options: { name: '{{inputs.label}}' },
        },
      ],
      { flag: true, label: 'MyLabel' },
      noSvcs
    );
    expect(result).toEqual([{ options: { name: 'MyLabel' } }]);
  });
});

// ---------------------------------------------------------------------------
// applyTemplateConditionals — __value
// ---------------------------------------------------------------------------
describe('applyTemplateConditionals — __value', () => {
  const noSvcs: string[] = [];

  it('injects a single string when __if passes', () => {
    const result = applyTemplateConditionals(
      ['3D', { __if: 'inputs.excludeDV', __value: 'DV' }],
      { excludeDV: true },
      noSvcs
    );
    expect(result).toEqual(['3D', 'DV']);
  });

  it('omits the value when __if fails', () => {
    const result = applyTemplateConditionals(
      ['3D', { __if: 'inputs.excludeDV', __value: 'DV' }],
      { excludeDV: false },
      noSvcs
    );
    expect(result).toEqual(['3D']);
  });

  it('spreads an array __value when __if passes', () => {
    const result = applyTemplateConditionals(
      [
        '3D',
        { __if: 'inputs.excludeHdr', __value: ['HDR', 'HDR10', 'HDR10+'] },
      ],
      { excludeHdr: true },
      noSvcs
    );
    expect(result).toEqual(['3D', 'HDR', 'HDR10', 'HDR10+']);
  });

  it('omits array __value when __if fails', () => {
    const result = applyTemplateConditionals(
      [
        '3D',
        { __if: 'inputs.excludeHdr', __value: ['HDR', 'HDR10', 'HDR10+'] },
      ],
      { excludeHdr: false },
      noSvcs
    );
    expect(result).toEqual(['3D']);
  });

  it('handles multiple independent __value items', () => {
    const result = applyTemplateConditionals(
      [
        '3D',
        { __if: 'inputs.excludeDV', __value: 'DV' },
        { __if: 'inputs.excludeHdr', __value: ['HDR', 'HDR10', 'HDR10+'] },
        { __if: 'inputs.excludeAi', __value: 'AI' },
      ],
      { excludeDV: true, excludeHdr: true, excludeAi: false },
      noSvcs
    );
    expect(result).toEqual(['3D', 'DV', 'HDR', 'HDR10', 'HDR10+']);
  });

  it('injects __value without __if unconditionally (string)', () => {
    const result = applyTemplateConditionals(
      [{ __value: 'always' }, 'other'],
      {},
      noSvcs
    );
    expect(result).toEqual(['always', 'other']);
  });

  it('spreads __value without __if unconditionally (array)', () => {
    const result = applyTemplateConditionals(
      [{ __value: ['H-OU', 'H-SBS'] }, 'other'],
      {},
      noSvcs
    );
    expect(result).toEqual(['H-OU', 'H-SBS', 'other']);
  });

  it('supports {{}} interpolation inside __value string', () => {
    const result = applyTemplateConditionals(
      [{ __if: 'inputs.lang != none', __value: '{{inputs.lang}}' }],
      { lang: 'French' },
      noSvcs
    );
    expect(result).toEqual(['French']);
  });

  it('does not insert a nested object when __value is used', () => {
    const result = applyTemplateConditionals(
      [{ __if: 'inputs.flag', __value: 'X' }],
      { flag: true },
      noSvcs
    );
    // Must be a flat string, not an object
    expect(result).toEqual(['X']);
    expect(typeof result[0]).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// applyTemplateConditionals — __switch
// ---------------------------------------------------------------------------
describe('applyTemplateConditionals — __switch', () => {
  const noSvcs: string[] = [];

  it('returns the matching case', () => {
    const result = applyTemplateConditionals(
      {
        formatter: {
          __switch: 'inputs.style',
          cases: { torrentio: { id: 'torrentio' }, gdrive: { id: 'gdrive' } },
          default: { id: 'prism' },
        },
      },
      { style: 'torrentio' },
      noSvcs
    );
    expect(result.formatter).toEqual({ id: 'torrentio' });
  });

  it('falls back to default when no case matches', () => {
    const result = applyTemplateConditionals(
      {
        formatter: {
          __switch: 'inputs.style',
          cases: { torrentio: { id: 'torrentio' } },
          default: { id: 'prism' },
        },
      },
      { style: 'unknown' },
      noSvcs
    );
    expect(result.formatter).toEqual({ id: 'prism' });
  });

  it('returns null when no case matches and no default', () => {
    const result = applyTemplateConditionals(
      {
        formatter: {
          __switch: 'inputs.style',
          cases: { torrentio: { id: 'torrentio' } },
        },
      },
      { style: 'unknown' },
      noSvcs
    );
    expect(result.formatter).toBeNull();
  });

  it('recurses into the chosen case value', () => {
    const result = applyTemplateConditionals(
      {
        __switch: 'inputs.tier',
        cases: {
          pro: {
            limit: '{{inputs.proLimit}}',
          },
        },
        default: { limit: '0' },
      },
      { tier: 'pro', proLimit: '1TB' },
      noSvcs
    );
    expect(result).toEqual({ limit: '1TB' });
  });

  it('handles __if inside a __switch case', () => {
    const result = applyTemplateConditionals(
      {
        __switch: 'inputs.mode',
        cases: {
          advanced: {
            items: [
              { __if: 'inputs.showExtra', label: 'extra' },
              { label: 'base' },
            ],
          },
        },
        default: { items: [] },
      },
      { mode: 'advanced', showExtra: false },
      noSvcs
    );
    expect(result).toEqual({ items: [{ label: 'base' }] });
  });

  it('resolves __switch for services ref', () => {
    const result = applyTemplateConditionals(
      {
        __switch: 'services.torbox',
        cases: { true: { id: 'tb-addon' } },
        default: { id: 'generic' },
      },
      {},
      ['torbox']
    );
    expect(result).toEqual({ id: 'tb-addon' });
  });

  it('resolves __switch for bare services ref: falls to default when no services (empty array key)', () => {
    // String([]) == "" — not found in cases → uses default
    const result = applyTemplateConditionals(
      {
        __switch: 'services',
        cases: { '': { mode: 'p2p' } },
        default: { mode: 'debrid' },
      },
      {},
      []
    );
    expect(result).toEqual({ mode: 'p2p' });
  });

  it('resolves __switch for bare services ref: default used when services present (no matching case)', () => {
    // String(["torbox"]) == "torbox" — not in cases → uses default
    const result = applyTemplateConditionals(
      {
        __switch: 'services',
        cases: { '': { mode: 'p2p' } },
        default: { mode: 'debrid' },
      },
      {},
      ['torbox']
    );
    expect(result).toEqual({ mode: 'debrid' });
  });

  it('stringifies number input for case matching', () => {
    const result = applyTemplateConditionals(
      {
        __switch: 'inputs.count',
        cases: { '5': { label: 'five' } },
        default: { label: 'other' },
      },
      { count: 5 },
      noSvcs
    );
    expect(result).toEqual({ label: 'five' });
  });
});

// ---------------------------------------------------------------------------
// applyTemplateConditionals — {{}} interpolation
// ---------------------------------------------------------------------------
describe('applyTemplateConditionals — interpolation', () => {
  const noSvcs: string[] = [];

  it('{{services}} sole token: returns selected services array when services present', () => {
    expect(applyTemplateConditionals('{{services}}', {}, ['torbox'])).toEqual([
      'torbox',
    ]);
  });

  it('{{services}} sole token: returns empty array when no services', () => {
    expect(applyTemplateConditionals('{{services}}', {}, [])).toEqual([]);
  });

  it('{{services}} multi-token: stringifies as comma-joined IDs', () => {
    expect(applyTemplateConditionals('mode={{services}}', {}, ['torbox'])).toBe(
      'mode=torbox'
    );
    expect(applyTemplateConditionals('mode={{services}}', {}, [])).toBe(
      'mode='
    );
  });

  it('sole token: preserves a string value', () => {
    expect(
      applyTemplateConditionals('{{inputs.name}}', { name: 'Test' }, noSvcs)
    ).toBe('Test');
  });

  it('sole token: preserves a number value', () => {
    expect(
      applyTemplateConditionals('{{inputs.limit}}', { limit: 42 }, noSvcs)
    ).toBe(42);
  });

  it('sole token: preserves a boolean value', () => {
    expect(
      applyTemplateConditionals('{{inputs.flag}}', { flag: true }, noSvcs)
    ).toBe(true);
  });

  it('sole token: preserves an array value', () => {
    expect(
      applyTemplateConditionals(
        '{{inputs.langs}}',
        { langs: ['en', 'fr'] },
        noSvcs
      )
    ).toEqual(['en', 'fr']);
  });

  it('sole token in array: spreads an array value into parent', () => {
    const result = applyTemplateConditionals(
      ['{{inputs.langs}}', 'Original', 'Unknown'],
      { langs: ['French', 'German'] },
      noSvcs
    );
    expect(result).toEqual(['French', 'German', 'Original', 'Unknown']);
  });

  it('sole token: returns empty string for undefined', () => {
    expect(applyTemplateConditionals('{{inputs.missing}}', {}, noSvcs)).toBe(
      ''
    );
  });

  it('sole token: services ref returns boolean', () => {
    expect(
      applyTemplateConditionals('{{services.torbox}}', {}, ['torbox'])
    ).toBe(true);
    expect(applyTemplateConditionals('{{services.torbox}}', {}, [])).toBe(
      false
    );
  });

  it('multi-token: concatenates string values', () => {
    expect(
      applyTemplateConditionals(
        '/*{{inputs.label}} Passthrough*/ passthrough()',
        { label: 'English' },
        noSvcs
      )
    ).toBe('/*English Passthrough*/ passthrough()');
  });

  it('multi-token: stringifies non-string values', () => {
    expect(
      applyTemplateConditionals('count={{inputs.n}}', { n: 7 }, noSvcs)
    ).toBe('count=7');
  });

  it('multi-token: resolves multiple tokens in one string', () => {
    expect(
      applyTemplateConditionals(
        '{{inputs.a}}_{{inputs.b}}',
        { a: 'hello', b: 'world' },
        noSvcs
      )
    ).toBe('hello_world');
  });

  it('multi-token: missing reference resolves to empty string', () => {
    expect(
      applyTemplateConditionals('prefix_{{inputs.missing}}_suffix', {}, noSvcs)
    ).toBe('prefix__suffix');
  });

  it('multi-token: services ref resolves to "true"/"false" string', () => {
    expect(
      applyTemplateConditionals('svc={{services.torbox}}', {}, ['torbox'])
    ).toBe('svc=true');
  });

  // --- credential refs: {{services.X.Y}} ---

  it('sole token: services credential ref is preserved unchanged (service selected)', () => {
    expect(
      applyTemplateConditionals('{{services.torbox.apiKey}}', {}, ['torbox'])
    ).toBe('{{services.torbox.apiKey}}');
  });

  it('sole token: services credential ref is preserved unchanged (service NOT selected)', () => {
    expect(
      applyTemplateConditionals('{{services.torbox.apiKey}}', {}, [])
    ).toBe('{{services.torbox.apiKey}}');
  });

  it('multi-token: services credential ref is preserved inside a larger string', () => {
    expect(
      applyTemplateConditionals('key={{services.torbox.apiKey}}&other=1', {}, [
        'torbox',
      ])
    ).toBe('key={{services.torbox.apiKey}}&other=1');
  });

  it('sole token: services boolean ref (no credential) still returns boolean', () => {
    expect(
      applyTemplateConditionals('{{services.torbox}}', {}, ['torbox'])
    ).toBe(true);
    expect(applyTemplateConditionals('{{services.torbox}}', {}, [])).toBe(
      false
    );
  });

  it('object with credential ref field is preserved through full traversal', () => {
    // __if (without __value) is only evaluated for array items, so wrap in array.
    const config = [
      {
        __if: 'services.torbox',
        type: 'newznab',
        options: { apiKey: '{{services.torbox.apiKey}}' },
      },
    ];
    const result = applyTemplateConditionals(config, {}, ['torbox']);
    // __if passes (torbox selected), apiKey ref preserved for later resolution
    expect(result).toEqual([
      {
        type: 'newznab',
        options: { apiKey: '{{services.torbox.apiKey}}' },
      },
    ]);
  });

  it('credential ref inside a __switch case is preserved', () => {
    const config = {
      __switch: 'inputs.service',
      cases: {
        torbox: { apiKey: '{{services.torbox.apiKey}}' },
      },
      default: { apiKey: '' },
    };
    const result = applyTemplateConditionals(config, { service: 'torbox' }, [
      'torbox',
    ]);
    expect(result).toEqual({ apiKey: '{{services.torbox.apiKey}}' });
  });
}); // applyTemplateConditionals — interpolation

// ---------------------------------------------------------------------------
// applyTemplateConditionals — general traversal
// ---------------------------------------------------------------------------
describe('applyTemplateConditionals — general traversal', () => {
  const noSvcs: string[] = [];

  it('passes through primitives unchanged', () => {
    expect(applyTemplateConditionals(42, {}, noSvcs)).toBe(42);
    expect(applyTemplateConditionals(true, {}, noSvcs)).toBe(true);
    expect(applyTemplateConditionals(null, {}, noSvcs)).toBeNull();
  });

  it('walks object keys recursively', () => {
    const result = applyTemplateConditionals(
      {
        outer: {
          inner: '{{inputs.x}}',
        },
      },
      { x: 'resolved' },
      noSvcs
    );
    expect(result).toEqual({ outer: { inner: 'resolved' } });
  });

  it('handles deeply nested __if inside objects inside arrays', () => {
    const result = applyTemplateConditionals(
      {
        sections: [
          {
            items: [{ __if: 'inputs.show', label: '{{inputs.name}}' }],
          },
        ],
      },
      { show: true, name: 'Foo' },
      noSvcs
    );
    expect(result).toEqual({ sections: [{ items: [{ label: 'Foo' }] }] });
  });

  it('handles a realistic config slice', () => {
    const config = {
      preferredLanguages: ['{{inputs.languages}}', 'Original', 'Unknown'],
      excludedVisualTags: [
        '3D',
        { __if: 'inputs.excludeDV', __value: 'DV' },
        { __if: 'inputs.excludeHdr', __value: ['HDR', 'HDR10'] },
      ],
      formatter: {
        __switch: 'inputs.formatterStyle',
        cases: {
          custom: {
            id: 'custom',
            definition: { name: '{{inputs.formatterName}}' },
          },
        },
        default: { id: 'default' },
      },
      presets: [
        { type: 'always' },
        {
          __if: 'inputs.includeDebridio',
          type: 'debridio',
          options: { apiKey: '{{inputs.debridioKey}}' },
        },
      ],
    };

    const result = applyTemplateConditionals(
      config,
      {
        languages: ['French', 'German'],
        excludeDV: true,
        excludeHdr: false,
        formatterStyle: 'custom',
        formatterName: 'MyFormatter',
        includeDebridio: true,
        debridioKey: 'key123',
      },
      noSvcs
    );

    expect(result.preferredLanguages).toEqual([
      'French',
      'German',
      'Original',
      'Unknown',
    ]);
    expect(result.excludedVisualTags).toEqual(['3D', 'DV']);
    expect(result.formatter).toEqual({
      id: 'custom',
      definition: { name: 'MyFormatter' },
    });
    expect(result.presets).toEqual([
      { type: 'always' },
      { type: 'debridio', options: { apiKey: 'key123' } },
    ]);
  });

  it('passes through a plain number inside an array', () => {
    expect(applyTemplateConditionals([1, 2, 3], {}, noSvcs)).toEqual([1, 2, 3]);
  });

  it('sole {{}} token resolving to empty array spreads nothing into parent', () => {
    const result = applyTemplateConditionals(
      ['{{inputs.langs}}', 'Original'],
      { langs: [] },
      noSvcs
    );
    // Empty array spreads as nothing; only 'Original' remains
    expect(result).toEqual(['Original']);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — untested branches
// ---------------------------------------------------------------------------
describe('evaluateTemplateCondition — edge cases', () => {
  const noSvcs: string[] = [];

  it('returns false when condition has no dot (invalid form)', () => {
    // No dot means dotIdx === -1; function returns `negated` which is false
    expect(evaluateTemplateCondition('noDot', {}, noSvcs)).toBe(false);
  });

  it('negation returns true when condition has no dot', () => {
    expect(evaluateTemplateCondition('!noDot', {}, noSvcs)).toBe(true);
  });

  it('returns false for unknown namespace in bare form', () => {
    // ns is neither 'inputs' nor 'services' — result stays false
    expect(evaluateTemplateCondition('unknown.key', {}, noSvcs)).toBe(false);
  });

  it('negation of unknown namespace returns true', () => {
    expect(evaluateTemplateCondition('!unknown.key', {}, noSvcs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateTemplateCondition — compound operators (and / or / xor)
// ---------------------------------------------------------------------------
describe('evaluateTemplateCondition — and operator', () => {
  const noSvcs: string[] = [];

  it('true and true → true', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a and inputs.b',
        { a: true, b: true },
        noSvcs
      )
    ).toBe(true);
  });

  it('true and false → false', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a and inputs.b',
        { a: true, b: false },
        noSvcs
      )
    ).toBe(false);
  });

  it('false and true → false', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a and inputs.b',
        { a: false, b: true },
        noSvcs
      )
    ).toBe(false);
  });

  it('false and false → false', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a and inputs.b',
        { a: false, b: false },
        noSvcs
      )
    ).toBe(false);
  });

  it('three operands: all true → true', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a and inputs.b and inputs.c',
        { a: 1, b: 2, c: 3 },
        noSvcs
      )
    ).toBe(true);
  });

  it('three operands: one false → false', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a and inputs.b and inputs.c',
        { a: 1, b: false, c: 3 },
        noSvcs
      )
    ).toBe(false);
  });

  it('negated sub-expression: !inputs.a and inputs.b', () => {
    expect(
      evaluateTemplateCondition(
        '!inputs.a and inputs.b',
        { a: false, b: true },
        noSvcs
      )
    ).toBe(true);
    expect(
      evaluateTemplateCondition(
        '!inputs.a and inputs.b',
        { a: true, b: true },
        noSvcs
      )
    ).toBe(false);
  });

  it('works with operator sub-expressions: inputs.tier == pro and inputs.flag', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.tier == pro and inputs.flag',
        { tier: 'pro', flag: true },
        noSvcs
      )
    ).toBe(true);
    expect(
      evaluateTemplateCondition(
        'inputs.tier == pro and inputs.flag',
        { tier: 'pro', flag: false },
        noSvcs
      )
    ).toBe(false);
  });

  it('works with services sub-expressions', () => {
    expect(
      evaluateTemplateCondition(
        'services.torbox and inputs.flag',
        { flag: true },
        ['torbox']
      )
    ).toBe(true);
    expect(
      evaluateTemplateCondition(
        'services.torbox and inputs.flag',
        { flag: true },
        []
      )
    ).toBe(false);
  });
});

describe('evaluateTemplateCondition — or operator', () => {
  const noSvcs: string[] = [];

  it('true or false → true', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a or inputs.b',
        { a: true, b: false },
        noSvcs
      )
    ).toBe(true);
  });

  it('false or true → true', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a or inputs.b',
        { a: false, b: true },
        noSvcs
      )
    ).toBe(true);
  });

  it('false or false → false', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a or inputs.b',
        { a: false, b: false },
        noSvcs
      )
    ).toBe(false);
  });

  it('true or true → true', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a or inputs.b',
        { a: true, b: true },
        noSvcs
      )
    ).toBe(true);
  });

  it('three operands: all false → false', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a or inputs.b or inputs.c',
        { a: false, b: false, c: false },
        noSvcs
      )
    ).toBe(false);
  });

  it('three operands: one true → true', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a or inputs.b or inputs.c',
        { a: false, b: true, c: false },
        noSvcs
      )
    ).toBe(true);
  });

  it('works with == operator sub-expressions', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.tier == pro or inputs.tier == premium',
        { tier: 'premium' },
        noSvcs
      )
    ).toBe(true);
    expect(
      evaluateTemplateCondition(
        'inputs.tier == pro or inputs.tier == premium',
        { tier: 'basic' },
        noSvcs
      )
    ).toBe(false);
  });

  it('works with services', () => {
    expect(
      evaluateTemplateCondition('services.torbox or services.realdebrid', {}, [
        'realdebrid',
      ])
    ).toBe(true);
    expect(
      evaluateTemplateCondition(
        'services.torbox or services.realdebrid',
        {},
        []
      )
    ).toBe(false);
  });
});

describe('evaluateTemplateCondition — xor operator', () => {
  const noSvcs: string[] = [];

  it('true xor false → true', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a xor inputs.b',
        { a: true, b: false },
        noSvcs
      )
    ).toBe(true);
  });

  it('false xor true → true', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a xor inputs.b',
        { a: false, b: true },
        noSvcs
      )
    ).toBe(true);
  });

  it('true xor true → false (both true cancels out)', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a xor inputs.b',
        { a: true, b: true },
        noSvcs
      )
    ).toBe(false);
  });

  it('false xor false → false', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.a xor inputs.b',
        { a: false, b: false },
        noSvcs
      )
    ).toBe(false);
  });

  it('three operands: odd count of true → true', () => {
    // true xor true xor true → count=3 (odd) → true
    expect(
      evaluateTemplateCondition(
        'inputs.a xor inputs.b xor inputs.c',
        { a: true, b: true, c: true },
        noSvcs
      )
    ).toBe(true);
  });

  it('three operands: even count of true → false', () => {
    // true xor true xor false → count=2 (even) → false
    expect(
      evaluateTemplateCondition(
        'inputs.a xor inputs.b xor inputs.c',
        { a: true, b: true, c: false },
        noSvcs
      )
    ).toBe(false);
  });
});

describe('evaluateTemplateCondition — compound keywords inside operator values', () => {
  const noSvcs: string[] = [];

  it('== value containing " and " is not split as compound', () => {
    // "action and adventure" should be treated as the full rhs, not split
    expect(
      evaluateTemplateCondition(
        'inputs.genre == action and adventure',
        { genre: 'action and adventure' },
        noSvcs
      )
    ).toBe(true);
    // Should not match just "action"
    expect(
      evaluateTemplateCondition(
        'inputs.genre == action and adventure',
        { genre: 'action' },
        noSvcs
      )
    ).toBe(false);
  });

  it('== value containing " or " is not split as compound', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.title == foo or bar',
        { title: 'foo or bar' },
        noSvcs
      )
    ).toBe(true);
    expect(
      evaluateTemplateCondition(
        'inputs.title == foo or bar',
        { title: 'foo' },
        noSvcs
      )
    ).toBe(false);
  });

  it('includes value containing " or " is not split as compound', () => {
    // Checks if the array contains the literal string "foo or bar"
    expect(
      evaluateTemplateCondition(
        'inputs.tags includes foo or bar',
        { tags: ['foo or bar', 'baz'] },
        noSvcs
      )
    ).toBe(true);
    expect(
      evaluateTemplateCondition(
        'inputs.tags includes foo or bar',
        { tags: ['foo', 'bar'] },
        noSvcs
      )
    ).toBe(false);
  });

  it('!= value containing " and " is not split as compound', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.x != action and adventure',
        { x: 'something else' },
        noSvcs
      )
    ).toBe(true);
    expect(
      evaluateTemplateCondition(
        'inputs.x != action and adventure',
        { x: 'action and adventure' },
        noSvcs
      )
    ).toBe(false);
  });

  it('genuine compound after a value-with-keyword still works', () => {
    // "inputs.genre == action and adventure or inputs.flag"
    // Should split on " or " before "inputs.flag", giving:
    //   sub1: "inputs.genre == action and adventure" (value is "action and adventure")
    //   sub2: "inputs.flag"
    expect(
      evaluateTemplateCondition(
        'inputs.genre == action and adventure or inputs.flag',
        { genre: 'other', flag: true },
        noSvcs
      )
    ).toBe(true); // sub2 is true
    expect(
      evaluateTemplateCondition(
        'inputs.genre == action and adventure or inputs.flag',
        { genre: 'action and adventure', flag: false },
        noSvcs
      )
    ).toBe(true); // sub1 is true
    expect(
      evaluateTemplateCondition(
        'inputs.genre == action and adventure or inputs.flag',
        { genre: 'other', flag: false },
        noSvcs
      )
    ).toBe(false); // both false
  });
});

describe('evaluateTemplateCondition — compound operator precedence (or < xor < and)', () => {
  const noSvcs: string[] = [];

  it('and has higher precedence than or: a or b and c = a or (b and c)', () => {
    // a=false, b=true, c=true → false or (true and true) = true
    expect(
      evaluateTemplateCondition(
        'inputs.a or inputs.b and inputs.c',
        { a: false, b: true, c: true },
        noSvcs
      )
    ).toBe(true);
    // a=false, b=true, c=false → false or (true and false) = false
    expect(
      evaluateTemplateCondition(
        'inputs.a or inputs.b and inputs.c',
        { a: false, b: true, c: false },
        noSvcs
      )
    ).toBe(false);
  });

  it('and has higher precedence than xor: a xor b and c = a xor (b and c)', () => {
    // a=true, b=true, c=true → true xor (true and true) = true xor true = false
    expect(
      evaluateTemplateCondition(
        'inputs.a xor inputs.b and inputs.c',
        { a: true, b: true, c: true },
        noSvcs
      )
    ).toBe(false);
    // a=true, b=false, c=true → true xor (false and true) = true xor false = true
    expect(
      evaluateTemplateCondition(
        'inputs.a xor inputs.b and inputs.c',
        { a: true, b: false, c: true },
        noSvcs
      )
    ).toBe(true);
  });

  it('practical: (services.torbox or services.realdebrid) and inputs.premium', () => {
    // Use explicit `and` + `or`: torbox or realdebrid and inputs.premium
    // = torbox or (realdebrid and premium)
    // torbox=true, realdebrid=false, premium=false → true or false = true
    expect(
      evaluateTemplateCondition(
        'services.torbox or services.realdebrid and inputs.premium',
        { premium: false },
        ['torbox']
      )
    ).toBe(true);
    // torbox=false, realdebrid=true, premium=true → false or true = true
    expect(
      evaluateTemplateCondition(
        'services.torbox or services.realdebrid and inputs.premium',
        { premium: true },
        ['realdebrid']
      )
    ).toBe(true);
    // torbox=false, realdebrid=true, premium=false → false or false = false
    expect(
      evaluateTemplateCondition(
        'services.torbox or services.realdebrid and inputs.premium',
        { premium: false },
        ['realdebrid']
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateTemplateCondition — numeric comparison operators
// ---------------------------------------------------------------------------
describe('evaluateTemplateCondition — numeric comparison operators', () => {
  const noSvcs: string[] = [];

  it('>: true when value exceeds threshold', () => {
    expect(evaluateTemplateCondition('inputs.n > 5', { n: 6 }, noSvcs)).toBe(
      true
    );
  });

  it('>: false when value equals threshold', () => {
    expect(evaluateTemplateCondition('inputs.n > 5', { n: 5 }, noSvcs)).toBe(
      false
    );
  });

  it('>: false when value is below threshold', () => {
    expect(evaluateTemplateCondition('inputs.n > 5', { n: 4 }, noSvcs)).toBe(
      false
    );
  });

  it('>=: true when value equals threshold', () => {
    expect(evaluateTemplateCondition('inputs.n >= 5', { n: 5 }, noSvcs)).toBe(
      true
    );
  });

  it('>=: true when value exceeds threshold', () => {
    expect(evaluateTemplateCondition('inputs.n >= 5', { n: 10 }, noSvcs)).toBe(
      true
    );
  });

  it('>=: false when value is below threshold', () => {
    expect(evaluateTemplateCondition('inputs.n >= 5', { n: 4 }, noSvcs)).toBe(
      false
    );
  });

  it('<: true when value is below threshold', () => {
    expect(evaluateTemplateCondition('inputs.n < 10', { n: 9 }, noSvcs)).toBe(
      true
    );
  });

  it('<: false when value equals threshold', () => {
    expect(evaluateTemplateCondition('inputs.n < 10', { n: 10 }, noSvcs)).toBe(
      false
    );
  });

  it('<=: true when value equals threshold', () => {
    expect(evaluateTemplateCondition('inputs.n <= 10', { n: 10 }, noSvcs)).toBe(
      true
    );
  });

  it('<=: false when value exceeds threshold', () => {
    expect(evaluateTemplateCondition('inputs.n <= 10', { n: 11 }, noSvcs)).toBe(
      false
    );
  });

  it('negation: !inputs.n > 5 is true when n <= 5', () => {
    expect(evaluateTemplateCondition('!inputs.n > 5', { n: 3 }, noSvcs)).toBe(
      true
    );
    expect(evaluateTemplateCondition('!inputs.n > 5', { n: 6 }, noSvcs)).toBe(
      false
    );
  });

  it('works with decimal thresholds', () => {
    expect(
      evaluateTemplateCondition('inputs.ratio >= 1.5', { ratio: 1.6 }, noSvcs)
    ).toBe(true);
    expect(
      evaluateTemplateCondition('inputs.ratio >= 1.5', { ratio: 1.4 }, noSvcs)
    ).toBe(false);
  });

  it('works with negative thresholds', () => {
    expect(
      evaluateTemplateCondition('inputs.score > -1', { score: 0 }, noSvcs)
    ).toBe(true);
    expect(
      evaluateTemplateCondition('inputs.score > -1', { score: -2 }, noSvcs)
    ).toBe(false);
  });

  it('coerces string-valued number inputs', () => {
    // Number inputs from text fields may arrive as strings
    expect(
      evaluateTemplateCondition('inputs.limit >= 3', { limit: '5' }, noSvcs)
    ).toBe(true);
    expect(
      evaluateTemplateCondition('inputs.limit >= 3', { limit: '2' }, noSvcs)
    ).toBe(false);
  });

  it('returns false for non-numeric value (NaN guard)', () => {
    expect(
      evaluateTemplateCondition('inputs.n > 5', { n: 'hello' }, noSvcs)
    ).toBe(false);
  });

  it('returns false for undefined value', () => {
    expect(evaluateTemplateCondition('inputs.n > 5', {}, noSvcs)).toBe(false);
  });

  it('services.* with numeric operator returns false (not supported)', () => {
    // ns !== 'inputs' → result stays false
    expect(
      evaluateTemplateCondition('services.torbox > 0', {}, ['torbox'])
    ).toBe(false);
  });

  it('combined with and: inputs.n >= 1 and inputs.n <= 10 (range check)', () => {
    expect(
      evaluateTemplateCondition(
        'inputs.n >= 1 and inputs.n <= 10',
        { n: 5 },
        noSvcs
      )
    ).toBe(true);
    expect(
      evaluateTemplateCondition(
        'inputs.n >= 1 and inputs.n <= 10',
        { n: 0 },
        noSvcs
      )
    ).toBe(false);
    expect(
      evaluateTemplateCondition(
        'inputs.n >= 1 and inputs.n <= 10',
        { n: 11 },
        noSvcs
      )
    ).toBe(false);
  });

  it('numeric and + or: (A > 3 and A < 5) or B == torbox — and binds tighter than or', () => {
    // resultLimit=4 is in (3,5), service != torbox → true or false = true
    expect(
      evaluateTemplateCondition(
        'inputs.resultLimit > 3 and inputs.resultLimit < 5 or inputs.service == torbox',
        { resultLimit: 4, service: 'other' },
        noSvcs
      )
    ).toBe(true);

    // resultLimit=6 is NOT in (3,5), service == torbox → false or true = true
    expect(
      evaluateTemplateCondition(
        'inputs.resultLimit > 3 and inputs.resultLimit < 5 or inputs.service == torbox',
        { resultLimit: 6, service: 'torbox' },
        noSvcs
      )
    ).toBe(true);

    // resultLimit=6 is NOT in (3,5), service != torbox → false or false = false
    expect(
      evaluateTemplateCondition(
        'inputs.resultLimit > 3 and inputs.resultLimit < 5 or inputs.service == torbox',
        { resultLimit: 6, service: 'other' },
        noSvcs
      )
    ).toBe(false);

    // resultLimit=4 in (3,5), service == torbox → true or true = true
    expect(
      evaluateTemplateCondition(
        'inputs.resultLimit > 3 and inputs.resultLimit < 5 or inputs.service == torbox',
        { resultLimit: 4, service: 'torbox' },
        noSvcs
      )
    ).toBe(true);
  });

  it('or + numeric and: A == torbox or (B > 3 and B < 5) — same precedence rule from the other side', () => {
    // service == torbox → true, regardless of resultLimit
    expect(
      evaluateTemplateCondition(
        'inputs.service == torbox or inputs.resultLimit > 3 and inputs.resultLimit < 5',
        { service: 'torbox', resultLimit: 1 },
        noSvcs
      )
    ).toBe(true);

    // service != torbox, resultLimit=4 in (3,5) → false or true = true
    expect(
      evaluateTemplateCondition(
        'inputs.service == torbox or inputs.resultLimit > 3 and inputs.resultLimit < 5',
        { service: 'other', resultLimit: 4 },
        noSvcs
      )
    ).toBe(true);

    // service != torbox, resultLimit=2 NOT in (3,5) → false or false = false
    expect(
      evaluateTemplateCondition(
        'inputs.service == torbox or inputs.resultLimit > 3 and inputs.resultLimit < 5',
        { service: 'other', resultLimit: 2 },
        noSvcs
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyTemplateConditionals — compound operators in __if (end-to-end)
// ---------------------------------------------------------------------------
describe('applyTemplateConditionals — __if with compound operators', () => {
  const noSvcs: string[] = [];

  it('and: item included only when both conditions pass', () => {
    const result = applyTemplateConditionals(
      [
        {
          __if: 'inputs.flag and inputs.tier == pro',
          expression: 'pro-only',
          enabled: true,
        },
        { expression: 'always', enabled: true },
      ],
      { flag: true, tier: 'pro' },
      noSvcs
    );
    expect(result.map((e: any) => e.expression)).toEqual([
      'pro-only',
      'always',
    ]);

    const result2 = applyTemplateConditionals(
      [
        {
          __if: 'inputs.flag and inputs.tier == pro',
          expression: 'pro-only',
          enabled: true,
        },
        { expression: 'always', enabled: true },
      ],
      { flag: true, tier: 'basic' },
      noSvcs
    );
    expect(result2.map((e: any) => e.expression)).toEqual(['always']);
  });

  it('or: item included when either condition passes', () => {
    const result = applyTemplateConditionals(
      [
        {
          __if: 'services.torbox or services.realdebrid',
          type: 'debrid-preset',
          enabled: true,
        },
        { type: 'base', enabled: true },
      ],
      {},
      ['realdebrid']
    );
    expect(result.map((e: any) => e.type)).toEqual(['debrid-preset', 'base']);

    const result2 = applyTemplateConditionals(
      [
        {
          __if: 'services.torbox or services.realdebrid',
          type: 'debrid-preset',
          enabled: true,
        },
        { type: 'base', enabled: true },
      ],
      {},
      []
    );
    expect(result2.map((e: any) => e.type)).toEqual(['base']);
  });

  it('numeric range: inputs.n >= 1 and inputs.n <= 5', () => {
    const template = [
      {
        __if: 'inputs.n >= 1 and inputs.n <= 5',
        expression: 'in-range',
        enabled: true,
      },
      { expression: 'always', enabled: true },
    ];

    const inRange = applyTemplateConditionals(template, { n: 3 }, noSvcs);
    expect(inRange.map((e: any) => e.expression)).toEqual([
      'in-range',
      'always',
    ]);

    const outOfRange = applyTemplateConditionals(template, { n: 0 }, noSvcs);
    expect(outOfRange.map((e: any) => e.expression)).toEqual(['always']);
  });
});

describe('applyTemplateConditionals — __switch edge cases', () => {
  const noSvcs: string[] = [];

  it('uses default when resolved input is undefined (key becomes null)', () => {
    // inputs.missing is undefined → resolveRef returns undefined → key = null → default chosen
    const result = applyTemplateConditionals(
      {
        __switch: 'inputs.missing',
        cases: { pro: { id: 'pro' } },
        default: { id: 'fallback' },
      },
      {},
      noSvcs
    );
    expect(result).toEqual({ id: 'fallback' });
  });

  it('uses default when cases object is absent', () => {
    // No cases key → cases = {} → nothing matches → default
    const result = applyTemplateConditionals(
      {
        __switch: 'inputs.tier',
        default: { id: 'fallback' },
      },
      { tier: 'pro' },
      noSvcs
    );
    expect(result).toEqual({ id: 'fallback' });
  });

  it('resolves to null when both cases miss and default is absent', () => {
    const result = applyTemplateConditionals(
      { __switch: 'inputs.tier', cases: { pro: { id: 'pro' } } },
      { tier: 'basic' },
      noSvcs
    );
    expect(result).toBeNull();
  });

  it('__switch nested inside another __switch', () => {
    const result = applyTemplateConditionals(
      {
        __switch: 'inputs.outer',
        cases: {
          a: {
            __switch: 'inputs.inner',
            cases: { x: { label: 'ax' }, y: { label: 'ay' } },
            default: { label: 'a-default' },
          },
        },
        default: { label: 'outer-default' },
      },
      { outer: 'a', inner: 'x' },
      noSvcs
    );
    expect(result).toEqual({ label: 'ax' });
  });

  it('__switch inside an array item (via __if) is recursed', () => {
    const result = applyTemplateConditionals(
      [
        {
          __if: 'inputs.flag',
          widget: {
            __switch: 'inputs.style',
            cases: { compact: { size: 'sm' } },
            default: { size: 'lg' },
          },
        },
      ],
      { flag: true, style: 'compact' },
      noSvcs
    );
    expect(result).toEqual([{ widget: { size: 'sm' } }]);
  });
});

describe('applyTemplateConditionals — __value edge cases', () => {
  const noSvcs: string[] = [];

  it('__value with a {{}} token that resolves to an array is spread', () => {
    // sole token in __value string resolves to array → spread into parent
    const result = applyTemplateConditionals(
      [{ __if: 'inputs.flag', __value: '{{inputs.extras}}' }],
      { flag: true, extras: ['HDR', 'HDR10'] },
      noSvcs
    );
    expect(result).toEqual(['HDR', 'HDR10']);
  });

  it('__value with a {{}} token that resolves to a scalar is inserted as one item', () => {
    const result = applyTemplateConditionals(
      [{ __if: 'inputs.flag', __value: '{{inputs.tag}}' }],
      { flag: true, tag: 'DV' },
      noSvcs
    );
    expect(result).toEqual(['DV']);
  });

  it('unconditional __value with {{}} token resolving to array is spread', () => {
    const result = applyTemplateConditionals(
      [{ __value: '{{inputs.langs}}' }, 'Original'],
      { langs: ['French', 'German'] },
      noSvcs
    );
    expect(result).toEqual(['French', 'German', 'Original']);
  });

  it('__value order is preserved relative to static items', () => {
    const result = applyTemplateConditionals(
      [
        'A',
        { __if: 'inputs.x', __value: 'X' },
        'B',
        { __if: 'inputs.y', __value: 'Y' },
        'C',
      ],
      { x: true, y: true },
      noSvcs
    );
    expect(result).toEqual(['A', 'X', 'B', 'Y', 'C']);
  });
});

// ---------------------------------------------------------------------------
// preferredLanguages
// ---------------------------------------------------------------------------
describe('preferredLanguages multi-select spread', () => {
  const tail = ['Original', 'Dual Audio', 'Multi', 'Dubbed', 'Unknown'];
  const template = ['{{inputs.languages}}', ...tail];

  it('spreads multiple selected languages before the fixed tail', () => {
    const result = applyTemplateConditionals(
      template,
      { languages: ['French', 'German'] },
      []
    );
    expect(result).toEqual(['French', 'German', ...tail]);
  });

  it('spreads a single language before the tail', () => {
    const result = applyTemplateConditionals(
      template,
      { languages: ['English'] },
      []
    );
    expect(result).toEqual(['English', ...tail]);
  });

  it('empty selection produces only the fixed tail', () => {
    const result = applyTemplateConditionals(template, { languages: [] }, []);
    expect(result).toEqual(tail);
  });

  it('all supported languages spread correctly', () => {
    const all = [
      'English',
      'Japanese',
      'French',
      'German',
      'Spanish',
      'Italian',
      'Portuguese',
      'Korean',
      'Chinese',
      'Arabic',
      'Hindi',
      'Russian',
      'Dutch',
      'Turkish',
      'Polish',
      'Unknown',
    ];
    const result = applyTemplateConditionals(template, { languages: all }, []);
    expect(result.slice(0, all.length)).toEqual(all);
    expect(result.slice(all.length)).toEqual(tail);
  });
});

// ---------------------------------------------------------------------------
// optionalFilters multi-select → excludedStreamExpressions
// ---------------------------------------------------------------------------
describe('optionalFilters excludedStreamExpressions', () => {
  const eseSlice = [
    {
      __if: 'inputs.optionalFilters includes nzbOnly',
      expression: 'nzb-only',
      enabled: true,
    },
    {
      __if: 'inputs.optionalFilters includes dvOnlyNonRemux',
      expression: 'dv-only-non-remux',
      enabled: true,
    },
    {
      __if: 'inputs.torboxTier == nonPro',
      expression: 'tb-nonpro-200gb',
      enabled: true,
    },
    {
      __if: 'inputs.torboxTier == pro',
      expression: 'tb-pro-1tb',
      enabled: true,
    },
    {
      __if: 'inputs.optionalFilters includes bitrateHardcapMobile',
      expression: 'bitrate-hardcap',
      enabled: true,
    },
    { expression: 'synced-eses', enabled: true },
    {
      __if: 'inputs.resultLimit',
      expression: 'slice(streams, {{inputs.resultLimit}})',
      enabled: true,
    },
  ];

  it('no optional filters selected — only the always-on ESE is included', () => {
    const result = applyTemplateConditionals(
      eseSlice,
      { optionalFilters: [], torboxTier: 'none', resultLimit: undefined },
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0].expression).toBe('synced-eses');
  });

  it('nzbOnly filter enabled — only nzb-only and always-on', () => {
    const result = applyTemplateConditionals(
      eseSlice,
      {
        optionalFilters: ['nzbOnly'],
        torboxTier: 'none',
        resultLimit: undefined,
      },
      []
    );
    expect(result.map((e: any) => e.expression)).toEqual([
      'nzb-only',
      'synced-eses',
    ]);
  });

  it('dvOnlyNonRemux filter enabled', () => {
    const result = applyTemplateConditionals(
      eseSlice,
      {
        optionalFilters: ['dvOnlyNonRemux'],
        torboxTier: 'none',
        resultLimit: undefined,
      },
      []
    );
    expect(result.map((e: any) => e.expression)).toEqual([
      'dv-only-non-remux',
      'synced-eses',
    ]);
  });

  it('bitrateHardcapMobile enabled', () => {
    const result = applyTemplateConditionals(
      eseSlice,
      {
        optionalFilters: ['bitrateHardcapMobile'],
        torboxTier: 'none',
        resultLimit: undefined,
      },
      []
    );
    expect(result.map((e: any) => e.expression)).toEqual([
      'bitrate-hardcap',
      'synced-eses',
    ]);
  });

  it('multiple filters enabled simultaneously', () => {
    const result = applyTemplateConditionals(
      eseSlice,
      {
        optionalFilters: ['nzbOnly', 'dvOnlyNonRemux', 'bitrateHardcapMobile'],
        torboxTier: 'none',
        resultLimit: undefined,
      },
      []
    );
    expect(result.map((e: any) => e.expression)).toEqual([
      'nzb-only',
      'dv-only-non-remux',
      'bitrate-hardcap',
      'synced-eses',
    ]);
  });

  it('all optional filters plus all others enabled', () => {
    const result = applyTemplateConditionals(
      eseSlice,
      {
        optionalFilters: ['nzbOnly', 'dvOnlyNonRemux', 'bitrateHardcapMobile'],
        torboxTier: 'pro',
        resultLimit: 6,
      },
      []
    );
    expect(result.map((e: any) => e.expression)).toEqual([
      'nzb-only',
      'dv-only-non-remux',
      'tb-pro-1tb',
      'bitrate-hardcap',
      'synced-eses',
      'slice(streams, 6)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// torboxTier select → size cap ESEs
// ---------------------------------------------------------------------------
describe('torboxTier select', () => {
  const torboxEses = [
    {
      __if: 'inputs.torboxTier == nonPro',
      expression: 'tb-nonpro-200gb',
      enabled: true,
    },
    {
      __if: 'inputs.torboxTier == pro',
      expression: 'tb-pro-1tb',
      enabled: true,
    },
    { expression: 'always', enabled: true },
  ];

  it('none → no tier ESEs', () => {
    const result = applyTemplateConditionals(
      torboxEses,
      { torboxTier: 'none' },
      []
    );
    expect(result.map((e: any) => e.expression)).toEqual(['always']);
  });

  it('nonPro → 200 GB cap included', () => {
    const result = applyTemplateConditionals(
      torboxEses,
      { torboxTier: 'nonPro' },
      []
    );
    expect(result.map((e: any) => e.expression)).toEqual([
      'tb-nonpro-200gb',
      'always',
    ]);
  });

  it('pro → 1 TB cap included', () => {
    const result = applyTemplateConditionals(
      torboxEses,
      { torboxTier: 'pro' },
      []
    );
    expect(result.map((e: any) => e.expression)).toEqual([
      'tb-pro-1tb',
      'always',
    ]);
  });

  it('only one tier expression is ever included at a time', () => {
    const nonPro = applyTemplateConditionals(
      torboxEses,
      { torboxTier: 'nonPro' },
      []
    );
    const pro = applyTemplateConditionals(
      torboxEses,
      { torboxTier: 'pro' },
      []
    );
    expect(nonPro.some((e: any) => e.expression === 'tb-pro-1tb')).toBe(false);
    expect(pro.some((e: any) => e.expression === 'tb-nonpro-200gb')).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------------------
// resultLimit number input
// ---------------------------------------------------------------------------
describe('resultLimit number', () => {
  const sliceExpr = [
    { expression: 'base-expr', enabled: true },
    {
      __if: 'inputs.resultLimit',
      expression: 'slice(streams, {{inputs.resultLimit}})',
      enabled: true,
    },
  ];

  it('resultLimit 6 → slice expression included with value interpolated', () => {
    const result = applyTemplateConditionals(sliceExpr, { resultLimit: 6 }, []);
    expect(result).toHaveLength(2);
    expect(result[1].expression).toBe('slice(streams, 6)');
  });

  it('resultLimit 1 → interpolated correctly', () => {
    const result = applyTemplateConditionals(sliceExpr, { resultLimit: 1 }, []);
    expect(result[1].expression).toBe('slice(streams, 1)');
  });

  it('resultLimit undefined → slice excluded', () => {
    const result = applyTemplateConditionals(
      sliceExpr,
      { resultLimit: undefined },
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0].expression).toBe('base-expr');
  });

  it('resultLimit 0 → included (0 is truthy — an explicitly set number)', () => {
    // The bare-truthiness check only excludes undefined/null/''/ false/[].
    // Numeric 0 is treated as truthy so that an explicitly entered value of 0
    // still fires the condition (e.g. "slice 0" = unlimited, still a valid choice).
    const result = applyTemplateConditionals(sliceExpr, { resultLimit: 0 }, []);
    expect(result).toHaveLength(2);
    expect(result[1].expression).toBe('slice(streams, 0)');
  });

  it('resultLimit blank (empty string) → excluded', () => {
    const result = applyTemplateConditionals(
      sliceExpr,
      { resultLimit: '' },
      []
    );
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// languagePassthrough select (ISE)
// ---------------------------------------------------------------------------
describe('languagePassthrough ISE', () => {
  // The actual ISE expression from the template (simplified to keep the test readable)
  const iseSlice = [
    {
      __if: 'inputs.languagePassthrough != none',
      expression:
        "/*{{inputs.languagePassthrough}} Passthrough*/ passthrough(language(streams, '{{inputs.languagePassthrough}}'), 'title')",
      enabled: true,
    },
  ];

  it('"none" → no ISE included', () => {
    const result = applyTemplateConditionals(
      iseSlice,
      { languagePassthrough: 'none' },
      []
    );
    expect(result).toHaveLength(0);
  });

  it('"English" → ISE included with language interpolated', () => {
    const result = applyTemplateConditionals(
      iseSlice,
      { languagePassthrough: 'English' },
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0].expression).toContain('English Passthrough');
    expect(result[0].expression).toContain("'English'");
  });

  it('"Japanese" → ISE included with correct interpolation', () => {
    const result = applyTemplateConditionals(
      iseSlice,
      { languagePassthrough: 'Japanese' },
      []
    );
    expect(result[0].expression).toContain('Japanese Passthrough');
    expect(result[0].expression).toContain("'Japanese'");
  });

  it('"French" → ISE included', () => {
    const result = applyTemplateConditionals(
      iseSlice,
      { languagePassthrough: 'French' },
      []
    );
    expect(result[0].expression).toContain('French Passthrough');
  });

  it('undefined languagePassthrough → ISE included (undefined != "none" is true)', () => {
    // String(undefined ?? '') === '' which !== 'none' → condition passes
    // This is the documented edge case: a missing value is treated as '' which != 'none'
    const result = applyTemplateConditionals(iseSlice, {}, []);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// formatterVariant __switch
// ---------------------------------------------------------------------------
describe('formatterVariant __switch', () => {
  const formatterSwitch = {
    __switch: 'inputs.formatterVariant',
    cases: {
      default: {
        id: 'custom',
        definition: { name: 'clean-name', description: 'clean-desc' },
      },
      fullRse: {
        id: 'custom',
        definition: { name: 'full-name', description: 'full-desc' },
      },
    },
    default: { id: 'tamtaro' },
  };

  it('"default" variant → clean formatter', () => {
    const result = applyTemplateConditionals(
      { formatter: formatterSwitch },
      { formatterVariant: 'default' },
      []
    );
    expect(result.formatter.id).toBe('custom');
    expect(result.formatter.definition.name).toBe('clean-name');
  });

  it('"fullRse" variant → full RSE formatter', () => {
    const result = applyTemplateConditionals(
      { formatter: formatterSwitch },
      { formatterVariant: 'fullRse' },
      []
    );
    expect(result.formatter.id).toBe('custom');
    expect(result.formatter.definition.name).toBe('full-name');
  });

  it('unknown variant → falls to default { id: "tamtaro" }', () => {
    const result = applyTemplateConditionals(
      { formatter: formatterSwitch },
      { formatterVariant: 'unknown' },
      []
    );
    expect(result.formatter).toEqual({ id: 'tamtaro' });
  });

  it('missing formatterVariant → falls to default', () => {
    const result = applyTemplateConditionals(
      { formatter: formatterSwitch },
      {},
      []
    );
    expect(result.formatter).toEqual({ id: 'tamtaro' });
  });
});

// ---------------------------------------------------------------------------
// presets (includeDebridio boolean + services.torbox)
// ---------------------------------------------------------------------------
describe('presets conditional inclusion', () => {
  const presetsTemplate = [
    {
      type: 'seadex',
      instanceId: '326',
      enabled: true,
      options: { name: 'SeaDex' },
    },
    {
      __if: 'services.torbox',
      type: 'torbox-search',
      instanceId: '8ae',
      enabled: false,
      options: { name: 'Search' },
    },
    {
      type: 'torznab',
      instanceId: 'a08',
      enabled: true,
      options: { name: 'STorz' },
    },
    {
      __if: 'inputs.includeDebridio',
      type: 'debridio',
      instanceId: '911',
      enabled: true,
      options: {
        name: 'Debridio',
        debridioApiKey: '{{inputs.debridioApiKey}}',
      },
    },
    {
      type: 'comet',
      instanceId: 'b0f',
      enabled: true,
      options: { name: 'Comet' },
    },
  ];

  it('no torbox, no debridio → only always-on presets', () => {
    const result = applyTemplateConditionals(
      presetsTemplate,
      { includeDebridio: false },
      []
    );
    expect(result.map((p: any) => p.type)).toEqual([
      'seadex',
      'torznab',
      'comet',
    ]);
  });

  it('torbox service enabled → torbox-search included', () => {
    const result = applyTemplateConditionals(
      presetsTemplate,
      { includeDebridio: false },
      ['torbox']
    );
    expect(result.map((p: any) => p.type)).toEqual([
      'seadex',
      'torbox-search',
      'torznab',
      'comet',
    ]);
  });

  it('includeDebridio true → debridio preset included with API key', () => {
    const result = applyTemplateConditionals(
      presetsTemplate,
      { includeDebridio: true, debridioApiKey: 'my-api-key' },
      []
    );
    const debridio = result.find((p: any) => p.type === 'debridio');
    expect(debridio).toBeDefined();
    expect(debridio.options.debridioApiKey).toBe('my-api-key');
  });

  it('torbox + debridio both active → all presets present in order', () => {
    const result = applyTemplateConditionals(
      presetsTemplate,
      { includeDebridio: true, debridioApiKey: 'key' },
      ['torbox']
    );
    expect(result.map((p: any) => p.type)).toEqual([
      'seadex',
      'torbox-search',
      'torznab',
      'debridio',
      'comet',
    ]);
  });

  it('__if strips cleanly — no __if key on kept preset', () => {
    const result = applyTemplateConditionals(
      presetsTemplate,
      { includeDebridio: true, debridioApiKey: 'k' },
      ['torbox']
    );
    for (const preset of result) {
      expect(preset).not.toHaveProperty('__if');
    }
  });
});

// ---------------------------------------------------------------------------
// includedStreamExpressions (optionalFilters passthrough ISEs)
// ---------------------------------------------------------------------------
describe('includedStreamExpressions passthroughs', () => {
  const iseTemplate = [
    {
      __if: 'inputs.optionalFilters includes dvPassthrough',
      expression: 'dv-passthrough',
      enabled: true,
    },
    {
      __if: 'inputs.optionalFilters includes dvHdrPassthrough',
      expression: 'dvhdr-passthrough',
      enabled: true,
    },
    {
      __if: 'inputs.optionalFilters includes sdrPassthrough',
      expression: 'sdr-passthrough',
      enabled: true,
    },
    {
      __if: 'inputs.languagePassthrough != none',
      expression:
        '/*{{inputs.languagePassthrough}} Passthrough*/ passthrough()',
      enabled: true,
    },
  ];

  it('no filters, no language passthrough → empty', () => {
    const result = applyTemplateConditionals(
      iseTemplate,
      { optionalFilters: [], languagePassthrough: 'none' },
      []
    );
    expect(result).toHaveLength(0);
  });

  it('dvPassthrough only', () => {
    const result = applyTemplateConditionals(
      iseTemplate,
      { optionalFilters: ['dvPassthrough'], languagePassthrough: 'none' },
      []
    );
    expect(result.map((e: any) => e.expression)).toEqual(['dv-passthrough']);
  });

  it('all three passthroughs + language', () => {
    const result = applyTemplateConditionals(
      iseTemplate,
      {
        optionalFilters: [
          'dvPassthrough',
          'dvHdrPassthrough',
          'sdrPassthrough',
        ],
        languagePassthrough: 'English',
      },
      []
    );
    expect(result).toHaveLength(4);
    expect(result[3].expression).toContain('English Passthrough');
  });

  it('language passthrough expression interpolates both label and value', () => {
    const result = applyTemplateConditionals(
      iseTemplate,
      { optionalFilters: [], languagePassthrough: 'Korean' },
      []
    );
    expect(result[0].expression).toContain('Korean Passthrough');
  });
});

// ---------------------------------------------------------------------------
// full integration test
// ---------------------------------------------------------------------------
describe('full config integration', () => {
  const tamtaroConfig = {
    preferredLanguages: [
      '{{inputs.languages}}',
      'Original',
      'Dual Audio',
      'Multi',
      'Dubbed',
      'Unknown',
    ],
    excludedVisualTags: ['3D', 'H-OU', 'H-SBS', 'AI'],
    syncedRankedRegexUrls: [
      'https://raw.githubusercontent.com/Vidhin05/Releases-Regex/main/English/regexes.json',
    ],
    excludedStreamExpressions: [
      {
        __if: 'inputs.optionalFilters includes nzbOnly',
        expression: 'nzb-only',
        enabled: true,
      },
      {
        __if: 'inputs.optionalFilters includes dvOnlyNonRemux',
        expression: 'dv-only',
        enabled: true,
      },
      {
        __if: 'inputs.torboxTier == nonPro',
        expression: 'tb-200gb',
        enabled: true,
      },
      { __if: 'inputs.torboxTier == pro', expression: 'tb-1tb', enabled: true },
      {
        __if: 'inputs.optionalFilters includes bitrateHardcapMobile',
        expression: 'bitrate-cap',
        enabled: true,
      },
      { expression: 'synced-ese', enabled: true },
      {
        __if: 'inputs.resultLimit',
        expression: 'slice(streams, {{inputs.resultLimit}})',
        enabled: true,
      },
    ],
    includedStreamExpressions: [
      {
        __if: 'inputs.optionalFilters includes dvPassthrough',
        expression: 'dv-pass',
        enabled: true,
      },
      {
        __if: 'inputs.optionalFilters includes sdrPassthrough',
        expression: 'sdr-pass',
        enabled: true,
      },
      {
        __if: 'inputs.languagePassthrough != none',
        expression:
          '/*{{inputs.languagePassthrough}} Passthrough*/ passthrough()',
        enabled: true,
      },
    ],
    formatter: {
      __switch: 'inputs.formatterVariant',
      cases: {
        default: { id: 'custom', definition: { name: 'clean' } },
        fullRse: { id: 'custom', definition: { name: 'full' } },
      },
      default: { id: 'tamtaro' },
    },
    presets: [
      { type: 'seadex', enabled: true },
      { __if: 'services.torbox', type: 'torbox-search', enabled: false },
      {
        __if: 'inputs.includeDebridio',
        type: 'debridio',
        enabled: true,
        options: { debridioApiKey: '{{inputs.debridioApiKey}}' },
      },
      { type: 'comet', enabled: true },
    ],
    tmdbApiKey: '<template_placeholder>',
    rpdbApiKey: '<optional_template_placeholder>',
  };

  it('standard debrid user: English only, default formatter, no extras', () => {
    const result = applyTemplateConditionals(
      tamtaroConfig,
      {
        languages: ['English'],
        optionalFilters: [],
        torboxTier: 'none',
        resultLimit: undefined,
        languagePassthrough: 'none',
        formatterVariant: 'default',
        includeDebridio: false,
      },
      []
    );

    expect(result.preferredLanguages).toEqual([
      'English',
      'Original',
      'Dual Audio',
      'Multi',
      'Dubbed',
      'Unknown',
    ]);
    expect(result.excludedStreamExpressions).toHaveLength(1);
    expect(result.excludedStreamExpressions[0].expression).toBe('synced-ese');
    expect(result.includedStreamExpressions).toHaveLength(0);
    expect(result.formatter).toEqual({
      id: 'custom',
      definition: { name: 'clean' },
    });
    expect(result.presets.map((p: any) => p.type)).toEqual(['seadex', 'comet']);
    // Placeholders pass through unchanged
    expect(result.tmdbApiKey).toBe('<template_placeholder>');
    expect(result.rpdbApiKey).toBe('<optional_template_placeholder>');
  });

  it('power user: multi-language, torbox pro + nzbOnly, Japanese passthrough, fullRse, debridio', () => {
    const result = applyTemplateConditionals(
      tamtaroConfig,
      {
        languages: ['English', 'Japanese'],
        optionalFilters: ['nzbOnly', 'dvPassthrough'],
        torboxTier: 'pro',
        resultLimit: 6,
        languagePassthrough: 'Japanese',
        formatterVariant: 'fullRse',
        includeDebridio: true,
        debridioApiKey: 'deb-key-xyz',
      },
      ['torbox']
    );

    // Languages
    expect(result.preferredLanguages.slice(0, 2)).toEqual([
      'English',
      'Japanese',
    ]);
    expect(result.preferredLanguages).toContain('Original');

    // ESEs: nzb-only, tb-1tb, synced-ese, slice
    expect(
      result.excludedStreamExpressions.map((e: any) => e.expression)
    ).toEqual(['nzb-only', 'tb-1tb', 'synced-ese', 'slice(streams, 6)']);

    // ISEs: dvPassthrough + Japanese passthrough
    expect(result.includedStreamExpressions).toHaveLength(2);
    expect(result.includedStreamExpressions[0].expression).toBe('dv-pass');
    expect(result.includedStreamExpressions[1].expression).toContain(
      'Japanese Passthrough'
    );

    // Formatter
    expect(result.formatter).toEqual({
      id: 'custom',
      definition: { name: 'full' },
    });

    // Presets: seadex + torbox-search + debridio + comet
    expect(result.presets.map((p: any) => p.type)).toEqual([
      'seadex',
      'torbox-search',
      'debridio',
      'comet',
    ]);
    expect(
      result.presets.find((p: any) => p.type === 'debridio').options
        .debridioApiKey
    ).toBe('deb-key-xyz');
  });

  it('minimal setup: single language, no service, no extras, fallback formatter', () => {
    const result = applyTemplateConditionals(
      tamtaroConfig,
      {
        languages: ['French'],
        optionalFilters: [],
        torboxTier: 'none',
        resultLimit: undefined,
        languagePassthrough: 'none',
        formatterVariant: 'something-unknown',
        includeDebridio: false,
      },
      []
    );

    expect(result.preferredLanguages[0]).toBe('French');
    expect(result.excludedStreamExpressions).toHaveLength(1);
    expect(result.includedStreamExpressions).toHaveLength(0);
    expect(result.formatter).toEqual({ id: 'tamtaro' });
    expect(result.presets.map((p: any) => p.type)).toEqual(['seadex', 'comet']);
  });

  it('nonPro TorBox + all optional filters', () => {
    const result = applyTemplateConditionals(
      tamtaroConfig,
      {
        languages: ['English'],
        optionalFilters: ['nzbOnly', 'dvOnlyNonRemux', 'bitrateHardcapMobile'],
        torboxTier: 'nonPro',
        resultLimit: 10,
        languagePassthrough: 'none',
        formatterVariant: 'default',
        includeDebridio: false,
      },
      []
    );

    expect(
      result.excludedStreamExpressions.map((e: any) => e.expression)
    ).toEqual([
      'nzb-only',
      'dv-only',
      'tb-200gb',
      'bitrate-cap',
      'synced-ese',
      'slice(streams, 10)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// applyTemplateConditionals — __if + __value at the object-key level
// ---------------------------------------------------------------------------
describe('applyTemplateConditionals — __if + __value at object-key level', () => {
  const noSvcs: string[] = [];

  it('key is set to value when condition is true', () => {
    const result = applyTemplateConditionals(
      {
        formatter: { __if: 'inputs.useFormatter', __value: { id: 'tamtaro' } },
      },
      { useFormatter: true },
      noSvcs
    );
    expect(result).toEqual({ formatter: { id: 'tamtaro' } });
  });

  it('key is dropped entirely when condition is false', () => {
    const result = applyTemplateConditionals(
      {
        formatter: { __if: 'inputs.useFormatter', __value: { id: 'tamtaro' } },
      },
      { useFormatter: false },
      noSvcs
    );
    expect(result).toEqual({});
    expect('formatter' in result).toBe(false);
  });

  it('key is dropped when condition is false — does not become null or undefined', () => {
    const result = applyTemplateConditionals(
      {
        a: 1,
        b: { __if: 'inputs.flag', __value: 'hello' },
        c: 3,
      },
      { flag: false },
      noSvcs
    );
    expect(result).toEqual({ a: 1, c: 3 });
    expect('b' in result).toBe(false);
  });

  it('static keys alongside conditional key are always preserved', () => {
    const result = applyTemplateConditionals(
      {
        static1: 'always',
        conditional: { __if: 'inputs.flag', __value: 'yes' },
        static2: 42,
      },
      { flag: true },
      noSvcs
    );
    expect(result).toEqual({
      static1: 'always',
      conditional: 'yes',
      static2: 42,
    });
  });

  it('negated condition: key present when flag is false', () => {
    const result = applyTemplateConditionals(
      {
        formatter: { __if: '!inputs.retainFormatter', __value: { id: 'mine' } },
      },
      { retainFormatter: false },
      noSvcs
    );
    expect(result).toEqual({ formatter: { id: 'mine' } });
  });

  it('negated condition: key dropped when flag is true', () => {
    const result = applyTemplateConditionals(
      {
        formatter: { __if: '!inputs.retainFormatter', __value: { id: 'mine' } },
      },
      { retainFormatter: true },
      noSvcs
    );
    expect(result).toEqual({});
  });

  it('compound condition (and): key included only when both pass', () => {
    const cfg = {
      presets: {
        __if: 'inputs.flag and inputs.tier == pro',
        __value: ['a', 'b'],
      },
    };
    expect(
      applyTemplateConditionals(cfg, { flag: true, tier: 'pro' }, noSvcs)
    ).toEqual({ presets: ['a', 'b'] });
    expect(
      applyTemplateConditionals(cfg, { flag: true, tier: 'basic' }, noSvcs)
    ).toEqual({});
  });

  it('numeric condition: key included when value exceeds threshold', () => {
    const cfg = {
      extra: { __if: 'inputs.count > 5', __value: 'big' },
    };
    expect(applyTemplateConditionals(cfg, { count: 10 }, noSvcs)).toEqual({
      extra: 'big',
    });
    expect(applyTemplateConditionals(cfg, { count: 3 }, noSvcs)).toEqual({});
  });

  it('__value is recursed — array items with their own __if are processed', () => {
    const result = applyTemplateConditionals(
      {
        presets: {
          __if: 'inputs.include',
          __value: [{ __if: 'inputs.flag', type: 'a' }, { type: 'b' }],
        },
      },
      { include: true, flag: false },
      noSvcs
    );
    expect(result).toEqual({ presets: [{ type: 'b' }] });
  });

  it('{{}} interpolation works inside __value', () => {
    const result = applyTemplateConditionals(
      { label: { __if: 'inputs.show', __value: 'Hello {{inputs.name}}' } },
      { show: true, name: 'World' },
      noSvcs
    );
    expect(result).toEqual({ label: 'Hello World' });
  });

  it('multiple conditional keys in one object — each evaluated independently', () => {
    const result = applyTemplateConditionals(
      {
        a: { __if: 'inputs.showA', __value: 1 },
        b: { __if: 'inputs.showB', __value: 2 },
        c: { __if: 'inputs.showC', __value: 3 },
      },
      { showA: true, showB: false, showC: true },
      noSvcs
    );
    expect(result).toEqual({ a: 1, c: 3 });
  });

  it('service condition: key present when service selected', () => {
    const result = applyTemplateConditionals(
      {
        torboxOptions: { __if: 'services.torbox', __value: { tier: 'pro' } },
      },
      {},
      ['torbox']
    );
    expect(result).toEqual({ torboxOptions: { tier: 'pro' } });
  });

  it('service condition: key dropped when service not selected', () => {
    const result = applyTemplateConditionals(
      {
        torboxOptions: { __if: 'services.torbox', __value: { tier: 'pro' } },
      },
      {},
      []
    );
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// applyTemplateConditionals — __remove
// ---------------------------------------------------------------------------
describe('applyTemplateConditionals — __remove', () => {
  const noSvcs: string[] = [];

  it('__remove: true always drops the key', () => {
    const result = applyTemplateConditionals(
      { formatter: { __remove: true } },
      {},
      noSvcs
    );
    expect(result).toEqual({});
    expect('formatter' in result).toBe(false);
  });

  it('static keys alongside __remove are preserved', () => {
    const result = applyTemplateConditionals(
      { keep: 'yes', drop: { __remove: true }, alsoKeep: 42 },
      {},
      noSvcs
    );
    expect(result).toEqual({ keep: 'yes', alsoKeep: 42 });
  });

  it('multiple __remove keys — all dropped', () => {
    const result = applyTemplateConditionals(
      {
        a: { __remove: true },
        b: 'stays',
        c: { __remove: true },
      },
      {},
      noSvcs
    );
    expect(result).toEqual({ b: 'stays' });
  });

  it('__remove inside a __switch case — key is dropped when that case is chosen', () => {
    const result = applyTemplateConditionals(
      {
        formatter: {
          __switch: 'inputs.formatterChoice',
          cases: {
            retain: { __remove: true },
            tamtaro: { id: 'tamtaro' },
          },
          default: { id: 'prism' },
        },
      },
      { formatterChoice: 'retain' },
      noSvcs
    );
    expect(result).toEqual({});
    expect('formatter' in result).toBe(false);
  });

  it('__remove inside a __switch case — other cases still set the key', () => {
    const result = applyTemplateConditionals(
      {
        formatter: {
          __switch: 'inputs.formatterChoice',
          cases: {
            retain: { __remove: true },
            tamtaro: { id: 'tamtaro' },
          },
          default: { id: 'prism' },
        },
      },
      { formatterChoice: 'tamtaro' },
      noSvcs
    );
    expect(result).toEqual({ formatter: { id: 'tamtaro' } });
  });

  it('__remove in __switch default — key dropped when no case matches', () => {
    const result = applyTemplateConditionals(
      {
        formatter: {
          __switch: 'inputs.formatterChoice',
          cases: {
            tamtaro: { id: 'tamtaro' },
          },
          default: { __remove: true },
        },
      },
      { formatterChoice: 'unknown' },
      noSvcs
    );
    expect(result).toEqual({});
  });

  it('__remove: false does NOT remove the key (only true triggers removal)', () => {
    // __remove: false is treated as a plain object with __remove property
    const result = applyTemplateConditionals(
      { formatter: { __remove: false, id: 'prism' } },
      {},
      noSvcs
    );
    // Falls through to regular property loop — keeps both __remove and id
    expect(result.formatter).toEqual({ __remove: false, id: 'prism' });
  });
});

// ---------------------------------------------------------------------------
// Practical scenarios — conditional fields (includeAddons / retainFormatter)
// ---------------------------------------------------------------------------
describe('practical: conditional config fields via __if+__value and __remove', () => {
  const noSvcs: string[] = [];

  it('includeAddons=true → presets field is set to the addon list', () => {
    const result = applyTemplateConditionals(
      {
        presets: {
          __if: 'inputs.includeAddons',
          __value: [
            { type: 'torrentio', enabled: true },
            { __if: 'services.torbox', type: 'torbox-search', enabled: true },
          ],
        },
      },
      { includeAddons: true },
      ['torbox']
    );
    expect(result.presets).toEqual([
      { type: 'torrentio', enabled: true },
      { type: 'torbox-search', enabled: true },
    ]);
  });

  it('includeAddons=false → presets key is absent (user addons preserved)', () => {
    const result = applyTemplateConditionals(
      {
        presets: {
          __if: 'inputs.includeAddons',
          __value: [{ type: 'torrentio', enabled: true }],
        },
      },
      { includeAddons: false },
      noSvcs
    );
    expect('presets' in result).toBe(false);
  });

  it('retainFormatter=false → formatter key is set to template default', () => {
    const result = applyTemplateConditionals(
      {
        formatter: {
          __if: '!inputs.retainFormatter',
          __value: { id: 'tamtaro' },
        },
      },
      { retainFormatter: false },
      noSvcs
    );
    expect(result).toEqual({ formatter: { id: 'tamtaro' } });
  });

  it('retainFormatter=true → formatter key is absent (user formatter preserved)', () => {
    const result = applyTemplateConditionals(
      {
        formatter: {
          __if: '!inputs.retainFormatter',
          __value: { id: 'tamtaro' },
        },
      },
      { retainFormatter: true },
      noSvcs
    );
    expect('formatter' in result).toBe(false);
  });

  it('__switch with retain option removes the key, other choices set it', () => {
    const config = {
      formatter: {
        __switch: 'inputs.formatterChoice',
        cases: {
          retain: { __remove: true },
          default: { id: 'default-fmt' },
          custom: { id: 'custom-fmt' },
        },
        default: { id: 'fallback-fmt' },
      },
    };
    expect(
      applyTemplateConditionals(config, { formatterChoice: 'retain' }, noSvcs)
    ).toEqual({});
    expect(
      applyTemplateConditionals(config, { formatterChoice: 'default' }, noSvcs)
    ).toEqual({ formatter: { id: 'default-fmt' } });
    expect(
      applyTemplateConditionals(config, { formatterChoice: 'other' }, noSvcs)
    ).toEqual({ formatter: { id: 'fallback-fmt' } });
  });

  it('combined: both presets and formatter conditionally present', () => {
    const config = {
      formatter: {
        __if: '!inputs.retainFormatter',
        __value: { id: 'tamtaro' },
      },
      presets: {
        __if: 'inputs.includeAddons',
        __value: [{ type: 'comet' }],
      },
      alwaysHere: true,
    };

    // Both included
    expect(
      applyTemplateConditionals(
        config,
        { retainFormatter: false, includeAddons: true },
        noSvcs
      )
    ).toEqual({
      formatter: { id: 'tamtaro' },
      presets: [{ type: 'comet' }],
      alwaysHere: true,
    });

    // Both dropped
    expect(
      applyTemplateConditionals(
        config,
        { retainFormatter: true, includeAddons: false },
        noSvcs
      )
    ).toEqual({ alwaysHere: true });

    // Only formatter retained (drop formatter, include presets)
    const r3 = applyTemplateConditionals(
      config,
      { retainFormatter: true, includeAddons: true },
      noSvcs
    );
    expect('formatter' in r3).toBe(false);
    expect(r3.presets).toEqual([{ type: 'comet' }]);
  });
});

// ---------------------------------------------------------------------------
// sortCriteria — input-driven sort criteria
// ---------------------------------------------------------------------------

/**
 * Helpers — mirrors the Tamtaro sort criteria layout used in the real template.
 *
 * A sort-criteria entry is always:  { key: string, direction: "asc" | "desc" }
 *
 * Template structure:
 *   sortCriteria.cached  — ordered list of criteria applied to cached streams
 *   sortCriteria.uncached — ordered list of criteria applied to uncached streams
 *   sortCriteria.global  — prepended to every sub-list (e.g. "cached" gate)
 */

describe('sortCriteria — include / exclude library criterion', () => {
  const noSvcs: string[] = [];

  // Template fragment: the `cached` sort list includes `library` only when
  // the `includeLibrary` boolean input is true.
  const cachedCriteriaTemplate = [
    { key: 'resolution', direction: 'desc' },
    { key: 'quality', direction: 'desc' },
    {
      __if: 'inputs.includeLibrary',
      key: 'library',
      direction: 'desc',
    },
    { key: 'streamExpressionScore', direction: 'desc' },
    { key: 'bitrate', direction: 'desc' },
  ];

  it('includes library criterion when includeLibrary is true', () => {
    const result = applyTemplateConditionals(
      cachedCriteriaTemplate,
      { includeLibrary: true },
      noSvcs
    );
    expect(result).toEqual([
      { key: 'resolution', direction: 'desc' },
      { key: 'quality', direction: 'desc' },
      { key: 'library', direction: 'desc' },
      { key: 'streamExpressionScore', direction: 'desc' },
      { key: 'bitrate', direction: 'desc' },
    ]);
  });

  it('excludes library criterion when includeLibrary is false', () => {
    const result = applyTemplateConditionals(
      cachedCriteriaTemplate,
      { includeLibrary: false },
      noSvcs
    );
    expect(result).toEqual([
      { key: 'resolution', direction: 'desc' },
      { key: 'quality', direction: 'desc' },
      { key: 'streamExpressionScore', direction: 'desc' },
      { key: 'bitrate', direction: 'desc' },
    ]);
  });

  it('excludes library criterion when includeLibrary is absent (default-off)', () => {
    const result = applyTemplateConditionals(
      cachedCriteriaTemplate,
      {},
      noSvcs
    );
    const keys = result.map((c: any) => c.key);
    expect(keys).not.toContain('library');
    expect(keys).toContain('resolution');
    expect(keys).toContain('bitrate');
  });
});

describe('sortCriteria — de-prioritise library (move to end)', () => {
  const noSvcs: string[] = [];

  // Template: when `deprioritiseLibrary` is true the library criterion goes at
  // the bottom of the list (after bitrate/seeders); when false it sits in the
  // "normal" position, right after quality.
  const cachedTemplate = [
    { key: 'resolution', direction: 'desc' },
    { key: 'quality', direction: 'desc' },
    {
      __if: '!inputs.deprioritiseLibrary',
      key: 'library',
      direction: 'desc',
    },
    { key: 'streamExpressionScore', direction: 'desc' },
    { key: 'bitrate', direction: 'desc' },
    { key: 'seeders', direction: 'desc' },
    {
      __if: 'inputs.deprioritiseLibrary',
      key: 'library',
      direction: 'desc',
    },
  ];

  it('library is in normal position when deprioritiseLibrary is false', () => {
    const result = applyTemplateConditionals(
      cachedTemplate,
      { deprioritiseLibrary: false },
      noSvcs
    );
    const keys = result.map((c: any) => c.key);
    expect(keys).toEqual([
      'resolution',
      'quality',
      'library',
      'streamExpressionScore',
      'bitrate',
      'seeders',
    ]);
    // library must come BEFORE streamExpressionScore
    expect(keys.indexOf('library')).toBeLessThan(
      keys.indexOf('streamExpressionScore')
    );
  });

  it('library is moved to the end when deprioritiseLibrary is true', () => {
    const result = applyTemplateConditionals(
      cachedTemplate,
      { deprioritiseLibrary: true },
      noSvcs
    );
    const keys = result.map((c: any) => c.key);
    expect(keys).toEqual([
      'resolution',
      'quality',
      'streamExpressionScore',
      'bitrate',
      'seeders',
      'library',
    ]);
    // library must come AFTER seeders
    expect(keys.indexOf('library')).toBeGreaterThan(keys.indexOf('seeders'));
  });
});

describe('sortCriteria — sort direction driven by input', () => {
  const noSvcs: string[] = [];

  // Template: the user can choose whether seeders sort ascending (fewest first —
  // obscure torrents) or descending (most popular first).  Use __switch on a
  // select input: "desc" | "asc".
  const seedersCriterionTemplate = {
    key: 'seeders',
    direction: {
      __switch: 'inputs.seedersDirection',
      cases: { asc: 'asc', desc: 'desc' },
      default: 'desc',
    },
  };

  it('direction is desc when seedersDirection == desc', () => {
    const result = applyTemplateConditionals(
      seedersCriterionTemplate,
      { seedersDirection: 'desc' },
      noSvcs
    );
    expect(result).toEqual({ key: 'seeders', direction: 'desc' });
  });

  it('direction is asc when seedersDirection == asc', () => {
    const result = applyTemplateConditionals(
      seedersCriterionTemplate,
      { seedersDirection: 'asc' },
      noSvcs
    );
    expect(result).toEqual({ key: 'seeders', direction: 'asc' });
  });

  it('falls back to desc when seedersDirection is not set', () => {
    const result = applyTemplateConditionals(
      seedersCriterionTemplate,
      {},
      noSvcs
    );
    expect(result).toEqual({ key: 'seeders', direction: 'desc' });
  });
});

describe('sortCriteria — seadex criterion toggled by boolean input', () => {
  const noSvcs: string[] = [];

  const cachedTemplate = [
    {
      __if: 'inputs.enableSeadex',
      key: 'seadex',
      direction: 'desc',
    },
    { key: 'resolution', direction: 'desc' },
    { key: 'quality', direction: 'desc' },
    { key: 'streamExpressionScore', direction: 'desc' },
  ];

  it('seadex leads the list when enableSeadex is true', () => {
    const result = applyTemplateConditionals(
      cachedTemplate,
      { enableSeadex: true },
      noSvcs
    );
    const keys = result.map((c: any) => c.key);
    expect(keys[0]).toBe('seadex');
    expect(keys).toContain('resolution');
  });

  it('seadex is absent when enableSeadex is false', () => {
    const result = applyTemplateConditionals(
      cachedTemplate,
      { enableSeadex: false },
      noSvcs
    );
    const keys = result.map((c: any) => c.key);
    expect(keys).not.toContain('seadex');
    expect(keys[0]).toBe('resolution');
  });
});

describe('sortCriteria — full sortCriteria object with global + sub-lists', () => {
  const noSvcs: string[] = [];

  // Mirrors the real Tamtaro shape:
  //   global  — always [cached gate]
  //   cached  — full list, library + seadex toggled by inputs
  //   uncached — always [resolution, quality, seeders]
  const sortCriteriaTemplate = {
    global: [{ key: 'cached', direction: 'desc' }],
    cached: [
      {
        __if: 'inputs.enableSeadex',
        key: 'seadex',
        direction: 'desc',
      },
      { key: 'resolution', direction: 'desc' },
      { key: 'quality', direction: 'desc' },
      {
        __if: '!inputs.deprioritiseLibrary',
        key: 'library',
        direction: 'desc',
      },
      { key: 'streamExpressionMatched', direction: 'desc' },
      { key: 'streamExpressionScore', direction: 'desc' },
      { key: 'language', direction: 'desc' },
      { key: 'visualTag', direction: 'desc' },
      { key: 'audioTag', direction: 'desc' },
      { key: 'encode', direction: 'desc' },
      { key: 'bitrate', direction: 'desc' },
      { key: 'seeders', direction: 'desc' },
      {
        __if: 'inputs.deprioritiseLibrary',
        key: 'library',
        direction: 'desc',
      },
    ],
    uncached: [
      { key: 'resolution', direction: 'desc' },
      { key: 'quality', direction: 'desc' },
      { key: 'seeders', direction: 'desc' },
    ],
    series: [],
    anime: [],
  };

  it('default (seadex on, library normal position)', () => {
    const result = applyTemplateConditionals(
      sortCriteriaTemplate,
      { enableSeadex: true, deprioritiseLibrary: false },
      noSvcs
    );
    expect(result.global).toEqual([{ key: 'cached', direction: 'desc' }]);
    const cachedKeys = result.cached.map((c: any) => c.key);
    expect(cachedKeys[0]).toBe('seadex');
    expect(cachedKeys.indexOf('library')).toBeLessThan(
      cachedKeys.indexOf('streamExpressionMatched')
    );
    expect(result.uncached).toEqual([
      { key: 'resolution', direction: 'desc' },
      { key: 'quality', direction: 'desc' },
      { key: 'seeders', direction: 'desc' },
    ]);
  });

  it('seadex off, library de-prioritised', () => {
    const result = applyTemplateConditionals(
      sortCriteriaTemplate,
      { enableSeadex: false, deprioritiseLibrary: true },
      noSvcs
    );
    const cachedKeys = result.cached.map((c: any) => c.key);
    expect(cachedKeys).not.toContain('seadex');
    // library must be the last key in the cached list
    expect(cachedKeys[cachedKeys.length - 1]).toBe('library');
  });

  it('seadex off, library in normal position', () => {
    const result = applyTemplateConditionals(
      sortCriteriaTemplate,
      { enableSeadex: false, deprioritiseLibrary: false },
      noSvcs
    );
    const cachedKeys = result.cached.map((c: any) => c.key);
    expect(cachedKeys).not.toContain('seadex');
    expect(cachedKeys[0]).toBe('resolution');
    expect(cachedKeys.indexOf('library')).toBeLessThan(
      cachedKeys.indexOf('streamExpressionMatched')
    );
  });

  it('global and uncached lists are unaffected by any input', () => {
    for (const inputs of [
      { enableSeadex: true, deprioritiseLibrary: true },
      { enableSeadex: false, deprioritiseLibrary: false },
      {},
    ]) {
      const result = applyTemplateConditionals(
        sortCriteriaTemplate,
        inputs,
        noSvcs
      );
      expect(result.global).toEqual([{ key: 'cached', direction: 'desc' }]);
      expect(result.uncached).toEqual([
        { key: 'resolution', direction: 'desc' },
        { key: 'quality', direction: 'desc' },
        { key: 'seeders', direction: 'desc' },
      ]);
      expect(result.series).toEqual([]);
      expect(result.anime).toEqual([]);
    }
  });

  it('library appears exactly once regardless of input combination', () => {
    for (const deprioritiseLibrary of [true, false]) {
      const result = applyTemplateConditionals(
        sortCriteriaTemplate,
        { enableSeadex: true, deprioritiseLibrary },
        noSvcs
      );
      const libraryOccurrences = result.cached.filter(
        (c: any) => c.key === 'library'
      );
      expect(libraryOccurrences).toHaveLength(1);
    }
  });
});

describe('sortCriteria — service-gated criteria', () => {
  // Some sort keys (e.g. "cached") only make sense when a debrid service is
  // selected.  Model this with a services.* condition.

  const globalTemplate = [
    {
      __if: 'services.realdebrid or services.torbox or services.alldebrid',
      key: 'cached',
      direction: 'desc',
    },
    { key: 'resolution', direction: 'desc' },
    { key: 'quality', direction: 'desc' },
  ];

  it('cached criterion present when a debrid service is selected', () => {
    const result = applyTemplateConditionals(globalTemplate, {}, ['torbox']);
    const keys = result.map((c: any) => c.key);
    expect(keys).toContain('cached');
    expect(keys[0]).toBe('cached');
  });

  it('cached criterion absent when no debrid service is selected', () => {
    const result = applyTemplateConditionals(globalTemplate, {}, []);
    const keys = result.map((c: any) => c.key);
    expect(keys).not.toContain('cached');
    expect(keys[0]).toBe('resolution');
  });

  it('cached criterion present for realdebrid', () => {
    const result = applyTemplateConditionals(globalTemplate, {}, [
      'realdebrid',
    ]);
    expect(result[0]).toEqual({ key: 'cached', direction: 'desc' });
  });

  it('cached criterion present for alldebrid', () => {
    const result = applyTemplateConditionals(globalTemplate, {}, ['alldebrid']);
    expect(result[0]).toEqual({ key: 'cached', direction: 'desc' });
  });
});

describe('sortCriteria — prioritise language criterion via select input', () => {
  const noSvcs: string[] = [];

  // languagePriority: "top" → language sorts high (after seadex/resolution/quality),
  //                   "bottom" → language sorts at the bottom,
  //                   "none" → language criterion omitted entirely.
  const cachedTemplate = [
    { key: 'seadex', direction: 'desc' },
    { key: 'resolution', direction: 'desc' },
    { key: 'quality', direction: 'desc' },
    {
      __if: 'inputs.languagePriority == top',
      key: 'language',
      direction: 'desc',
    },
    { key: 'streamExpressionScore', direction: 'desc' },
    { key: 'bitrate', direction: 'desc' },
    { key: 'seeders', direction: 'desc' },
    {
      __if: 'inputs.languagePriority == bottom',
      key: 'language',
      direction: 'desc',
    },
  ];

  it('language is high-priority when languagePriority == top', () => {
    const result = applyTemplateConditionals(
      cachedTemplate,
      { languagePriority: 'top' },
      noSvcs
    );
    const keys = result.map((c: any) => c.key);
    expect(keys).toContain('language');
    expect(keys.indexOf('language')).toBeLessThan(
      keys.indexOf('streamExpressionScore')
    );
  });

  it('language is low-priority when languagePriority == bottom', () => {
    const result = applyTemplateConditionals(
      cachedTemplate,
      { languagePriority: 'bottom' },
      noSvcs
    );
    const keys = result.map((c: any) => c.key);
    expect(keys).toContain('language');
    expect(keys[keys.length - 1]).toBe('language');
  });

  it('language is omitted when languagePriority == none', () => {
    const result = applyTemplateConditionals(
      cachedTemplate,
      { languagePriority: 'none' },
      noSvcs
    );
    const keys = result.map((c: any) => c.key);
    expect(keys).not.toContain('language');
  });

  it('language appears exactly once for both top and bottom', () => {
    for (const prio of ['top', 'bottom']) {
      const result = applyTemplateConditionals(
        cachedTemplate,
        { languagePriority: prio },
        noSvcs
      );
      const count = result.filter((c: any) => c.key === 'language').length;
      expect(count).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveCredentialRefs
// ---------------------------------------------------------------------------
describe('resolveCredentialRefs', () => {
  // ---- string inputs -------------------------------------------------------

  it('replaces a single credential placeholder with the mapped value', () => {
    expect(
      resolveCredentialRefs('{{services.torbox.apiKey}}', {
        service_torbox_apiKey: 'MY_API_KEY',
      })
    ).toBe('MY_API_KEY');
  });

  it('replaces a placeholder embedded in a larger string', () => {
    expect(
      resolveCredentialRefs('key={{services.torbox.apiKey}}&extra=1', {
        service_torbox_apiKey: 'ABC123',
      })
    ).toBe('key=ABC123&extra=1');
  });

  it('replaces multiple placeholders in one string', () => {
    expect(
      resolveCredentialRefs(
        '{{services.torbox.apiKey}}:{{services.torbox.userId}}',
        { service_torbox_apiKey: 'K1', service_torbox_userId: 'U1' }
      )
    ).toBe('K1:U1');
  });

  it('replaces placeholders for different services in one string', () => {
    expect(
      resolveCredentialRefs(
        '{{services.torbox.apiKey}}/{{services.realdebrid.token}}',
        {
          service_torbox_apiKey: 'TB_KEY',
          service_realdebrid_token: 'RD_TOKEN',
        }
      )
    ).toBe('TB_KEY/RD_TOKEN');
  });

  it('uses empty string when credential key is missing from the map', () => {
    expect(resolveCredentialRefs('{{services.torbox.apiKey}}', {})).toBe('');
  });

  it('leaves unrelated text unchanged', () => {
    expect(
      resolveCredentialRefs('hello world', { service_torbox_apiKey: 'X' })
    ).toBe('hello world');
  });

  it('leaves non-credential {{inputs.*}} placeholders unchanged', () => {
    // resolveCredentialRefs only targets services.<id>.<key> refs
    expect(
      resolveCredentialRefs('{{inputs.someField}}', {
        service_torbox_apiKey: 'X',
      })
    ).toBe('{{inputs.someField}}');
  });

  it('returns primitives other than strings unchanged', () => {
    expect(resolveCredentialRefs(42, {})).toBe(42);
    expect(resolveCredentialRefs(true, {})).toBe(true);
    expect(resolveCredentialRefs(null, {})).toBeNull();
  });

  // ---- array inputs --------------------------------------------------------

  it('resolves placeholders inside each array element string', () => {
    const result = resolveCredentialRefs(
      ['{{services.torbox.apiKey}}', 'static', '{{services.torbox.userId}}'],
      { service_torbox_apiKey: 'K', service_torbox_userId: 'U' }
    );
    expect(result).toEqual(['K', 'static', 'U']);
  });

  it('recurses into nested arrays', () => {
    const result = resolveCredentialRefs([['{{services.torbox.apiKey}}']], {
      service_torbox_apiKey: 'NESTED',
    });
    expect(result).toEqual([['NESTED']]);
  });

  // ---- object inputs -------------------------------------------------------

  it('resolves a credential ref in an object field', () => {
    const obj = { apiKey: '{{services.torbox.apiKey}}', type: 'newznab' };
    const result = resolveCredentialRefs(obj, {
      service_torbox_apiKey: 'MY_KEY',
    });
    expect(result).toEqual({ apiKey: 'MY_KEY', type: 'newznab' });
  });

  it('mutates the object in place', () => {
    const obj = { apiKey: '{{services.torbox.apiKey}}' };
    resolveCredentialRefs(obj, { service_torbox_apiKey: 'MUTATED' });
    expect(obj.apiKey).toBe('MUTATED');
  });

  it('recurses into nested objects', () => {
    const obj = {
      presets: [
        {
          type: 'newznab',
          options: { apiKey: '{{services.torbox.apiKey}}', url: 'https://x' },
        },
      ],
    };
    resolveCredentialRefs(obj, { service_torbox_apiKey: 'DEEP_KEY' });
    expect(obj).toEqual({
      presets: [
        { type: 'newznab', options: { apiKey: 'DEEP_KEY', url: 'https://x' } },
      ],
    });
  });

  it('handles multiple services across a nested structure', () => {
    const obj = {
      a: { key: '{{services.torbox.apiKey}}' },
      b: { token: '{{services.realdebrid.token}}' },
    };
    resolveCredentialRefs(obj, {
      service_torbox_apiKey: 'TB',
      service_realdebrid_token: 'RD',
    });
    expect(obj).toEqual({ a: { key: 'TB' }, b: { token: 'RD' } });
  });

  it('leaves keys with no matching credential as empty string', () => {
    const obj = { apiKey: '{{services.torbox.apiKey}}', other: 'keep' };
    resolveCredentialRefs(obj, {});
    expect(obj).toEqual({ apiKey: '', other: 'keep' });
  });
});
