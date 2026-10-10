import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Initialise the package before the parser to avoid the config/variants cycle.
import '../index.js';
import { GroupConditionEvaluator, StreamSelector } from './streamExpression.js';
import FileParser from './file.js';
import { mergeParsedFiles, applySeasonPackHeuristics } from './merge.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import type { ExpressionContext } from '../streams/context.js';
import { StremioTransformer } from '../transformers/stremio.js';
import { settingsStore } from '../config/index.js';

class FixtureSelector extends StreamSelector {
  make(overrides: Partial<ParsedStream> = {}): ParsedStream {
    return this.createTestStream(overrides);
  }
}

function file(filename: string, folderName?: string): ParsedStream {
  const selector = new FixtureSelector({});
  const parsedFile = mergeParsedFiles(
    FileParser.parse(filename),
    folderName ? FileParser.parse(folderName) : undefined
  )!;
  return selector.make({ id: filename, filename, folderName, parsedFile });
}

async function selectedIds(
  context: ExpressionContext,
  streams: ParsedStream[],
  expression = 'notFirstEpisode(streams)'
): Promise<string[]> {
  const selector = new StreamSelector({ queryType: 'series', ...context });
  return (await selector.select(streams, expression)).map(
    (stream) => stream.id
  );
}

describe('notFirstEpisode', () => {
  const double = file('Show.S01E05-E06.mkv');
  const single = file('Show.S01E06.mkv');
  const startsHere = file('Show.S01E06-E07.mkv');

  it('selects a combined file only for an episode after its first', async () => {
    const streams = [double, single, startsHere];
    assert.deepEqual(await selectedIds({ episode: 5 }, streams), []);
    assert.deepEqual(await selectedIds({ episode: 6 }, streams), [double.id]);
    assert.deepEqual(await selectedIds({ episode: 8 }, streams), []);
  });

  it('detects combined files inside a season pack', async () => {
    const packed = file('Show.S01E05-E06.mkv', 'Show.S01.1080p');
    assert.equal(packed.parsedFile?.seasonPack, true);
    assert.deepEqual(await selectedIds({ episode: 5 }, [packed]), []);
    assert.deepEqual(await selectedIds({ episode: 6 }, [packed]), [packed.id]);
  });

  it('detects a combined file when size heuristics mark it as a pack', async () => {
    const packed = file('Show.S01E05-E06.mkv');
    applySeasonPackHeuristics(packed.parsedFile!, {
      size: 100,
      folderSize: 1000,
    });
    assert.equal(packed.parsedFile?.seasonPack, true);
    assert.deepEqual(await selectedIds({ episode: 6 }, [packed]), [packed.id]);
  });

  it('does not treat episode ranges inherited from a folder as one file', async () => {
    const obfuscated = file('a1b2c3.mkv', 'Show.S01E01-E10');
    const individual = file('Show.S01E06.mkv', 'Show.S01E01-E10');
    const seasonOnly = file('Show.S01.1080p');
    assert.deepEqual(
      await selectedIds({ episode: 6 }, [obfuscated, individual, seasonOnly]),
      []
    );
  });

  it('leaves a folder-only range alone when the selected filename is unknown', async () => {
    const folderName = 'Show.S01E05-E06';
    const folderOnly = {
      ...double,
      filename: undefined,
      folderName,
      parsedFile: FileParser.parse(folderName),
    };
    assert.equal(folderOnly.parsedFile.seasonPack, false);
    assert.deepEqual(await selectedIds({ episode: 6 }, [folderOnly]), []);
  });

  it('uses the lowest episode number regardless of parsed order', async () => {
    const reversed = {
      ...double,
      filename: undefined,
      parsedFile: { ...double.parsedFile!, episodes: [6, 5] },
    };
    assert.deepEqual(await selectedIds({ episode: 5 }, [reversed]), []);
    assert.deepEqual(await selectedIds({ episode: 6 }, [reversed]), [
      double.id,
    ]);
  });

  it('uses absolute and relative absolute request numbers', async () => {
    const absolute = file('Show.107-108.mkv');
    for (const key of ['absoluteEpisode', 'relativeAbsoluteEpisode'] as const) {
      assert.deepEqual(
        await selectedIds({ episode: 1, [key]: 107 }, [absolute]),
        []
      );
      assert.deepEqual(
        await selectedIds({ episode: 2, [key]: 108 }, [absolute]),
        [absolute.id]
      );
    }
  });

  it('leaves streams with missing or ambiguous file metadata alone', async () => {
    const unknown = { ...double, parsedFile: undefined, filename: undefined };
    const ambiguous = {
      ...double,
      filename: undefined,
      parsedFile: { ...double.parsedFile!, seasonPack: true },
    };
    assert.deepEqual(
      await selectedIds({ episode: 6 }, [unknown, ambiguous]),
      []
    );
  });

  it('matches nothing without a valid requested episode', async () => {
    for (const episode of [undefined, -1, 0, NaN, Infinity, 5.5]) {
      assert.deepEqual(await selectedIds({ episode }, [double]), []);
    }
    assert.deepEqual(await selectedIds({ queryType: 'movie' }, [double]), []);
    assert.equal(
      await new GroupConditionEvaluator([], [double], 0, 0, 'series').evaluate(
        'count(notFirstEpisode(totalStreams)) == 0'
      ),
      true
    );
  });

  it('composes with exclusion while retaining the single-episode alternative', async () => {
    assert.deepEqual(
      await selectedIds(
        { episode: 6 },
        [double, single],
        'negate(notFirstEpisode(streams), streams)'
      ),
      [single.id]
    );
  });

  it('rejects non-stream inputs', async () => {
    const selector = new StreamSelector({ queryType: 'series', episode: 6 });
    await assert.rejects(
      () => selector.select([], 'notFirstEpisode(1)'),
      /Your streams input must be an array of streams/
    );
  });

  it('passes save-time validation without episode context', async () => {
    assert.deepEqual(
      await StreamSelector.testSelect('notFirstEpisode(streams)'),
      []
    );
  });

  it('preserves autoplay after manually opening the later episode by default', async (t) => {
    // The transformer needs the addon id; avoid opening a settings database.
    const settings = settingsStore.current;
    t.mock.getter(settingsStore, 'current', () => ({
      ...settings,
      branding: { addonId: 'test.addon' } as typeof settings.branding,
    }));
    const userData = {
      formatter: { id: 'torrentio' },
      autoPlay: {
        enabled: true,
        method: 'matchingFile',
        attributes: ['addon'],
      },
    } as UserData;
    const transformer = new StremioTransformer(userData);
    const transform = (stream: ParsedStream, episode: number) =>
      transformer.transformStreams(
        {
          data: {
            streams: [
              {
                ...stream,
                addon: { ...stream.addon, formatPassthrough: true },
              },
            ],
            statistics: [],
          },
          errors: [],
        },
        { userData, episode, season: 1, queryType: 'series' }
      );
    const current = await transform(double, 6);
    const next = await transform(file('Show.S01E07.mkv'), 7);
    assert.equal(current.streams.length, 1);
    assert.ok(current.streams[0].behaviorHints?.bingeGroup);
    assert.equal(
      current.streams[0].behaviorHints?.bingeGroup,
      next.streams[0].behaviorHints?.bingeGroup
    );
  });
});
