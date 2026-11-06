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
import type { Stream } from '../db/schemas.js';
import { applyStoredMediaInfo, sourceRecordFrom } from '../jellyfin/media.js';
import { CometPreset } from '../presets/comet.js';
import { TorrentioPreset } from '../presets/torrentio.js';
import type { StreamContext } from '../streams/context.js';
import {
  resolveStoredMediaInfo,
  storedMediaInfoFor,
  type MediaInfoIdentity,
} from './lookup.js';
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

function parseDebrid(
  preset: typeof TorrentioPreset | typeof CometPreset,
  origin: string,
  stream: Stream
) {
  const Parser = preset.getParser();
  const parsed = new Parser({
    name: preset.METADATA.NAME,
    manifestUrl: `${origin}/manifest.json`,
    enabled: true,
    preset: { id: preset.METADATA.ID, type: preset.METADATA.ID, options: {} },
  }).parse(stream);
  assert.ok(!('skip' in parsed));
  return parsed;
}

function torrentioStream(hash: string, videoSize?: number) {
  const origin = 'https://torrentio.strem.fun';
  return parseDebrid(TorrentioPreset, origin, {
    name: '[TB+] Torrentio\n1080p',
    title: `${title}\n👤 0 💾 6.45 GB ⚙️ EXT`,
    url: `${origin}/resolve/torbox/fixture/${hash}/${title}/undefined/${title}`,
    behaviorHints: { videoSize },
  });
}

function context(type: string) {
  return { type, getMetadata: async () => undefined } as StreamContext;
}

function storedMovieInfo(identity: MediaInfoIdentity) {
  return storedMediaInfoFor(identity, undefined, true);
}

