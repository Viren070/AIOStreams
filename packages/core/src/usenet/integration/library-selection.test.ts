import '../../parser/utils.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DebridFile, PlaybackInfo } from '../../debrid/base.js';
import { selectFileInTorrentOrNZB, type NZB } from '../../debrid/utils.js';
import { selectStreamFile, toDebridFiles } from './library.js';

const clicked = '[Seisenshi]_Legend_Of_DUO_02_-_.[892413EB].mkv';
const files = toDebridFiles([
  {
    name: '[Seisenshi]_Legend_Of_DUO_01_-_ [F481AAA2].mkv',
    path: 'Legend of Duo/[Seisenshi]_Legend_Of_DUO_01_-_ [F481AAA2].mkv',
    size: 31_527_631,
    index: 0,
    streamable: true,
  },
  {
    name: '[Seisenshi]_Legend_Of_DUO_02_-_ [892413EB].mkv',
    path: 'Legend of Duo/[Seisenshi]_Legend_Of_DUO_02_-_ [892413EB].mkv',
    size: 28_636_136,
    index: 1,
    streamable: true,
  },
  {
    name: '[Seisenshi]_Legend_Of_DUO_03_-_ [CDF931A9].mkv',
    path: 'Legend of Duo/[Seisenshi]_Legend_Of_DUO_03_-_ [CDF931A9].mkv',
    size: 31_394_436,
    index: 2,
    streamable: false,
  },
]);
const playback: PlaybackInfo & { type: 'usenet' } = {
  type: 'usenet',
  nzb: 'https://example.com/legend-of-duo.nzb',
  hash: 'legend-of-duo',
  filename: clicked,
  metadata: {
    titles: ['Legend of Duo'],
    season: 1,
    episode: 2,
    absoluteEpisode: 2,
  },
};
const packFiles: DebridFile[] = [
  { name: 'Legend of Duo S01E01.mkv', size: 31_527_631, index: 4 },
  { name: 'Legend of Duo S01E02.mkv', size: 28_636_136, index: 7 },
];

describe('native Usenet resolved-file selection', () => {
  it('preserves clicked E02 after an unseen NZB acquires inner files', async () => {
    const nzb: NZB = { ...playback, title: clicked, size: 100_000_000 };
    const placeholder = await selectFileInTorrentOrNZB(
      nzb,
      { id: playback.hash, status: 'cached' },
      new Map(),
      playback.metadata
    );
    assert.equal(placeholder?.index, -1);
    assert.equal(placeholder?.name, clicked);
    assert.equal(files.length, 2); // Incomplete E03 is not a playback target.
    const selected = await selectStreamFile(
      { ...playback, index: placeholder!.index, filename: placeholder!.name },
      clicked,
      files
    );
    assert.equal(selected, files[1]);
    assert.equal(selected?.path, files[1].path);
  });

  for (const index of [undefined, -1, 99]) {
    it(`matches clicked E02 when index is ${index}`, async () => {
      assert.equal(
        await selectStreamFile({ ...playback, index }, clicked, files),
        files[1]
      );
    });
  }

  it('keeps explicit fileIndex ahead of index, filename and metadata', async () => {
    assert.equal(
      await selectStreamFile(
        { ...playback, fileIndex: 0, index: 1 },
        clicked,
        files
      ),
      files[0]
    );
  });

  it('honours a real index by identity, not its position in the filtered list', async () => {
    assert.equal(
      await selectStreamFile({ ...playback, index: 4 }, clicked, packFiles),
      packFiles[0]
    );
  });

  it('tries index when an explicit fileIndex no longer exists', async () => {
    assert.equal(
      await selectStreamFile(
        { ...playback, fileIndex: 99, index: 0 },
        clicked,
        files
      ),
      files[0]
    );
  });

  it('uses the filename argument when playbackInfo has no filename', async () => {
    assert.equal(
      await selectStreamFile(
        { ...playback, filename: undefined },
        clicked,
        files
      ),
      files[1]
    );
  });

  it('compares basenames across paths and separator/case differences', async () => {
    const nested = files.map((file) => ({ ...file, name: file.path }));
    assert.equal(
      await selectStreamFile(
        { ...playback, filename: `Downloads\\${clicked.toLowerCase()}` },
        clicked,
        nested
      ),
      nested[1]
    );
  });

  for (const index of [undefined, -1, 99]) {
    it(`scores a season pack using metadata with index ${index}`, async () => {
      assert.equal(
        await selectStreamFile(
          { ...playback, index, filename: 'Legend of Duo S01 Complete' },
          'Legend of Duo S01 Complete',
          packFiles
        ),
        packFiles[1]
      );
    });
  }

  it('falls back to metadata when multiple basenames normalise to the clicked name', async () => {
    const ambiguous = [
      { ...files[1], name: `First/${clicked}`, index: 10 },
      { ...files[1], name: `Second/${files[1].name}`, index: 20 },
      packFiles[1],
    ];
    // Even one exact basename must not bypass the normalised ambiguity check.
    assert.equal(
      await selectStreamFile(playback, clicked, ambiguous),
      packFiles[1]
    );
  });

  it('does not give a stale fileIndex an array-position bonus during fallback', async () => {
    const candidates = files.map((file, i) => ({ ...file, index: 10 + i }));
    assert.equal(
      await selectStreamFile(
        { ...playback, filename: 'Legend of Duo Complete', fileIndex: 1 },
        'Legend of Duo Complete',
        candidates
      ),
      candidates[0]
    );
  });

  for (const filename of [
    clicked.replace('892413EB', '00000000'),
    clicked.replace('DUO_02', 'DUO_0_2'),
    clicked.replace('.mkv', '.avi'),
  ]) {
    it(`does not discard identifying tokens from ${filename}`, async () => {
      const candidates = [...files, packFiles[1]];
      assert.equal(
        await selectStreamFile({ ...playback, filename }, filename, candidates),
        packFiles[1]
      );
    });
  }

  it('retains the empty- and single-file shortcuts', async () => {
    assert.equal(await selectStreamFile(playback, clicked, []), undefined);
    assert.equal(
      await selectStreamFile(playback, clicked, [files[1]]),
      files[1]
    );
  });
});
