import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { after, before, describe, it, mock } from 'node:test';
// Initialise the dependency graph in the same order as the server.
import '../index.js';
import { initialiseConfig } from '../config/index.js';
import { closeDb, initDb } from '../db/db.js';
import {
  MediaInfoRepository,
  type MediaInfoRow,
} from '../db/repositories/media-info.js';
import type { Stream, UserData } from '../db/schemas.js';
import type { DebridFile } from '../debrid/base.js';
import { TorrentsService } from '@torbox/torbox-api';
import { Cache } from '../utils/cache.js';
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
const inventories = new Map<string, DebridFile[]>();
const checkedHashes: string[][] = [];
const userData = {
  services: [{ id: 'torbox', credentials: { apiKey: 'fixture' } }],
} as UserData;

before(async () => {
  directory = await mkdtemp('media-info-test-');
  await initDb(`sqlite://./${directory}/db.sqlite`);
  await initialiseConfig();
  mock.method(
    TorrentsService.prototype,
    'getTorrentCachedAvailability',
    async (
      version: string,
      params: { hash: string; format: string; listFiles: string }
    ) => {
      assert.equal(version, 'v1');
      assert.equal(params.format, 'list');
      assert.equal(params.listFiles, 'true');
      const hashes = params.hash.split(',');
      assert.ok(hashes.length <= 100);
      checkedHashes.push(hashes);
      return {
        data: {
          success: true,
          data: hashes.map((hash) => ({
            hash,
            size: (inventories.get(hash) ?? []).reduce(
              (sum, f) => sum + f.size,
              0
            ),
            files: inventories.get(hash) ?? [],
          })),
        },
      };
    }
  );
});

