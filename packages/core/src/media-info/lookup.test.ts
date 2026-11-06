import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
// Initialise the dependency graph in the same order as the server.
import '../index.js';
import { initialiseConfig } from '../config/index.js';
import { closeDb, initDb } from '../db/db.js';
import {
  MediaInfoRepository,
  type MediaInfoRow,
} from '../db/repositories/media-info.js';
import { CometPreset } from '../presets/comet.js';
import { TorrentioPreset } from '../presets/torrentio.js';
import type { StreamContext } from '../streams/context.js';
import { resolveStoredMediaInfo, storedMediaInfoFor } from './lookup.js';
import { MEDIA_INFO_VERSION, type MediaInfoRecord } from './record.js';

const title = 'The.Ogres.Bride.2026.Pk.WEB-DL.1080p';
const file = 'The.Ogres.Bride.2026.Pk.WEB-DL.1O8Op.mkv';
const info: MediaInfoRecord = {
  chapters: false,
  tracks: [
    { index: 0, type: 'video', codec: 'h264', width: 1920, height: 804 },
    { index: 1, type: 'audio', codec: 'aac', channels: 2 },
  ],
};

let directory: string;
let nextKey = 0;

before(async () => {
  directory = await mkdtemp('media-info-test-');
  await initDb(`sqlite://./${directory}/db.sqlite`);
  await initialiseConfig();
});

after(async () => {
  await closeDb();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function seed(reports: Partial<MediaInfoRow>[], kind = 'btih') {
  const hash = (++nextKey).toString(16).padStart(40, '0');
  const releaseKey = `${kind}:${hash}`;
  await MediaInfoRepository.upsert(
    reports.map((report) => ({
      releaseKey,
      file,
      origin: 'local',
      releaseFiles: 0,
      size: 6_930_229_510,
      info,
      version: MEDIA_INFO_VERSION,
      title,
      ...report,
    }))
  );
  return { hash, releaseKeys: [releaseKey], title, filename: title };
}

describe('stored media info file selection', () => {
  it('enriches Torrentio and Comet streams from the reported probe', async () => {
    const { hash } = await seed([{}]);
    const cases = [
      [TorrentioPreset, 'https://torrentio.strem.fun', undefined],
      [TorrentioPreset, 'https://torrentio.strem.fun', title],
      [CometPreset, 'https://comet.feels.legal', title],
    ] as const;
    const context = { getMetadata: async () => undefined } as StreamContext;
    for (const [preset, url, filename] of cases) {
      const Parser = preset.getParser();
      const parsed = new Parser({
        name: preset.METADATA.NAME,
        manifestUrl: `${url}/manifest.json`,
        enabled: true,
        preset: {
          id: preset.METADATA.ID,
          type: preset.METADATA.ID,
          options: {},
        },
      }).parse({
        name: '[TB+] Test',
        title: `${title}\n👤 0 💾 6.45 GB ⚙️ EXT`,
        url: `${url}/playback/${hash}/example`,
        behaviorHints: { filename },
      });
      assert.ok(!('skip' in parsed));
      assert.equal(parsed.torrent?.infoHash, hash);
      await resolveStoredMediaInfo([parsed], context);
      assert.equal(parsed.parsedFile?.mediaInfoQuality, 'probe');
      assert.deepEqual(parsed.parsedFile?.audioTags, ['AAC']);
    }
  });

  it('matches the complete video stem across separators, case and paths', async () => {
    const identity = await seed([
      { file: 'folder/THE_OGRES_BRIDE_2026_PK_WEB-DL_1080P.MKV' },
    ]);
    assert.deepEqual(await storedMediaInfoFor(identity, undefined), info);
  });

  it('refuses a title-only match for a stream with a file index', async () => {
    const identity = await seed([{}]);
    assert.equal(
      await storedMediaInfoFor({ ...identity, fileIdx: 0 }, undefined),
      undefined
    );
  });

  it('uses an exact file inside a pack and refuses an ambiguous basename', async () => {
    const identity = await seed([
      { file: `a/${file}`, releaseFiles: 2 },
      { file: `b/${file}`, releaseFiles: 2 },
    ]);
    assert.deepEqual(
      await storedMediaInfoFor({ ...identity, file: `b/${file}` }, undefined),
      info
    );
    assert.equal(
      await storedMediaInfoFor({ ...identity, file }, undefined),
      undefined
    );
  });

  it('refuses a title-only lookup when the inventory or reports show a pack', async () => {
    for (const reports of [
      [{ releaseFiles: 2 }],
      [{}, { file: 'Other.Cut.mkv' }],
      [{}, { origin: 'stremthru', releaseFiles: 2 }],
      [{ releaseFiles: 1 }, { file: 'Other.Cut.mkv' }],
    ]) {
      const identity = await seed(reports);
      assert.equal(await storedMediaInfoFor(identity, undefined), undefined);
    }
  });

  it('refuses a sample or a different stem even if the report repeats the title', async () => {
    for (const name of [
      'Sample.mkv',
      'The.Ogres.Bride.2026.Pk.WEB-DL.720p.mkv',
      `${title}.Director.Cut.mkv`,
      `${title}.txt`,
    ]) {
      const identity = await seed([{ file: name }]);
      assert.equal(await storedMediaInfoFor(identity, undefined), undefined);
    }
  });

  it('keeps the known single-feature fallback and respects an explicit file', async () => {
    const identity = await seed([{ releaseFiles: 1, file: 'Renamed.mkv' }]);
    assert.deepEqual(await storedMediaInfoFor(identity, undefined), info);
    assert.equal(
      await storedMediaInfoFor({ ...identity, file: 'Other.mkv' }, undefined),
      undefined
    );
  });

  it('does not substitute a different directory for an explicit path', async () => {
    const identity = await seed([{ file: `a/${file}` }]);
    assert.equal(
      await storedMediaInfoFor({ ...identity, file: `b/${file}` }, undefined),
      undefined
    );
  });

  it('keeps episode matching and never treats a different episode as the movie', async () => {
    const episode = { titles: ['Some Show'], season: 1, episode: 2 };
    const identity = await seed([
      { file: 'Some.Show.S01E02.mkv', releaseFiles: 2 },
    ]);
    assert.deepEqual(await storedMediaInfoFor(identity, episode), info);
    const unknown = await seed([{ file: 'Some.Show.S01E01.mkv' }]);
    const label = 'Some.Show.S01E01';
    assert.equal(
      await storedMediaInfoFor(
        { ...unknown, title: label, filename: label },
        episode
      ),
      undefined
    );
  });

  it('keeps Usenet on exact names and known file counts', async () => {
    const identity = await seed([{}], 'nh1');
    assert.equal(await storedMediaInfoFor(identity, undefined), undefined);
    assert.deepEqual(
      await storedMediaInfoFor({ ...identity, filename: file }, undefined),
      info
    );
    const single = await seed([{ releaseFiles: 1 }], 'nh1');
    assert.deepEqual(await storedMediaInfoFor(single, undefined), info);
  });
});
