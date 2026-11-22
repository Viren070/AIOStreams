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

  it('gives no file when the pack of seasons has several such episodes and no paths', async () => {
    const files = thronesFiles(() => undefined);
    assert.equal(await select(PACK, files, thrones(2, 13)), undefined);
  });

  it('gives no file when the pack of seasons lacks the season asked for', async () => {
    const files = thronesFiles((relative) => `/${relative}`).filter(
      (f) => f.index === 2 || f.index === 22
    );
    assert.equal(await select(PACK, files, thrones(2, 13)), undefined);
  });

  it('selects by air date among seasonless files of the same number', async () => {
    const files: DebridFile[] = [
      { index: 0, name: 'Show.2024.01.03.E03.mkv', size: 2e9 },
      { index: 1, name: 'Show.2025.01.03.E03.mkv', size: 1e9 },
    ];
    assert.equal(
      await select('Show S01-S02 1080p', files, {
        titles: ['Show'],
        season: 2,
        episode: 3,
        airDates: ['2025-01-03'],
      }),
      1
    );
  });

  it('keeps a file of a pack of seasons whose air date matches, whatever its season', async () => {
    const files: DebridFile[] = [
      { index: 0, name: 'The.Show.S2024E03.2024.01.03.1080p.mkv', size: 2e9 },
      { index: 1, name: 'The.Show.S2024E04.2024.01.04.1080p.mkv', size: 2e9 },
    ];
    assert.equal(
      await select('The Show S28-S29 1080p WEB', files, {
        titles: ['The Show'],
        season: 29,
        episode: 3,
        airDates: ['2024-01-03'],
        isDateBased: true,
      }),
      0
    );
  });

  it('keeps an absolutely numbered file in another season folder of a pack of seasons', async () => {
    const name = '[Grp] Show - 28 [1080p].mkv';
    const files: DebridFile[] = [
      { index: 0, name, path: `/Season 2/${name}`, size: 1e9 },
    ];
    assert.equal(
      await select('[Grp] Show S01-S03 (BD 1080p)', files, {
        titles: ['Show'],
        season: 3,
        episode: 3,
        absoluteEpisode: 28,
      }),
      0
    );
  });

  it('does not give the folder season to a file matched by its absolute number', async () => {
    const name = '[Grp] Show - 28 [1080p].mkv';
    const files: DebridFile[] = [
      { index: 0, name, path: `/Season 2/${name}`, size: 1e9 },
    ];
    assert.equal(
      await select('[Grp] Show S01-S03 (BD 1080p)', files, {
        titles: ['Show'],
        season: 3,
        episode: 3,
        absoluteEpisode: 28,
        tvdbSeason: 2,
        tvdbEpisode: 15,
      }),
      0
    );
  });

  it('keeps a file numbered within its split entry in another season folder of a pack of seasons', async () => {
    const name = '[Grp] Show - 15 [1080p].mkv';
    const files: DebridFile[] = [
      { index: 0, name, path: `/Season 2/${name}`, size: 1e9 },
    ];
    assert.equal(
      await select('[Grp] Show S01-S03 (BD 1080p)', files, {
        titles: ['Show'],
        season: 3,
        episode: 3,
        relativeAbsoluteEpisode: 15,
      }),
      0
    );
  });

  it('passes over a file of another season to the episode of a pack of seasons', async () => {
    const name = '[Grp] Show - 28 [1080p].mkv';
    const files: DebridFile[] = [
      { index: 0, name: 'Show.S01E03.1080p.mkv', size: 1e9 },
      { index: 1, name, path: `/Season 2/${name}`, size: 1e9 },
    ];
    assert.equal(
      await select('[Grp] Show S01-S03 (BD 1080p)', files, {
        titles: ['Show'],
        season: 3,
        episode: 3,
        absoluteEpisode: 28,
      }),
      1
    );
  });

  /** S03E03, absolute 28: the episode is in the folder of season 2. */
  const absolute28 = async (others: DebridFile[]) => {
    const name = '[Grp] Show - 28 [1080p].mkv';
    return select(
      '[Grp] Show S01-S03 (BD 1080p)',
      [
        { index: 0, name: 'Show.S01E03.1080p.mkv', size: 1e9 },
        ...others,
        { index: 9, name, path: `/Season 2/${name}`, size: 1e9 },
      ],
      { titles: ['Show'], season: 3, episode: 3, absoluteEpisode: 28 }
    );
  };

  it('passes over another episode with no season to the episode', async () => {
    const other = { index: 1, name: '[Grp] Show - 04 [1080p].mkv', size: 1e9 };
    assert.equal(await absolute28([other]), 9);
  });

  it('passes over ambiguous episodes with no season to the episode', async () => {
    const others = [1, 2].map((index) => ({
      index,
      name: `[Grp] Show - 03 v${index} [1080p].mkv`,
      size: 1e9,
    }));
    assert.equal(await absolute28(others), 9);
  });

  it('passes over ambiguous episodes that outscore it to the dated episode', async () => {
    const files: DebridFile[] = [
      { index: 0, name: 'Show.E03.v1.mkv', size: 2e9 },
      { index: 1, name: 'Show.E03.v2.mkv', size: 2e9 },
      { index: 2, name: 'Show.2025.01.03.mkv', size: 1e9 },
    ];
    assert.equal(
      await select('Show S01-S02 1080p', files, {
        titles: ['Show'],
        season: 2,
        episode: 3,
        airDates: ['2025-01-03'],
      }),
      2
    );
  });

  it('refuses a pack of thousands of episodes with no season in linear time', async () => {
    const files: DebridFile[] = Array.from({ length: 8000 }, (_, index) => ({
      index,
      name: `Show - 03 v${index}.mkv`,
      path: `/D${index}/Show - 03 v${index}.mkv`,
      size: 1e9,
    }));
    const metadata = { titles: ['Show'], season: 2, episode: 3 };
    const parsed = await parseFileNames(
      selectableFileNames('Show S01-S03', files)
    );
    const start = performance.now();
    const file = await selectFileInTorrentOrNZB(
      {
        title: 'Show S01-S03',
        hash: 'e74d01de',
        size: 0,
        type: 'torrent',
      } as any,
      { id: -1, status: 'cached', files },
      parsed,
      metadata
    );
    assert.equal(file, undefined);
    assert.ok(performance.now() - start < 2000);
  });

  it('passes over an extra in the season folder to the episode', async () => {
    const name = '[Grp] Show - 28 [1080p].mkv';
    const files: DebridFile[] = [
      { index: 0, name: 'Extras.mkv', path: '/Season 3/Extras.mkv', size: 1e9 },
      { index: 1, name, path: `/Season 2/${name}`, size: 1e9 },
    ];
    assert.equal(
      await select('[Grp] Show S01-S03 (BD 1080p)', files, {
        titles: ['Show'],
        season: 3,
        episode: 3,
        absoluteEpisode: 28,
      }),
      1
    );
  });

  it('gives no extra in place of a file of another season of a pack of seasons', async () => {
    const files = [
      ...thronesFiles((relative) => `/${relative}`).filter(
        (f) => f.index === 2 || f.index === 22
      ),
      {
        index: 80,
        name: 'Featurette.mkv',
        path: '/Extras/Featurette.mkv',
        size: 9e8,
      },
    ];
    assert.equal(await select(PACK, files, thrones(2, 13)), undefined);
  });

  it('selects by folder season in a pack of seasons whose files name no episode', async () => {
    for (const [one, two] of [
      [2e9, 1e9],
      [1e9, 2e9],
    ]) {
      const files: DebridFile[] = [
        { index: 0, name: 'Part One.mkv', path: '/S1/Part One.mkv', size: one },
        { index: 1, name: 'Part Two.mkv', path: '/S2/Part Two.mkv', size: two },
      ];
      for (const season of [1, 2]) {
        assert.equal(
          await select('Mini S01-S02', files, {
            titles: ['Mini'],
            season,
            episode: 1,
          }),
          season - 1
        );
      }
    }
  });

  it('does not check the season of a file in a release with no seasons named', async () => {
    const files: DebridFile[] = [
      { index: 0, name: 'Show.S01E05.1080p.mkv', size: 2e9 },
      { index: 1, name: 'Show.S01E06.1080p.mkv', size: 2e9 },
    ];
    assert.equal(
      await select('Show Complete 1080p', files, {
        titles: ['Show'],
        season: 14,
        episode: 5,
      }),
      0
    );
  });

  it('still selects the episode of a one-season pack without paths', async () => {
    const files = thronesFiles(() => undefined).filter((f) => f.index === 12);
    assert.equal(
      await select('Game of Thrones S02 2160p', files, thrones(2, 13)),
      12
    );
  });

  it('still selects an absolutely numbered episode in a pack of seasons', async () => {
    const files = animeFiles([1, 2, 13, 14]).map(({ path, ...file }) => file);
    assert.equal(
      await select('[Grp] Show S01-S02 [1080p]', files, {
        titles: ['Show'],
        season: 2,
        episode: 1,
        absoluteEpisode: 13,
      }),
      13
    );
  });
});
