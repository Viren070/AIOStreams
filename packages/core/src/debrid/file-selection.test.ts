import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Load the core entry point first; the debrid services import each other.
import '../index.js';
import {
  parseFileNames,
  selectFileInTorrentOrNZB,
  selectableFileNames,
} from './utils.js';
import type { DebridFile, TitleMetadata } from './base.js';

// A LostFilm pack of Game of Thrones: the season is only in the folder, and of
// the episode 3 files the one of season 7 is the largest.
const PACK =
  'Игра Престолов / Game of Thrones (2011-2019) UHD BDRip [AV1/2160p-LQ] [4K, HDR, 10-bit] (сезон 1-8, серии 1-73 из 73) LostFilm';
const ROOT =
  'Игра Престолов (2011-2019) (сезон 1-8) UHD BDRip-AV1 2160p (HDR, 10-bit)';
const EPISODES: [number, string, number][] = [
  [2, 'S1/03 Lord Snow.mkv', 1737804913],
  [12, 'S2/03 What Is Dead May Never Die.mkv', 1362398353],
  [22, 'S3/03 Walk of Punishment.mkv', 1496735274],
  [32, 'S4/03 Breaker of Chains.mkv', 1095674268],
  [42, 'S5/03 High Sparrow.mkv', 1699898954],
  [52, 'S6/03 Oathbreaker.mkv', 1099212940],
  [62, "S7/03 The Queen's Justice.mkv", 1767981970],
  [69, 'S8/03 The Long Night.mkv', 1484968615],
];

const thrones = (season: number, absoluteEpisode: number): TitleMetadata => ({
  titles: ['Game of Thrones', 'Игра престолов'],
  year: 2011,
  season,
  episode: 3,
  absoluteEpisode,
});

/** The files as a debrid service lists them: the name alone, the path beside it. */
function thronesFiles(
  path: (relative: string) => string | undefined
): DebridFile[] {
  return EPISODES.map(([index, relative, size]) => ({
    index,
    name: relative.split('/').pop()!,
    path: path(relative),
    size,
  }));
}

/** An absolutely numbered anime pack, its episodes in folders of 12. */
function animeFiles(numbers: number[]): DebridFile[] {
  return numbers.map((n) => {
    const name = `[Grp] Show - ${String(n).padStart(2, '0')} [1080p].mkv`;
    const folder = n <= 12 ? '01-12' : '13-24';
    return { index: n, name, path: `/${folder}/${name}`, size: 1e9 + n };
  });
}

async function select(
  title: string,
  files: DebridFile[],
  metadata: TitleMetadata
) {
  const parsed = await parseFileNames(selectableFileNames(title, files));
  const file = await selectFileInTorrentOrNZB(
    { title, hash: 'e74d01de', size: 0, type: 'torrent' } as any,
    { id: -1, status: 'cached', files },
    parsed,
    metadata
  );
  return file?.index;
}

describe('selectFileInTorrentOrNZB, season in the folder only', () => {
  it('takes the season from the path StremThru gives', async () => {
    const files = thronesFiles((relative) => `/${relative}`);
    assert.equal(await select(PACK, files, thrones(2, 13)), 12);
    assert.equal(await select(PACK, files, thrones(7, 64)), 62);
    assert.equal(await select(PACK, files, thrones(8, 70)), 69);
    assert.equal(await select(PACK, files, thrones(1, 3)), 2);
  });

  it('takes the nearest folder of a torrent file path, under the root', async () => {
    const files = thronesFiles((relative) => `${ROOT}/${relative}`);
    assert.equal(await select(PACK, files, thrones(2, 13)), 12);
  });

  it('does not read a folder of episodes "13-24" as season 13', async () => {
    const show = { titles: ['Show'] };
    const files = animeFiles([1, 3, 12, 13, 15, 24]);
    assert.equal(
      await select('[Grp] Show S01 [1080p]', files, {
        ...show,
        season: 1,
        episode: 15,
        absoluteEpisode: 15,
      }),
      15
    );
    assert.equal(
      await select('[Grp] Show S01-S02 [1080p]', files, {
        ...show,
        season: 2,
        episode: 3,
        absoluteEpisode: 15,
      }),
      15
    );
  });
});
