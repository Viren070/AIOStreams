import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaInfo, normaliseParsedMediaInfo } from './media-info.js';

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

  it('leaves visual tags unset when the video section has no hdr info, rather than confirming "no HDR"', () => {
    const result = parseMediaInfo({
      video: { codec: 'hevc', w: 1920, h: 1080 },
    });
    assert.equal(result?.visualTags, undefined);
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

  it('derives languages, audio tags and channels from the track list when unset', () => {
    const result = normaliseParsedMediaInfo({
      audioTracks: [{ lang: 'eng', tags: ['DD+'], channels: '5.1' }],
    });
    assert.deepEqual(result?.languages, ['English']);
    assert.deepEqual(result?.audioTags, ['DD+']);
    assert.deepEqual(result?.audioChannels, ['5.1']);
  });

  it('returns undefined when nothing at all was given', () => {
    assert.equal(normaliseParsedMediaInfo({}), undefined);
  });
});
