import '../../index.js';
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { settingsStore } from '../../config/index.js';
import { SettingsRepository } from '../../db/repositories/settings.js';
import { toUrlSafeBase64 } from '../../utils/general.js';
import { DebridError, PlaybackInfo } from '../base.js';
import {
  parseQbittorrentCredential,
  QbittorrentFile,
  QBITTORRENT_TAG,
} from './client.js';
import { QBittorrentService } from './service.js';
import {
  decodeQbittorrentStreamToken,
  encodeQbittorrentStreamToken,
  QbittorrentStreamToken,
} from './tokens.js';
import {
  computeFileAvailability,
  planFilePriorities,
} from './availability.js';

const WEBUI = 'http://qbit.test';

function credentialToken(
  url = WEBUI,
  username = 'user',
  password = 'pass'
): string {
  return toUrlSafeBase64(JSON.stringify({ url, username, password }));
}

function file(partial: Partial<QbittorrentFile> & { index: number; name: string; size: number; piece_range: [number, number] }): QbittorrentFile {
  return { progress: 0, priority: 1, ...partial };
}

const TOKEN: QbittorrentStreamToken = {
  ref: '0d1e2f3a-4b5c-6d7e-8f9a-0b1c2d3e4f5a',
  exp: 4102444800,
};

describe('parseQbittorrentCredential', () => {




  test('accepts skipOtherFiles as a string flag from the form', () => {
    const credential = parseQbittorrentCredential(
      toUrlSafeBase64(
        JSON.stringify({ url: WEBUI, username: 'u', password: 'p', skipOtherFiles: 'true' })
      )
    );
    assert.equal(credential.skipOtherFiles, true);
  });

  test('treats the string "false" as off', () => {
    const credential = parseQbittorrentCredential(
      toUrlSafeBase64(
        JSON.stringify({ url: WEBUI, username: 'u', password: 'p', skipOtherFiles: 'false' })
      )
    );
    assert.equal(credential.skipOtherFiles, false);
  });

  test('accepts an explicit null as off', () => {
    const credential = parseQbittorrentCredential(
      toUrlSafeBase64(
        JSON.stringify({ url: WEBUI, username: 'u', password: 'p', skipOtherFiles: null })
      )
    );
    assert.equal(credential.skipOtherFiles, false);
  });

});

