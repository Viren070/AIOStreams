import { describe, expect, it } from 'vitest';
import { IdParser, parseStremioCoordinate } from './id-parser.js';

describe('stremio coordinate parsing', () => {
  it('keeps season zero for Specials', () => {
    expect(parseStremioCoordinate('0')).toBe(0);
    expect(parseStremioCoordinate(0)).toBe(0);

    const parsed = IdParser.parse('tt5679720:0:1', 'series');
    expect(parsed?.season).toBe('0');
    expect(parsed?.episode).toBe('1');
  });

  it('rejects malformed coordinates instead of returning NaN', () => {
    expect(parseStremioCoordinate('*')).toBeUndefined();
    expect(parseStremioCoordinate('abc')).toBeUndefined();
    expect(parseStremioCoordinate('-1')).toBeUndefined();
  });
});
