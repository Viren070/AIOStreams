import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaInfo, normaliseParsedMediaInfo } from './media-info.js';
import { layerMediaInfo } from '../media-info/apply.js';
import type { ParsedFile } from '../db/schemas.js';

function makeParsedFile(overrides: Partial<ParsedFile> = {}): ParsedFile {
  return {
    languages: [],
    subtitles: [],
    audioTags: [],
    audioChannels: [],
    visualTags: [],
    ...overrides,
  };
}

describe('parseMediaInfo', () => {
  it('returns undefined when there is nothing to probe', () => {
    assert.equal(parseMediaInfo({}), undefined);
    assert.equal(parseMediaInfo(null), undefined);
  });

  it('confirms an empty language list rather than dropping it, when an audio track has no language tag', () => {
    const result = parseMediaInfo({ audio: [{ codec: 'eac3', ch: 6 }] });
    assert.deepEqual(result?.languages, []);
    assert.equal(result?.mediaInfoQuality, 'probe');
  });

  it('reports real languages and subtitles for a typical probe', () => {
    const result = parseMediaInfo({
      audio: [{ codec: 'aac', lang: 'eng' }],
      subtitle: [{ lang: 'fre' }, { lang: 'spa' }],
    });
    assert.deepEqual(result?.languages, ['English']);
    assert.deepEqual(result?.subtitles, ['French', 'Spanish']);
    assert.equal(result?.mediaInfoQuality, 'probe');
  });
});

describe('normaliseParsedMediaInfo', () => {
  it('keeps an explicitly empty field as confirmed, not dropped', () => {
    const result = normaliseParsedMediaInfo({
      mediaInfoQuality: 'indexer',
      languages: [],
    });
    assert.deepEqual(result?.languages, []);
    assert.equal(result?.mediaInfoQuality, 'indexer');
  });

  it('drops a field the caller never set at all', () => {
    const result = normaliseParsedMediaInfo({ encode: 'HEVC' });
    assert.equal(result?.languages, undefined);
  });

  it('confirms languages via the track list even when the field itself is unset', () => {
    const result = normaliseParsedMediaInfo({ audioTracks: [{}] });
    assert.deepEqual(result?.languages, []);
  });

  it('returns undefined when nothing at all was given', () => {
    assert.equal(normaliseParsedMediaInfo({}), undefined);
  });
});

describe('layerMediaInfo', () => {
  it('lets a confirmed-empty probe overwrite a stale guessed value', () => {
    const stale = makeParsedFile({ languages: ['Turkish', 'German'] });
    const probe = parseMediaInfo({ audio: [{ codec: 'aac' }] }); // no lang tag
    const applied = layerMediaInfo(stale, probe);
    assert.deepEqual(applied?.languages, []);
  });

  it('leaves the existing value alone when the probe has no opinion at all', () => {
    const stale = makeParsedFile({ languages: ['English'] });
    const applied = layerMediaInfo(stale, parseMediaInfo({}));
    assert.deepEqual(applied?.languages, ['English']);
  });

  it('merges a typical real probe over an existing file', () => {
    const existing = makeParsedFile({ languages: ['English'] });
    const probe = parseMediaInfo({
      audio: [{ codec: 'aac', lang: 'eng' }],
      subtitle: [{ lang: 'fre' }],
    });
    const applied = layerMediaInfo(existing, probe);
    assert.deepEqual(applied?.languages, ['English']);
    assert.deepEqual(applied?.subtitles, ['French']);
    assert.equal(applied?.mediaInfoQuality, 'probe');
  });
});
