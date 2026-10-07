import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaInfo, normaliseParsedMediaInfo } from './media-info.js';

describe('parseMediaInfo', () => {
  it('confirms an empty language list rather than dropping it, when an audio track has no language tag', () => {
    const result = parseMediaInfo({ audio: [{ codec: 'eac3', ch: 6 }] });
    assert.deepEqual(result?.languages, []);
    assert.equal(result?.mediaInfoQuality, 'probe');
  });

  it('confirms an empty audio list rather than dropping it, when the probe reports no audio tracks at all', () => {
    const result = parseMediaInfo({ audio: [] });
    assert.deepEqual(result?.languages, []);
    assert.deepEqual(result?.audioTracks, []);
  });

  it('confirms an empty subtitle list rather than dropping it, when the probe reports no subtitle tracks at all', () => {
    const result = parseMediaInfo({ subtitle: [] });
    assert.deepEqual(result?.subtitles, []);
    assert.deepEqual(result?.subtitleTracks, []);
  });

  it('leaves visual tags unset when the probe has no video section at all', () => {
    const result = parseMediaInfo({ audio: [{ codec: 'aac', lang: 'eng' }] });
    assert.equal(result?.visualTags, undefined);
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

  it('keeps an explicitly empty track list as confirmed, not dropped', () => {
    const result = normaliseParsedMediaInfo({ audioTracks: [] });
    assert.deepEqual(result?.audioTracks, []);
  });

  it('returns undefined when nothing at all was given', () => {
    assert.equal(normaliseParsedMediaInfo({}), undefined);
  });
});