describe('stream tokens', () => {

  test('rejects tampered ciphertext', () => {
    const encoded = encodeQbittorrentStreamToken(TOKEN);
    const tampered = encoded.slice(0, -4) + (encoded.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    assert.equal(decodeQbittorrentStreamToken(tampered), undefined);
  });

});

describe('planFilePriorities', () => {
  const pack = [
    file({ index: 0, name: 's01e01.mkv', size: 500, piece_range: [0, 1], priority: 1 }),
    file({ index: 1, name: 's01e02.mkv', size: 500, piece_range: [2, 3], priority: 1 }),
    file({ index: 2, name: 's01e03.mkv', size: 500, piece_range: [4, 5], priority: 1 }),
  ];

  test('own torrent without skip raises only the selected file', () => {
    const plan = planFilePriorities({
      files: pack,
      selectedIndex: 1,
      skipOthers: false,
      ownTorrent: true,
    });
    assert.deepEqual(plan, { skip: [], raise: [1], restore: [] });
  });

  test('own torrent with skip raises the selected file and skips the rest', () => {
    const plan = planFilePriorities({
      files: pack,
      selectedIndex: 1,
      skipOthers: true,
      ownTorrent: true,
    });
    assert.deepEqual(plan.skip.sort(), [0, 2]);
    assert.deepEqual(plan.raise, [1]);
    assert.deepEqual(plan.restore, []);
  });

  test('adopted torrents are only restored, never re-arranged', () => {
    const skipped = pack.map((f) =>
      f.index === 2 ? { ...f, priority: 0 } : f
    );
    const plan = planFilePriorities({
      files: skipped,
      selectedIndex: 2,
      skipOthers: true,
      ownTorrent: false,
    });
    assert.deepEqual(plan, { skip: [], raise: [], restore: [2] });
  });

  test('adopted torrents with a downloadable selected file are untouched', () => {
    const plan = planFilePriorities({
      files: pack,
      selectedIndex: 0,
      skipOthers: true,
      ownTorrent: false,
    });
    assert.deepEqual(plan, { skip: [], raise: [], restore: [] });
  });

  test('complete torrents are never touched, even with skip on', () => {
    const complete = pack.map((f) => ({ ...f, progress: 1 }));
    const plan = planFilePriorities({
      files: complete,
      selectedIndex: 1,
      skipOthers: true,
      ownTorrent: true,
    });
    assert.deepEqual(plan, { skip: [], raise: [], restore: [] });
  });

  test('already-downloaded files are not skipped again', () => {
    const partiallyDone = pack.map((f) =>
      f.index === 0 ? { ...f, progress: 1 } : f
    );
    const plan = planFilePriorities({
      files: partiallyDone,
      selectedIndex: 1,
      skipOthers: true,
      ownTorrent: true,
    });
    assert.deepEqual(plan.skip, [2]);
    assert.deepEqual(plan.raise, [1]);
  });

  test('files with an active stream are never skipped', () => {
    const plan = planFilePriorities({
      files: pack,
      selectedIndex: 1,
      skipOthers: true,
      ownTorrent: true,
      liveFiles: new Set([0]),
    });
    assert.deepEqual(plan.skip, [2]);
    assert.deepEqual(plan.raise, [1]);
  });

  test('a complete selected file is not raised', () => {
    const selectedDone = pack.map((f) =>
      f.index === 1 ? { ...f, progress: 1 } : f
    );
    const plan = planFilePriorities({
      files: selectedDone,
      selectedIndex: 1,
      skipOthers: false,
      ownTorrent: true,
    });
    assert.deepEqual(plan, { skip: [], raise: [], restore: [] });
  });
});

describe('computeFileAvailability', () => {
  // Layout: pieceSize 250. File 0 = [0, 500) = pieces 0-1.
  // File 1 = [500, 1500) = pieces 2-5, 1000 bytes.
  const files = [
    file({ index: 0, name: 'first.bin', size: 500, piece_range: [0, 1], progress: 1 }),
    file({ index: 1, name: 'video.mkv', size: 1000, piece_range: [2, 5] }),
  ];

  test('reports complete when every file piece is downloaded', () => {
    const availability = computeFileAvailability({
      files,
      fileIndex: 1,
      pieceStates: [2, 2, 2, 2, 2, 2],
      pieceSize: 250,
    });
    assert.equal(availability.complete, true);
    assert.equal(availability.rangeAvailable(0, 1000), true);
  });

  test('serves a range only when all its pieces are downloaded', () => {
    // Piece 4 missing: global [1000, 1250) = file bytes [500, 750).
    const availability = computeFileAvailability({
      files,
      fileIndex: 1,
      pieceStates: [2, 2, 2, 2, 0, 2],
      pieceSize: 250,
    });
    assert.equal(availability.complete, false);
    assert.equal(availability.rangeAvailable(0, 500), true);
    assert.equal(availability.rangeAvailable(0, 501), false);
    assert.equal(availability.rangeAvailable(750, 1000), true);
  });

  test('clamps contiguous reads at the first hole', () => {
    const availability = computeFileAvailability({
      files,
      fileIndex: 1,
      pieceStates: [2, 2, 2, 2, 0, 2],
      pieceSize: 250,
    });
    assert.equal(availability.contiguousFrom(0), 500);
    assert.equal(availability.contiguousFrom(500), 500);
    assert.equal(availability.contiguousFrom(750), 1000);
  });

  test('handles a piece shared with the previous file', () => {
    // File 0 = [0, 600) (pieces 0-2), file 1 = [600, 1500) (pieces 2-5):
    // piece 2 spans the end of file 0 and the start of file 1.
    const shared = [
      file({ index: 0, name: 'first.bin', size: 600, piece_range: [0, 2], progress: 1 }),
      file({ index: 1, name: 'video.mkv', size: 900, piece_range: [2, 5] }),
    ];
    const availability = computeFileAvailability({
      files: shared,
      fileIndex: 1,
      pieceStates: [0, 0, 2, 0, 0, 0],
      pieceSize: 250,
    });
    // Piece 2 covers global [500, 750): file 1 bytes [0, 150).
    assert.equal(availability.contiguousFrom(0), 150);
  });

  test('falls back to progress when piece states are unavailable', () => {
    const partial = [
      file({ index: 0, name: 'first.bin', size: 500, piece_range: [0, 1], progress: 1 }),
      file({ index: 1, name: 'video.mkv', size: 1000, piece_range: [2, 5], progress: 0.5 }),
    ];
    const availability = computeFileAvailability({
      files: partial,
      fileIndex: 1,
      pieceSize: 250,
    });
    assert.equal(availability.complete, false);
    assert.equal(availability.contiguousFrom(0), 500);
    assert.equal(availability.rangeAvailable(0, 500), true);
    assert.equal(availability.rangeAvailable(0, 501), false);
  });

  test('corrects offsets when pad files are hidden from the list', () => {
    // True layout: file 0 = [0, 500) (pieces 0-1), a hidden 250-byte pad file
    // = [500, 750) (piece 2), file 1 = [750, 1750) (pieces 3-6). The files
    // list omits the pad file, so summed offsets land one piece short; the
    // file's own piece range pins the true offset.
    const withPad = [
      file({ index: 0, name: 'first.bin', size: 500, piece_range: [0, 1], progress: 1 }),
      file({ index: 1, name: 'video.mkv', size: 1000, piece_range: [3, 6] }),
    ];
    const availability = computeFileAvailability({
      files: withPad,
      fileIndex: 1,
      pieceStates: [2, 2, 2, 2, 0, 0, 0],
      pieceSize: 250,
    });
    // File 1 starts at global 750 (piece 3); its first 250 bytes are in
    // piece 3 = global [750, 1000).
    assert.equal(availability.contiguousFrom(0), 250);
    assert.equal(availability.rangeAvailable(0, 250), true);
    assert.equal(availability.rangeAvailable(0, 251), false);
  });

  test('resolves files by index regardless of array order', () => {
    const reordered = [
      file({ index: 1, name: 'video.mkv', size: 1000, piece_range: [2, 5] }),
      file({ index: 0, name: 'first.bin', size: 500, piece_range: [0, 1], progress: 1 }),
    ];
    const availability = computeFileAvailability({
      files: reordered,
      fileIndex: 1,
      pieceStates: [2, 2, 2, 2, 2, 2],
      pieceSize: 250,
    });
    assert.equal(availability.complete, true);
  });

  test('treats zero-length files as complete', () => {
    const withEmpty = [
      file({ index: 0, name: 'first.bin', size: 500, piece_range: [0, 1], progress: 1 }),
      file({ index: 1, name: 'empty.txt', size: 0, piece_range: [2, 1] }),
    ];
    const availability = computeFileAvailability({
      files: withEmpty,
      fileIndex: 1,
      pieceStates: [2, 2],
      pieceSize: 250,
    });
    assert.equal(availability.complete, true);
    assert.equal(availability.rangeAvailable(0, 0), true);
  });
});

// Each test gets its own credential so the client's shared session and
// login-failure caches cannot leak state between tests.
let credentialCounter = 0;

function service() {
  return new QBittorrentService(
    { token: credentialToken(WEBUI, 'user', `pass-${++credentialCounter}`) },
    { pollInterval: 10, maxWaitTime: 100 }
  );
}

function serviceWithSkip() {
  return new QBittorrentService(
    {
      token: toUrlSafeBase64(
        JSON.stringify({
          url: WEBUI,
          username: 'user',
          password: `skip-${++credentialCounter}`,
          skipOtherFiles: 'true',
        })
      ),
    },
    { pollInterval: 10, maxWaitTime: 100 }
  );
}

describe('QBittorrentService', () => {
  test('maps torrent states onto download statuses', async (t) => {
    await withMockedWebUi(t, {
      login: true,
      intercepts: [
        {
          path: `/api/v2/torrents/info?hashes=${'b'.repeat(40)}%7C${'c'.repeat(40)}%7C${'d'.repeat(40)}%7C${'9'.repeat(40)}`,
          body: [
            { ...torrentFixture('b'.repeat(40), 'stalledUP'), progress: 1 },
            torrentFixture('c'.repeat(40), 'error'),
            torrentFixture('9'.repeat(40), 'downloading'),
          ],
        },
        {
          path: `/api/v2/torrents/files?hash=${'b'.repeat(40)}`,
          body: [fileFixture(0, 'video.mkv', 2000)],
        },
        {
          path: `/api/v2/torrents/files?hash=${'9'.repeat(40)}`,
          body: [fileFixture(0, 'video.mkv', 2000)],
        },
      ],
    });
    const [seeded, errored, absent, downloading] = await service().checkMagnets([
      `magnet:?xt=urn:btih:${'b'.repeat(40)}`,
      `magnet:?xt=urn:btih:${'c'.repeat(40)}`,
      `magnet:?xt=urn:btih:${'d'.repeat(40)}`,
      `magnet:?xt=urn:btih:${'9'.repeat(40)}`,
    ]);
    assert.equal(seeded.status, 'cached');
    assert.equal(seeded.library, true);
    assert.ok(seeded.files?.length);
    assert.equal(errored.status, 'failed');
    assert.equal(absent.status, 'unknown');
    assert.equal(absent.library, false);
    // Present but incomplete: playable only after more download.
    assert.equal(downloading.status, 'downloading');
    assert.equal(downloading.library, true);
  });

  test('adds torrents with the aiostreams tag and streaming flags', async (t) => {
    let addBody = '';
    await withMockedWebUi(t, {
      login: true,
      intercepts: [],
      onAdd: (body) => (addBody = body),
    });
    await service().addMagnet(`magnet:?xt=urn:btih:${'e'.repeat(40)}`);
    assert.match(addBody, /urls=magnet%3A/);
    assert.match(addBody, new RegExp(`tags=${QBITTORRENT_TAG}`));
    assert.match(addBody, /sequentialDownload=true/);
    assert.match(addBody, /firstLastPiecePrio=true/);
  });

  test('maps a rejected add to STORE_MAGNET_INVALID', async (t) => {
    await withMockedWebUi(t, { login: true, intercepts: [], addStatus: 415 });
    await assert.rejects(
      () => service().addMagnet(`magnet:?xt=urn:btih:${'f'.repeat(40)}`),
      (err: unknown) =>
        err instanceof DebridError && err.code === 'STORE_MAGNET_INVALID'
    );
  });

  test('reports bad credentials as UNAUTHORIZED', async (t) => {
    await withMockedWebUi(t, { login: false });
    await assert.rejects(
      () => service().listMagnets(),
      (err: unknown) =>
        err instanceof DebridError && err.code === 'UNAUTHORIZED'
    );
  });

  test('re-logins once when the session goes stale', async (t) => {
    let logins = 0;
    let dataHits = 0;
    await withMockedWebUi(t, {
      login: true,
      intercepts: [],
      onLogin: () => logins++,
      dataIntercept: () => {
        dataHits++;
        // First data call pretends the SID is stale, then succeeds.
        if (dataHits === 1) {
          return { statusCode: 401 };
        }
        return {
          statusCode: 200,
          data: JSON.stringify([]),
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      },
    });
    const result = await service().listMagnets();
    assert.deepEqual(result, []);
    assert.equal(logins, 2);
    assert.equal(dataHits, 2);
  });
});

function torrentFixture(hash: string, state: string) {
  return {
    hash,
    name: 'release',
    state,
    progress: 0,
    size: 2000,
    completed: 0,
    amount_left: 2000,
    content_path: '/downloads/release',
    save_path: '/downloads',
    category: '',
    tags: '',
    added_on: 1700000000,
  };
}

function fileFixture(index: number, name: string, size: number) {
  return { index, name, size, progress: 0, priority: 1, piece_range: [0, 1], availability: 1 };
}

describe('QBittorrentService resolve', () => {
  // One unique infohash per test: the live-file registry is module-global
  // with a 15-minute TTL, so reusing a hash would leak liveness between
  // tests (and correctly suppress skips of a "live" file).
  const hashOf = (char: string) => char.repeat(40);

  function playback(hash: string, fileIndex: number): PlaybackInfo {
    return { type: 'torrent', hash, sources: [], fileIndex };
  }

  /**
   * A directory on the real filesystem holding one non-zero file per entry,
   * so the resolve wait's flushed-to-disk check passes. For a single file
   * the torrent's content_path is the file itself; for several it is the
   * directory.
   */
  function makeContent(
    t: { after: (fn: () => void) => void },
    files: { name: string; size: number }[]
  ): string {
    const dir = mkdtempSync(join(tmpdir(), 'aiostreams-qbit-'));
    for (const file of files) {
      writeFileSync(join(dir, file.name), Buffer.alloc(file.size, 1));
    }
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return files.length === 1 ? join(dir, files[0].name) : dir;
  }

  function dataIntercepts(
    hash: string,
    torrent: Record<string, unknown>,
    files: Record<string, unknown>[],
    pieceStates: number[]
  ) {
    return [
      { path: `/api/v2/torrents/info?hashes=${hash}`, body: [torrent] },
      { path: `/api/v2/torrents/files?hash=${hash}`, body: files },
      { path: `/api/v2/torrents/properties?hash=${hash}`, body: { piece_size: 250 } },
      {
        path: `/api/v2/torrents/pieceStates?hash=${hash}`,
        body: pieceStates,
      },
    ];
  }

  test('resolves a ready file and raises its priority', async (t) => {
    const hash = hashOf('1');
    const contentPath = makeContent(t, [{ name: 'video.mkv', size: 2000 }]);
    const prioBodies: string[] = [];
    await withMockedWebUi(t, {
      login: true,
      onFilePrio: (body) => prioBodies.push(body),
      intercepts: dataIntercepts(
        hash,
        { ...torrentFixture(hash, 'downloading'), content_path: contentPath, tags: QBITTORRENT_TAG },
        [{ ...fileFixture(0, 'video.mkv', 2000), piece_range: [0, 7] }],
        [2, 2, 2, 2, 2, 2, 2, 2]
      ),
    });
    const link = await service().resolve(playback(hash, 0), 'video.mkv', true);
    assert.match(link ?? '', /\/api\/v1\/qbittorrent\/stream\//);
    assert.equal(prioBodies.length, 1);
    assert.match(prioBodies[0], /id=0/);
    assert.match(prioBodies[0], /priority=7/);
  });

  test('restores a skipped selected file in an adopted torrent', async (t) => {
    const hash = hashOf('2');
    const contentPath = makeContent(t, [{ name: 'video.mkv', size: 2000 }]);
    const prioBodies: string[] = [];
    await withMockedWebUi(t, {
      login: true,
      onFilePrio: (body) => prioBodies.push(body),
      intercepts: dataIntercepts(
        hash,
        { ...torrentFixture(hash, 'downloading'), content_path: contentPath },
        [{ ...fileFixture(0, 'video.mkv', 2000), priority: 0, piece_range: [0, 7] }],
        [2, 2, 2, 2, 2, 2, 2, 2]
      ),
    });
    const link = await service().resolve(playback(hash, 0), 'video.mkv', true);
    assert.match(link ?? '', /\/api\/v1\/qbittorrent\/stream\//);
    assert.equal(prioBodies.length, 1);
    assert.match(prioBodies[0], /id=0/);
    assert.match(prioBodies[0], /priority=1/);
  });

  test('resumes a stopped own torrent', async (t) => {
    const hash = hashOf('3');
    const contentPath = makeContent(t, [{ name: 'video.mkv', size: 2000 }]);
    const starts: string[] = [];
    await withMockedWebUi(t, {
      login: true,
      onTorrentStart: (body) => starts.push(body),
      intercepts: dataIntercepts(
        hash,
        { ...torrentFixture(hash, 'stoppedDL'), content_path: contentPath, tags: QBITTORRENT_TAG },
        [{ ...fileFixture(0, 'video.mkv', 2000), piece_range: [0, 7] }],
        [2, 2, 2, 2, 2, 2, 2, 2]
      ),
    });
    const link = await service().resolve(playback(hash, 0), 'video.mkv', true);
    assert.match(link ?? '', /\/api\/v1\/qbittorrent\/stream\//);
    assert.equal(starts.length, 1);
    assert.match(starts[0], new RegExp(`hashes=${hash}`));
  });

  test('leaves a complete torrent untouched', async (t) => {
    const hash = hashOf('4');
    const contentPath = makeContent(t, [{ name: 'video.mkv', size: 2000 }]);
    const prioBodies: string[] = [];
    await withMockedWebUi(t, {
      login: true,
      onFilePrio: (body) => prioBodies.push(body),
      intercepts: dataIntercepts(
        hash,
        { ...torrentFixture(hash, 'stalledUP'), content_path: contentPath, progress: 1, tags: QBITTORRENT_TAG },
        [{ ...fileFixture(0, 'video.mkv', 2000), progress: 1, piece_range: [0, 7] }],
        [2, 2, 2, 2, 2, 2, 2, 2]
      ),
    });
    const link = await service().resolve(playback(hash, 0), 'video.mkv', true);
    assert.match(link ?? '', /\/api\/v1\/qbittorrent\/stream\//);
    assert.equal(prioBodies.length, 0);
  });

  test('skips other files and raises the selected one when opted in', async (t) => {
    const hash = hashOf('5');
    const contentPath = makeContent(t, [
      { name: 's01e01.mkv', size: 1000 },
      { name: 's01e02.mkv', size: 1000 },
    ]);
    const prioBodies: string[] = [];
    await withMockedWebUi(t, {
      login: true,
      onFilePrio: (body) => prioBodies.push(body),
      intercepts: dataIntercepts(
        hash,
        {
          ...torrentFixture(hash, 'downloading'),
          content_path: contentPath,
          save_path: contentPath,
          tags: QBITTORRENT_TAG,
        },
        [
          { ...fileFixture(0, 's01e01.mkv', 1000), piece_range: [0, 3] },
          { ...fileFixture(1, 's01e02.mkv', 1000), piece_range: [4, 7] },
        ],
        [2, 2, 2, 2, 2, 2, 2, 2]
      ),
    });
    const link = await serviceWithSkip().resolve(playback(hash, 1), 's01e02.mkv', true);
    assert.match(link ?? '', /\/api\/v1\/qbittorrent\/stream\//);
    assert.equal(prioBodies.length, 2);
    assert.ok(
      prioBodies.some((body) => /id=1/.test(body) && /priority=7/.test(body))
    );
    assert.ok(
      prioBodies.some((body) => /id=0/.test(body) && /priority=0/.test(body))
    );
  });
});

interface MockWebUiOptions {
  login: boolean;
  intercepts?: { path: string; body: unknown }[];
  addStatus?: number;
  onAdd?: (body: string) => void;
  onLogin?: () => void;
  onFilePrio?: (body: string) => void;
  onTorrentStart?: (body: string) => void;
  /** Reply callback for `/api/v2/torrents/info?tag=aiostreams` (listMagnets). */
  dataIntercept?: () => {
    statusCode: number;
    data?: string;
    responseOptions?: { headers: Record<string, string> };
  };
}

/**
 * Point the undici dispatcher at a fake WebUI: one login intercept, one
 * add intercept, and per-path JSON bodies for the data endpoints. All
 * intercepts are registered here because undici matches the earliest
 * registered intercept for a path, so a test cannot shadow these later.
 */
async function withMockedWebUi(
  t: { after: (fn: () => void) => void },
  options: MockWebUiOptions
) {
  options.intercepts ??= [];
  mock.method(SettingsRepository, 'getAll', async () => []);
  mock.method(SettingsRepository, 'getVersion', async () => 0);
  await settingsStore.initialise();
  const agent = new MockAgent();
  agent.disableNetConnect();
  const previous = getGlobalDispatcher();
  setGlobalDispatcher(agent);
  t.after(() => setGlobalDispatcher(previous));

  agent
    .get(WEBUI)
    .intercept({ path: '/api/v2/auth/login', method: 'POST' })
    .reply(() => {
      options.onLogin?.();
      if (!options.login) {
        return { statusCode: 200, data: 'Fails.' };
      }
      return {
        statusCode: 200,
        data: 'Ok.',
        responseOptions: { headers: { 'set-cookie': 'SID=test; Path=/' } },
      };
    })
    .persist();
  agent
    .get(WEBUI)
    .intercept({ path: '/api/v2/torrents/add', method: 'POST' })
    .reply(({ body }) => {
      options.onAdd?.(String(body));
      return { statusCode: options.addStatus ?? 200, data: '' };
    })
    .persist();
  if (options.dataIntercept) {
    agent
      .get(WEBUI)
      .intercept({ path: '/api/v2/torrents/info?tag=aiostreams' })
      .reply(options.dataIntercept)
      .persist();
  }
  agent
    .get(WEBUI)
    .intercept({ path: '/api/v2/torrents/filePrio', method: 'POST' })
    .reply(({ body }) => {
      options.onFilePrio?.(String(body));
      return { statusCode: 200, data: '' };
    })
    .persist();
  agent
    .get(WEBUI)
    .intercept({ path: '/api/v2/torrents/start', method: 'POST' })
    .reply(({ body }) => {
      options.onTorrentStart?.(String(body));
      return { statusCode: 200, data: '' };
    })
    .persist();
  for (const { path, body } of options.intercepts) {
    agent
      .get(WEBUI)
      .intercept({ path })
      .reply(() => ({
        statusCode: 200,
        data: JSON.stringify(body),
        responseOptions: { headers: { 'content-type': 'application/json' } },
      }))
      .persist();
  }
  return agent;
}
