import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convertFlagToLanguage, getLanguagesAfterMarker } from './utils.js';

describe('convertFlagToLanguage', () => {
  it('maps a recognized flag to its language', () => {
    assert.equal(convertFlagToLanguage('🇬🇧'), 'English');
    assert.equal(convertFlagToLanguage('🇫🇷'), 'French');
  });

  it('returns undefined for a flag with no mapped language', () => {
    assert.equal(convertFlagToLanguage('🇦🇶'), undefined);
  });

  it('returns undefined for non-flag input', () => {
    assert.equal(convertFlagToLanguage('xx'), undefined);
  });
});

describe('getLanguagesAfterMarker', () => {
  it('returns undefined when the marker is not present', () => {
    assert.equal(getLanguagesAfterMarker('hello world', '🎙️'), undefined);
  });

  it('extracts languages for flags after the marker', () => {
    assert.deepEqual(getLanguagesAfterMarker('🎙️ 🇬🇧 🇫🇷 rest', '🎙️'), [
      'English',
      'French',
    ]);
  });

  it('handles non-space whitespace between flags', () => {
    assert.deepEqual(getLanguagesAfterMarker('🎙️ 🇬🇧\t\n🇫🇷 rest', '🎙️'), [
      'English',
      'French',
    ]);
  });

  it('returns an empty array when the marker is present but no flag maps to a language', () => {
    assert.deepEqual(getLanguagesAfterMarker('🎙️ 🇦🇶 rest', '🎙️'), []);
  });

  it('returns undefined for null or undefined text', () => {
    assert.equal(getLanguagesAfterMarker(null, '🎙️'), undefined);
    assert.equal(getLanguagesAfterMarker(undefined, '🎙️'), undefined);
  });

  it('escapes regex metacharacters in the indicator', () => {
    // unescaped '.' would wrongly match any character as a stand-in marker
    assert.equal(getLanguagesAfterMarker('x🇬🇧🇫🇷 rest', '.'), undefined);
    assert.deepEqual(getLanguagesAfterMarker('x.🇩🇪🇮🇹 rest', '.'), [
      'German',
      'Italian',
    ]);
  });
});
