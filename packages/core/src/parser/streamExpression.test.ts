import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Entry through the package root. Importing the parser file first hits a
// cycle: config -> variants -> this module, before the class exists.
import '../index.js';
import { StreamSelector } from './streamExpression.js';
import type { ParsedStream } from '../db/schemas.js';
import type { ExpressionContext } from '../streams/context.js';

class FixtureSelector extends StreamSelector {
  make(overrides: Partial<ParsedStream> = {}): ParsedStream {
    return this.createTestStream(overrides);
  }
}

type EpisodeSpec = {
  id: string;
  episodes?: number[];
  seasonPack?: boolean;
};

async function matchedIds(
  context: ExpressionContext,
  specs: EpisodeSpec[]
): Promise<string[]> {
  const selector = new FixtureSelector({
    queryType: 'series',
    ...context,
  });
  const streams = specs.map((spec) => {
    const base = selector.make();
    return selector.make({
      id: spec.id,
      parsedFile: {
        ...base.parsedFile!,
        episodes: spec.episodes,
        seasonPack: spec.seasonPack,
      },
    });
  });
  const selected = await selector.select(streams, 'notFirstEpisode(streams)');
  return selected.map((stream) => stream.id);
}

describe('notFirstEpisode', () => {
  it('drops a combined file only when the request is a later episode', async () => {
    assert.deepEqual(
      await matchedIds({ season: 1, episode: 6 }, [
        { id: 'pack', episodes: [5, 6] },
        { id: 'single', episodes: [6] },
        { id: 'starts-here', episodes: [6, 7] },
        { id: 'bare' },
      ]),
      ['pack']
    );
    assert.deepEqual(
      await matchedIds({ season: 1, episode: 5 }, [
        { id: 'pack', episodes: [5, 6] },
      ]),
      []
    );
  });

  it('uses the lowest episode number, not the order written in the name', async () => {
    assert.deepEqual(
      await matchedIds({ episode: 5 }, [{ id: 'reversed', episodes: [6, 5] }]),
      []
    );
    assert.deepEqual(
      await matchedIds({ episode: 6 }, [{ id: 'reversed', episodes: [6, 5] }]),
      ['reversed']
    );
  });

  it('treats absoluteEpisode as the requested episode too', async () => {
    assert.deepEqual(
      await matchedIds({ episode: 1, absoluteEpisode: 107 }, [
        { id: 'abs', episodes: [107, 108] },
      ]),
      []
    );
    assert.deepEqual(
      await matchedIds({ episode: 2, absoluteEpisode: 108 }, [
        { id: 'abs', episodes: [107, 108] },
      ]),
      ['abs']
    );
  });

  it('matches nothing for a movie and ignores season packs', async () => {
    assert.deepEqual(
      await matchedIds(
        { queryType: 'movie', episode: -1, absoluteEpisode: -1 },
        [{ id: 'pack', episodes: [5, 6] }]
      ),
      []
    );
    assert.deepEqual(
      await matchedIds({ episode: 6 }, [
        { id: 'season', episodes: [5, 6], seasonPack: true },
      ]),
      []
    );
  });

  it('rejects a value that is not a stream list', async () => {
    const selector = new FixtureSelector({ queryType: 'series', episode: 6 });
    await assert.rejects(
      () => selector.select([], 'notFirstEpisode(1)'),
      /Your streams input must be an array of streams/
    );
  });
});
