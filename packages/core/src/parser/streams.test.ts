import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getRegexForTextAfterEmojis } from './utils.js';

describe('getRegexForTextAfterEmojis', () => {
  it('stops at a default-presentation emoji', () => {
    const re = getRegexForTextAfterEmojis(['🎞️']);
    assert.equal('🎞️ HEVC\n🎧 DD'.match(re)?.[1], 'HEVC');
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
});
