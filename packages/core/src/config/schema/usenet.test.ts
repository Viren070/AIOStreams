import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Use the normal core entry point to initialise the logging/db dependency graph.
import '../../index.js';
import { usenetSchema } from './usenet.js';

const indexerAliases = usenetSchema.indexerAliases.schema;

describe('usenet.indexerAliases env form', () => {
  it('parses comma-separated rules', () => {
    assert.deepEqual(
      indexerAliases.parse('Ds:DrunkenSlug, drunkenslug.com:DrunkenSlug'),
      { Ds: 'DrunkenSlug', 'drunkenslug.com': 'DrunkenSlug' }
    );
  });

  it('splits on the last colon so a target may contain one', () => {
    assert.deepEqual(indexerAliases.parse('a:b:c'), { 'a:b': 'c' });
  });

  it('rejects a name given two targets', () => {
    // Assigning into the map would keep whichever came last, and the answer
    // would depend on the order the rules were typed in.
    assert.throws(() => indexerAliases.parse('DS:Alpha,DS:Beta'));
    assert.throws(() => indexerAliases.parse('DS:Alpha,ds:Beta'));
  });

  it('accepts a name repeated with the same target', () => {
    assert.deepEqual(indexerAliases.parse('DS:DrunkenSlug,ds:DrunkenSlug'), {
      DS: 'DrunkenSlug',
      ds: 'DrunkenSlug',
    });
  });

  it('rejects a malformed entry', () => {
    assert.throws(() => indexerAliases.parse('DrunkenSlug'));
  });

  it('treats an empty string as no rules', () => {
    assert.deepEqual(indexerAliases.parse(''), {});
  });
});