after(async () => {
  await closeDb();
  mock.restoreAll();
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
  return {
    hash,
    releaseKeys: [releaseKey],
    title,
    filename: title,
    service: 'torbox',
  };
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
  return storedMediaInfoFor(identity, undefined, true, userData);
}

function singleInventory(hash: string, name = file) {
  inventories.set(hash, [{ name, size: 6_930_229_510, index: 0 }]);
}

describe('stored media info file selection', () => {
  it('enriches Torrentio and Comet streams from the reported probe', async () => {
    const { hash } = await seed([{}]);
    singleInventory(hash);
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
      await resolveStoredMediaInfo([parsed], context('movie'), userData);
      assert.equal(parsed.parsedFile?.mediaInfoQuality, 'probe');
      assert.deepEqual(parsed.parsedFile?.audioTags, ['AAC']);
    }
  });

  it('checks the actual Torrentio URL shape and an advertised byte count', async () => {
    const { hash } = await seed([{}]);
    singleInventory(hash);
    const rounded = torrentioStream(hash);
    const exact = torrentioStream(hash, 6_930_229_510);
    const different = torrentioStream(hash, 6_930_229_511);
    await resolveStoredMediaInfo(
      [rounded, exact, different],
      context('movie'),
      userData
    );
    assert.equal(rounded.parsedFile?.mediaInfoQuality, 'probe');
    assert.equal(exact.parsedFile?.mediaInfoQuality, 'probe');
    assert.notEqual(different.parsedFile?.mediaInfoQuality, 'probe');
  });

  it('requires a movie request for an unknown-count inventory lookup', async () => {
    for (const name of [file, title]) {
      const { hash } = await seed([{ file: name }]);
      const parsed = torrentioStream(hash);
      singleInventory(hash);
      const before = checkedHashes.length;
      await resolveStoredMediaInfo([parsed], context('series'), userData);
      assert.notEqual(parsed.parsedFile?.mediaInfoQuality, 'probe');
      assert.equal(checkedHashes.length, before);
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
    singleInventory(hash);
    await resolveStoredMediaInfo(
      [custom, existing],
      context('movie'),
      userData
    );
    assert.notEqual(custom.parsedFile?.mediaInfoQuality, 'probe');
    assert.equal(existing.parsedFile, parsedFile);
  });

  it('verifies the same inventory on Jellyfin play', async () => {
    const { hash } = await seed([{}]);
    singleInventory(hash);
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
      await applyStoredMediaInfo(record, undefined, { movie: true, userData }),
      true
    );
    assert.equal(record.extension.mediaInfoQuality, 'probe');
    assert.equal(record.extension.encode, 'AVC');
    assert.deepEqual(record.extension.audioTags, ['AAC']);
  });

  it('uses the actual inventory name independently of the release label', async () => {
    const identity = await seed([
      { file: 'folder/THE_OGRES_BRIDE_2026_PK_WEB-DL_1080P.MKV' },
    ]);
    singleInventory(
      identity.hash,
      'folder/THE_OGRES_BRIDE_2026_PK_WEB-DL_1080P.MKV'
    );
    assert.deepEqual(await storedMovieInfo(identity), info);
  });

  it('does not infer a sole file from a title and one observed probe', async () => {
    const identity = await seed([{}]);
    assert.equal(await storedMovieInfo(identity), undefined);
    inventories.set(identity.hash, [
      { name: file, size: 6_930_229_510, index: 0 },
      { name: `${title}.mp4`, size: 6_930_229_510, index: 1 },
    ]);
    await Cache.clearPrefix('media-info:torbox-inventory');
    assert.equal(await storedMovieInfo(identity), undefined);
  });

  it('requires matching inventory bytes and never normalizes actual file names', async () => {
    const identity = await seed([{}]);
    for (const candidate of [
      { name: file, size: 6_930_229_511 },
      { name: `${title}.mkv`, size: 6_930_229_510 },
      { name: file, size: 0 },
    ]) {
      inventories.set(identity.hash, [candidate]);
      await Cache.clearPrefix('media-info:torbox-inventory');
      assert.equal(await storedMovieInfo(identity), undefined);
    }
  });

  it('does not query a disabled or unconfigured service and keeps exact matches', async () => {
    const identity = await seed([{}]);
    singleInventory(identity.hash);
    const before = checkedHashes.length;
    for (const config of [
      undefined,
      {} as UserData,
      {
        services: [
          { id: 'torbox', enabled: false, credentials: { apiKey: 'fixture' } },
        ],
      } as UserData,
    ]) {
      assert.equal(
        await storedMediaInfoFor(identity, undefined, true, config),
        undefined
      );
      assert.deepEqual(
        await storedMediaInfoFor(
          { ...identity, file },
          undefined,
          true,
          config
        ),
        info
      );
    }
    assert.equal(checkedHashes.length, before);
  });

  it('batches and deduplicates ambiguous hashes by store', async () => {
    const a = await seed([{}]);
    const b = await seed([{}]);
    singleInventory(a.hash);
    singleInventory(b.hash);
    const before = checkedHashes.length;
    const streams = [
      torrentioStream(a.hash),
      torrentioStream(b.hash),
      torrentioStream(a.hash),
    ];
    await resolveStoredMediaInfo(streams, context('movie'), userData);
    assert.equal(checkedHashes.length, before + 1);
    assert.deepEqual(new Set(checkedHashes.at(-1)), new Set([a.hash, b.hash]));
    assert.ok(streams.every((s) => s.parsedFile?.mediaInfoQuality === 'probe'));
  });

  it('preserves the known single feature when samples are also stored', async () => {
    for (const reverse of [false, true]) {
      const reports = [
        { file, releaseFiles: 1 },
        { file: 'sample.mkv', releaseFiles: 1, size: 1_000_000 },
      ];
      const identity = await seed(reverse ? reports.reverse() : reports);
      assert.deepEqual(await storedMovieInfo(identity), info);
    }
  });

  it('honors an explicit extensionless file even when it equals the title', async () => {
    const identity = await seed([{ file: 'Feature' }]);
    assert.deepEqual(
      await storedMovieInfo({
        ...identity,
        file: 'Feature',
        title: 'Feature',
        filename: 'Feature',
        fileIdx: 0,
      }),
      info
    );
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
