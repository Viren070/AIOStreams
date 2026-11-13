import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Use the normal core entry point to initialise the parser's dependency graph.
import '../index.js';
import StreamParser from './streams.js';

const parser = Object.create(StreamParser.prototype) as {
  convertISO6392ToLanguage: (code: string) => string | undefined;
};

describe('convertISO6392ToLanguage', () => {
  it('maps ISO 639-2/B codes to the same language as their T codes', () => {
    assert.equal(parser.convertISO6392ToLanguage('ger'), 'German');
    assert.equal(parser.convertISO6392ToLanguage('fre'), 'French');
    assert.equal(parser.convertISO6392ToLanguage('dut'), 'Dutch');
  });
});
