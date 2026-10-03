import '../streams/filterer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import FileParser from './file.js';
import { reconcileEpisodeFilename } from './episode-filename.js';
import { mergeParsedFiles } from './merge.js';

const titles = ['Cowboy Bebop'];
const recover = (filename: string, folderName?: string) => {
  const parsed = mergeParsedFiles(
    FileParser.parse(filename),
    folderName ? FileParser.parse(folderName) : undefined
  )!;
  return {
    parsed,
    recovered: reconcileEpisodeFilename(parsed, filename, folderName, titles),
  };
};

describe('release-backed episode filename recovery', () => {
  it('recovers episode-only names with a matching folder, without inventing a year or season', () => {
    for (const filename of [
      'S01E02 - Stray Dog Strut.mkv',
      '02 - Stray Dog Strut.mkv',
      'Ep-02: Stray Dog Strut.mkv',
    ]) {
      const { recovered } = recover(filename, 'Cowboy Bebop');
      assert.equal(recovered.title, 'Cowboy Bebop');
      assert.equal(recovered.episodeTitle, 'Stray Dog Strut');
      assert.deepEqual(recovered.episodes, [2]);
      assert.equal(recovered.year, undefined);
      assert.deepEqual(
        recovered.seasons,
        filename.startsWith('S01') ? [1] : []
      );
    }
  });
  it('recovers numbered labels with a matching show prefix for any show', () => {
    const filename =
      '[CBM]_Cowboy_Bebop_-_Session_02_-_Stray_Dog_Strut_[720p]_[84AE25B6].mkv';
    const { recovered } = recover(filename);
    assert.equal(recovered.title, 'Cowboy Bebop');
    assert.equal(recovered.episodeTitle, 'Stray Dog Strut');
    assert.deepEqual(recovered.episodes, [2]);
    const other = 'Another Show - Episode 04 - The Long Journey.mkv';
    const result = reconcileEpisodeFilename(
      FileParser.parse(other),
      other,
      undefined,
      ['Another Show']
    );
    assert.equal(result.title, 'Another Show');
    assert.equal(result.episodeTitle, 'The Long Journey');
    assert.deepEqual(result.episodes, [4]);
  });
  it('uses explicit file coordinates instead of an inherited parent pack range', () => {
    const filename = 'Cowboy Bebop - Session 02 - Stray Dog Strut.mkv';
    const folder = 'Cowboy Bebop 1-26 Complete';
    const { parsed, recovered } = recover(filename, folder);
    assert.ok(
      parsed.episodes!.length > 1,
      'reproduce parent range inheritance'
    );
    assert.equal(recovered.title, 'Cowboy Bebop');
    assert.deepEqual(recovered.episodes, [2]);
    const wrong = recover(
      'Cowboy Bebop - Session 23 - Brain Scratch.mkv',
      folder
    ).recovered;
    assert.deepEqual(wrong.episodes, [23]);
    const conflict = { ...parsed, episodes: [8] };
    assert.equal(
      reconcileEpisodeFilename(conflict, filename, folder, titles),
      conflict
    );
  });
  it('does not manufacture show identity from a bare filename or unrelated folder', () => {
    for (const folder of [undefined, 'Other Show S01']) {
      const { parsed, recovered } = recover(
        'S01E02 - Stray Dog Strut.mkv',
        folder
      );
      assert.equal(recovered, parsed);
    }
    const { parsed, recovered } = recover(
      'Other Show - Session 02 - Stray Dog Strut.mkv',
      'Cowboy Bebop S01'
    );
    assert.equal(recovered, parsed);
  });
  it('preserves conflicting years, wrong episode numbers and ranges', () => {
    const { recovered } = recover(
      'S01E03 - Stray Dog Strut.mkv',
      'Cowboy Bebop 2021 S01'
    );
    assert.equal(recovered.year, '2021');
    assert.deepEqual(recovered.episodes, [3]);
    for (const filename of [
      'S01E02-E03 - Stray Dog Strut.mkv',
      '02-03 - Stray Dog Strut.mkv',
      'Session 02-03 - Stray Dog Strut.mkv',
      'Cowboy Bebop - Session 02 - S01E03 - Stray Dog Strut.mkv',
      '2021-02-03.mkv',
      'S00E02 - Stray Dog Strut.mkv',
    ]) {
      const { parsed, recovered } = recover(filename, 'Cowboy Bebop S01');
      assert.equal(recovered, parsed, filename);
    }
  });
});
