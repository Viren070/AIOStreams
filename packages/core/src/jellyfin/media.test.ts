import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMediaStreams } from './media.js';
import type { MediaSourceRecord } from './types.js';
import type { ParsedFile } from '../db/schemas.js';

function audioCodecs(parsed: Partial<ParsedFile>): (string | undefined)[] {
  const record = {
    msid: 'a',
    url: 'https://example.com/a.mkv',
    container: 'mkv',
    label: 'a',
    subtitles: [],
    live: false,
    parsedFile: {
      languages: [],
      subtitles: [],
      audioTags: [],
      audioChannels: [],
      visualTags: [],
      ...parsed,
    },
  } as unknown as MediaSourceRecord;
  return buildMediaStreams(record, {
    subtitleFormat: () => 'srt',
    subtitleUrl: () => '',
  } as unknown as Parameters<typeof buildMediaStreams>[1])
    .filter((s) => s.Type === 'Audio')
    .map((s) => s.Codec ?? undefined);
}

describe('audio codecs from release tags', () => {
  it('names no codec for Atmos alone, which TrueHD and DD+ both carry', () => {
    assert.deepEqual(audioCodecs({ audioTags: ['Atmos'] }), [undefined]);
  });

  it('takes the codec from the tag beside Atmos', () => {
    assert.deepEqual(audioCodecs({ audioTags: ['Atmos', 'DD+'] }), ['eac3']);
    assert.deepEqual(audioCodecs({ audioTags: ['Atmos', 'TrueHD'] }), [
      'truehd',
    ]);
  });

  it('keeps a plain codec tag', () => {
    assert.deepEqual(audioCodecs({ audioTags: ['DTS-HD MA'] }), ['dts']);
  });
});
