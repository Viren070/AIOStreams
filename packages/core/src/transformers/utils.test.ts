import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendLaterEpisodeMarker, type BingeRequest } from './binge-group.js';
import { generateBingeGroup } from './utils.js';
import type { ParsedStream, UserData } from '../db/schemas.js';

function stream(
  episodes: number[] | undefined,
  seasonPack = false
): ParsedStream {
  return {
    parsedFile: {
      episodes,
      seasonPack,
      resolution: '1080p',
      quality: 'WEB-DL',
      releaseGroup: 'GROUP',
      audioChannels: [],
      visualTags: [],
      audioTags: [],
      languages: [],
    },
  } as ParsedStream;
}

const base = 'addon|1080p|WEB-DL|GROUP';

function group(
  episodes: number[] | undefined,
  request?: BingeRequest,
  seasonPack = false
): string {
  return appendLaterEpisodeMarker(base, stream(episodes, seasonPack), request);
}

describe('generateBingeGroup combined files', () => {
  it('keeps the group of a combined file when the request is its first episode', () => {
    const start = group([5, 6], { episode: 5 });
    const single = group([6], { episode: 6 });
    assert.equal(start, single);
    assert.equal(start?.includes('laterEpisode'), false);
  });

  it('marks a later episode so autoplay does not select the same file', () => {
    const start = group([5, 6], { episode: 5 });
    const later = group([5, 6], { episode: 6 });
    const after = group([5, 6], { episode: 7 });
    assert.notEqual(later, start);
    assert.match(later ?? '', /\|laterEpisode:6$/);
    assert.match(after ?? '', /\|laterEpisode:7$/);
    assert.notEqual(later, after);
  });

  it('uses the lowest episode number when the name lists them backwards', () => {
    assert.equal(
      group([6, 5], { episode: 5 })?.includes('laterEpisode'),
      false
    );
    assert.match(group([6, 5], { episode: 6 }) ?? '', /\|laterEpisode:6$/);
  });

  it('treats an absolute number as the requested episode', () => {
    const file = [107, 108];
    assert.equal(
      group(file, { episode: 1, absoluteEpisode: 107 })?.includes(
        'laterEpisode'
      ),
      false
    );
    assert.match(
      group(file, { episode: 2, absoluteEpisode: 108 }) ?? '',
      /\|laterEpisode:2$/
    );
  });

  it('leaves season packs and requests without an episode unmarked', () => {
    const start = group([5, 6], { episode: 5 });
    assert.equal(group([5, 6], { episode: 6 }, true), start);
    assert.equal(group([5, 6]), start);
    assert.equal(group([6], { episode: 6 }), start);
  });

  it('returns nothing when autoplay is off', () => {
    const off = { autoPlay: { enabled: false } } as UserData;
    assert.equal(
      generateBingeGroup(stream([5, 6]), 0, off as UserData, { episode: 6 }),
      undefined
    );
  });
});
