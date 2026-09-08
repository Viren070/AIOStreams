import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import StreamDeduplicator from './deduplicator.js';
import type { ParsedStream, UserData } from '../db/schemas.js';

function makeStream(
  mediaInfoQuality: 'probe' | 'indexer' | 'addon' | undefined,
  languages: string[],
  subtitles: string[]
): ParsedStream {
  return {
    id: Math.random().toString(),
    type: 'p2p',
    parsedFile: {
      audioChannels: [],
      visualTags: [],
      audioTags: [],
      languages,
      subtitles,
      mediaInfoQuality,
    },
  } as unknown as ParsedStream;
}

// Access the private merge method directly to exercise it without
// standing up a full dedup grouping/winner-selection pipeline.
function merge(winner: ParsedStream, others: ParsedStream[]) {
  const dedup = new StreamDeduplicator({} as UserData) as unknown as {
    mergeLanguagesAndSubtitles: (
      winner: ParsedStream,
      others: ParsedStream[],
      fields: readonly string[]
    ) => void;
  };
  dedup.mergeLanguagesAndSubtitles(winner, others, ['languages', 'subtitles']);
}

describe('mergeLanguagesAndSubtitles', () => {
  it('takes only the probe, discarding the indexer entirely', () => {
    const winner = makeStream(undefined, [], []);
    const indexerOther = makeStream('indexer', ['English'], ['English']);
    const probeOther = makeStream('probe', ['French'], ['French']);
    merge(winner, [indexerOther, probeOther]);
    assert.deepEqual(winner.parsedFile?.languages, ['French']);
    assert.deepEqual(winner.parsedFile?.subtitles, ['French']);
    assert.equal(winner.parsedFile?.mediaInfoQuality, 'probe');
  });

  it('takes only the indexer, discarding the addon entirely', () => {
    const winner = makeStream(undefined, [], []);
    const indexerOther = makeStream('indexer', ['English'], ['English']);
    const addonOther = makeStream('addon', ['French'], ['French']);
    merge(winner, [indexerOther, addonOther]);
    assert.deepEqual(winner.parsedFile?.languages, ['English']);
    assert.deepEqual(winner.parsedFile?.subtitles, ['English']);
    assert.equal(winner.parsedFile?.mediaInfoQuality, 'indexer');
  });

  it('never lets a lower-tier other contaminate a winner already at the best tier', () => {
    const winner = makeStream('probe', ['English'], ['English']);
    const other = makeStream('addon', ['French'], ['French']);
    merge(winner, [other]);
    assert.deepEqual(winner.parsedFile?.languages, ['English']);
    assert.deepEqual(winner.parsedFile?.subtitles, ['English']);
    assert.equal(winner.parsedFile?.mediaInfoQuality, 'probe');
  });

  it('unions two sources that share the same tier', () => {
    const winner = makeStream('addon', ['English'], []);
    const other = makeStream('addon', ['French'], ['French']);
    merge(winner, [other]);
    assert.deepEqual(winner.parsedFile?.languages, ['English', 'French']);
    assert.deepEqual(winner.parsedFile?.subtitles, ['French']);
    assert.equal(winner.parsedFile?.mediaInfoQuality, 'addon');
  });

  it('falls back to merging everything when nobody has any tier', () => {
    const winner = makeStream(undefined, [], []);
    const other1 = makeStream(undefined, ['English'], []);
    const other2 = makeStream(undefined, ['French'], ['French']);
    merge(winner, [other1, other2]);
    assert.deepEqual(winner.parsedFile?.languages, ['English', 'French']);
    assert.deepEqual(winner.parsedFile?.subtitles, ['French']);
    assert.equal(winner.parsedFile?.mediaInfoQuality, undefined);
  });

  it('any real tier beats a source with no tier at all', () => {
    const winner = makeStream(undefined, [], []);
    const addonOther = makeStream('addon', ['English'], []);
    const unrankedOther = makeStream(undefined, ['French'], ['French']);
    merge(winner, [addonOther, unrankedOther]);
    assert.deepEqual(winner.parsedFile?.languages, ['English']);
    assert.deepEqual(winner.parsedFile?.subtitles, []);
    assert.equal(winner.parsedFile?.mediaInfoQuality, 'addon');
  });
});
