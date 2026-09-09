import '../parser/utils.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectFileInTorrentOrNZB } from './utils.js';
import type { ParsedResult } from '@viren070/parse-torrent-title';
import type { DebridDownload } from './base.js';

describe('entry-relative debrid file selection', () => {
  for (const [requested, suffix] of [
    [0, '00'],
    [4, '04'],
    [1.5, '1.5'],
    [1.5, '1.5v2'],
  ] as const) {
    it(`selects episode ${suffix} over a larger wrong episode`, async () => {
      const wrong = { name: 'Example Anime 105.mkv', size: 2000, index: 0 };
      const right = {
        name: `Example Anime ${suffix}.mkv`,
        size: 1000,
        index: 1,
      };
      const files = [wrong, right];
      const selected = await selectFileInTorrentOrNZB(
        { title: 'Example Anime', size: 3000 } as Parameters<
          typeof selectFileInTorrentOrNZB
        >[0],
        { files } as DebridDownload,
        new Map(
          files.map((file) => [
            file.name,
            { title: 'Example Anime' } as ParsedResult,
          ])
        ),
        {
          season: 2,
          episode: 44,
          relativeAbsoluteEpisode: requested,
          animeEntryTitles: ['Example Anime'],
        }
      );
      assert.equal(selected?.index, right.index);
    });
  }
  it('does not let a bare alias override explicit wrong episode information', async () => {
    const wrong = { name: 'Example Anime 04.mkv', size: 2000, index: 0 };
    const right = { name: 'Example Anime S02E44.mkv', size: 1000, index: 1 };
    const selected = await selectFileInTorrentOrNZB(
      { title: 'Example Anime', size: 3000 } as Parameters<
        typeof selectFileInTorrentOrNZB
      >[0],
      { files: [wrong, right] } as DebridDownload,
      new Map([
        [
          wrong.name,
          {
            title: 'Example Anime',
            seasons: [2],
            episodes: [45],
          } as ParsedResult,
        ],
        [
          right.name,
          {
            title: 'Example Anime',
            seasons: [2],
            episodes: [44],
          } as ParsedResult,
        ],
      ]),
      {
        season: 2,
        episode: 44,
        relativeAbsoluteEpisode: 4,
        animeEntryTitles: ['Example Anime'],
      }
    );
    assert.equal(selected?.index, right.index);
  });
});
