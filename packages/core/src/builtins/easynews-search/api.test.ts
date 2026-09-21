import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EasynewsApi, type EasynewsSearchItem } from './api.js';
import FileParser from '../../parser/file.js';

describe('Easynews filename separators', () => {
  for (const fixture of [
    {
      input: 'Show Name S03 - 09',
      title: 'Show.Name.S03.-.09.mkv',
      seasons: [3],
      episodes: [9],
    },
    {
      input: 'Show Name S03-09',
      title: 'Show.Name.S03-09.mkv',
      seasons: [3, 4, 5, 6, 7, 8, 9],
      episodes: [],
    },
    {
      input: 'Show Name S03E09',
      title: 'Show.Name.S03E09.mkv',
      seasons: [3],
      episodes: [9],
    },
  ]) {
    it(fixture.input, () => {
      // Exercise the production result parser without an authenticated search.
      const api = new EasynewsApi('test', 'test') as unknown as {
        parseItem(raw: unknown): EasynewsSearchItem | null;
      };
      const item = api.parseItem({
        hash: 'test-hash',
        fn: fixture.input,
        ext: '.mkv',
        runtime: 1440,
      });
      assert.ok(item);
      assert.equal(item.title, fixture.title);
      const parsed = FileParser.parse(item.title);
      assert.deepEqual(parsed.seasons, fixture.seasons);
      assert.deepEqual(parsed.episodes ?? [], fixture.episodes);
    });
  }
});