describe('stored media info file selection', () => {
  it('enriches Torrentio and Comet streams from the reported probe', async () => {
    const { hash } = await seed([{}]);
    const cases = [
      [TorrentioPreset, 'https://torrentio.strem.fun', undefined],
      [TorrentioPreset, 'https://torrentio.strem.fun', title],
      [CometPreset, 'https://comet.feels.legal', title],
    ] as const;
    for (const [preset, url, filename] of cases) {
      const parsed = parseDebrid(preset, url, {
        name: '[TB+] Test',
        title: `${title}\n👤 0 💾 6.45 GB ⚙️ EXT`,
        url: `${url}/playback/${hash}/example`,
        behaviorHints: { filename },
      });
      assert.equal(parsed.torrent?.infoHash, hash);
      await resolveStoredMediaInfo([parsed], context('movie'));
      assert.equal(parsed.parsedFile?.mediaInfoQuality, 'probe');
      assert.deepEqual(parsed.parsedFile?.audioTags, ['AAC']);
    }
  });

  it('checks the actual Torrentio URL shape and an advertised byte count', async () => {
    const { hash } = await seed([{}]);
    const rounded = torrentioStream(hash);
    const exact = torrentioStream(hash, 6_930_229_510);
    const different = torrentioStream(hash, 6_930_229_511);
    await resolveStoredMediaInfo([rounded, exact, different], context('movie'));
    assert.equal(rounded.parsedFile?.mediaInfoQuality, 'probe');
    assert.equal(exact.parsedFile?.mediaInfoQuality, 'probe');
    assert.notEqual(different.parsedFile?.mediaInfoQuality, 'probe');
  });

  it('requires a movie request for the unknown-count title match', async () => {
    for (const name of [file, title]) {
      const { hash } = await seed([{ file: name }]);
      const parsed = torrentioStream(hash);
      await resolveStoredMediaInfo([parsed], context('series'));
      assert.notEqual(parsed.parsedFile?.mediaInfoQuality, 'probe');
    }
  });

  it('keeps untrusted hashes and existing track lists out of the lookup', async () => {
    const { hash } = await seed([{}]);
    const custom = torrentioStream(hash);
    custom.addon = {
      ...custom.addon,
      manifestUrl: 'https://example.com/manifest.json',
    };
    const existing = torrentioStream(hash);
    assert.ok(existing.parsedFile);
    const parsedFile = {
      ...existing.parsedFile,
      audioTracks: [{ index: 1, codec: 'opus' }],
    };
    existing.parsedFile = parsedFile;
    await resolveStoredMediaInfo([custom, existing], context('movie'));
    assert.notEqual(custom.parsedFile?.mediaInfoQuality, 'probe');
    assert.equal(existing.parsedFile, parsedFile);
  });

  it('uses the same movie-only fallback on Jellyfin play', async () => {
    const { hash } = await seed([{}]);
    const stream = torrentioStream(hash);
    const record = sourceRecordFrom(
      'jellyfin-fixture',
      hash,
      stream,
      { name: 'Torrentio', description: '' },
      title,
      []
    );
    assert.equal(await applyStoredMediaInfo(record, undefined), false);
    assert.equal(
      await applyStoredMediaInfo(record, undefined, { movie: true }),
      true
    );
    assert.equal(record.extension.mediaInfoQuality, 'probe');
    assert.equal(record.extension.encode, 'AVC');
    assert.deepEqual(record.extension.audioTags, ['AAC']);
  });

  it('matches the complete video stem across separators, case and paths', async () => {
    const identity = await seed([
      { file: 'folder/THE_OGRES_BRIDE_2026_PK_WEB-DL_1080P.MKV' },
    ]);
    assert.deepEqual(await storedMovieInfo(identity), info);
  });

  it('refuses a title-only match for a stream with a file index', async () => {
    for (const name of [file, title]) {
      const identity = await seed([{ file: name }]);
      assert.equal(
        await storedMovieInfo({ ...identity, fileIdx: 0 }),
        undefined
      );
    }
  });

  it('uses an exact file inside a pack and refuses an ambiguous basename', async () => {
    const identity = await seed([
      { file: `a/${file}`, releaseFiles: 2 },
      { file: `b/${file}`, releaseFiles: 2 },
    ]);
    assert.deepEqual(
      await storedMovieInfo({ ...identity, file: `b/${file}`, fileIdx: 0 }),
      info
    );
    assert.equal(await storedMovieInfo({ ...identity, file }), undefined);
  });

  it('refuses a title-only lookup when the inventory or reports show a pack', async () => {
    for (const reports of [
      [{ releaseFiles: 2 }],
      [{}, { file: 'Other.Cut.mkv' }],
      [{}, { origin: 'stremthru', releaseFiles: 2 }],
      [{ releaseFiles: 1 }, { file: 'Other.Cut.mkv' }],
    ]) {
      const identity = await seed(reports);
      assert.equal(await storedMovieInfo(identity), undefined);
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
      assert.equal(await storedMovieInfo(identity), undefined);
    }
    const label = `${title}.Sample`;
    const sample = await seed([{ file: `${label}.mkv`, releaseFiles: 1 }]);
    assert.equal(
      await storedMovieInfo({ ...sample, title: label, filename: label }),
      undefined
    );
  });

  it('keeps the known single-feature fallback and respects an explicit file', async () => {
    const identity = await seed([{ releaseFiles: 1, file: 'Renamed.mkv' }]);
    assert.deepEqual(await storedMovieInfo(identity), info);
    assert.equal(
      await storedMovieInfo({ ...identity, file: 'Other.mkv' }),
      undefined
    );
  });

  it('does not substitute a different directory for an explicit path', async () => {
    const identity = await seed([{ file: `a/${file}` }]);
    assert.equal(
      await storedMovieInfo({ ...identity, file: `b/${file}` }),
      undefined
    );
  });

  it('does not fall through from an explicit torrent file to a different display name', async () => {
    const identity = await seed([{ releaseFiles: 2 }]);
    assert.equal(
      await storedMovieInfo({
        ...identity,
        file: 'Other.Cut.mkv',
        filename: file,
      }),
      undefined
    );
    const extensionless = await seed([{ file: 'ActualFile' }]);
    assert.deepEqual(
      await storedMovieInfo({ ...extensionless, file: 'ActualFile' }),
      info
    );
  });

  it('keeps episode matching and never treats a different episode as the movie', async () => {
    const episode = { titles: ['Some Show'], season: 1, episode: 2 };
    const identity = await seed([
      { file: 'Some.Show.S01E02.mkv', releaseFiles: 2 },
    ]);
    assert.deepEqual(await storedMediaInfoFor(identity, episode, false), info);
    assert.equal(
      await storedMediaInfoFor({ ...identity, fileIdx: 3 }, episode, false),
      undefined
    );
    const unknown = await seed([{ file: 'Some.Show.S01E01.mkv' }]);
    const label = 'Some.Show.S01E01';
    assert.equal(
      await storedMediaInfoFor(
        { ...unknown, title: label, filename: label },
        episode,
        false
      ),
      undefined
    );
  });

  it('keeps Usenet on exact names and known file counts', async () => {
    const identity = await seed([{}], 'nh1');
    assert.equal(await storedMovieInfo(identity), undefined);
    assert.deepEqual(
      await storedMovieInfo({ ...identity, filename: file }),
      info
    );
    const single = await seed([{ releaseFiles: 1 }], 'nh1');
    assert.deepEqual(await storedMovieInfo(single), info);
    const archive = await seed([{ file: `archive/${file}` }], 'nh1');
    assert.deepEqual(
      await storedMovieInfo({ ...archive, filename: `extracted/${file}` }),
      info
    );
  });
});
