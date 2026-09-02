import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertFlagToLanguage,
  getLanguagesAfterMarker,
  getRegexForTextAfterEmojis,
} from './utils.js';

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

describe('getRegexForTextAfterEmojis', () => {
  it('stops at a default-presentation emoji', () => {
    const re = getRegexForTextAfterEmojis(['🎞️']);
    assert.equal('🎞️ HEVC🎧 DD'.match(re)?.[1], 'HEVC');
  });

  it('stops at a text-presentation emoji forced via U+FE0F (e.g. gear)', () => {
    const re = getRegexForTextAfterEmojis(['🏷️']);
    assert.equal(
      '🏷️ Extended Edition ⚙️ GROUP'.match(re)?.[1].trim(),
      'Extended Edition'
    );
  });

  it('stops at end of string', () => {
    const re = getRegexForTextAfterEmojis(['🏷️']);
    assert.equal('🏷️ Extended Edition'.match(re)?.[1], 'Extended Edition');
  });

  it('stops at a newline', () => {
    const re = getRegexForTextAfterEmojis(['🏷️']);
    assert.equal(
      '🏷️ Extended Edition\n📄 movie.mkv'.match(re)?.[1],
      'Extended Edition'
    );
  });

  it('matches any of multiple given emojis', () => {
    const re = getRegexForTextAfterEmojis(['📄', '📁']);
    assert.equal('📄 file.mkv\n👤 5'.match(re)?.[1], 'file.mkv');
    assert.equal('📁 folder\n👤 5'.match(re)?.[1], 'folder');
  });

  it('does not bleed into the next line for a marker-only line', () => {
    const re = getRegexForTextAfterEmojis(['🏷️']);
    assert.equal('🏷️\n\nActual Text\n📄 movie.mkv'.match(re)?.[1], '');
  });

  it('does not leave a trailing \\r on CRLF input', () => {
    const re = getRegexForTextAfterEmojis(['🏷️']);
    assert.equal(
      '🏷️ Extended Edition\r\n📄 movie.mkv'.match(re)?.[1],
      'Extended Edition'
    );
  });

  it('stops at U+2028/U+2029 line terminators', () => {
    const re = getRegexForTextAfterEmojis(['🏷️']);
    assert.equal(
      '🏷️ Extended Edition Bonus Text\n📄 movie.mkv'.match(re)?.[1],
      'Extended Edition'
    );
    assert.equal(
      '🏷️ Extended Edition Bonus Text\n📄 movie.mkv'.match(re)?.[1],
      'Extended Edition'
    );
  });

  it('does not throw for an emoji containing regex metacharacters', () => {
    const re = getRegexForTextAfterEmojis(['*️⃣']);
    assert.equal(
      '*️⃣ Extended Edition\n📄 movie.mkv'.match(re)?.[1],
      'Extended Edition'
    );
  });
});
