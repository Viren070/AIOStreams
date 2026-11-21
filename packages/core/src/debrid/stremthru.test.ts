import { before, describe, it, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
// Load the core entry point first; the debrid services import each other.
import '../index.js';
import { StremThruService } from './stremthru.js';
import { DebridError, DebridFailureCache } from './base.js';
import type { DebridDownload, DebridFile, PlaybackInfo } from './base.js';
import { isArchiveFile, isArchiveOnly } from './utils.js';
import { settingsStore } from '../config/index.js';
import { SettingsRepository } from '../db/repositories/settings.js';

const hash = '0'.repeat(40);
const title = 'Some.Movie.2020.1080p.BluRay.x264';

const playbackInfo: PlaybackInfo & { type: 'torrent' } = {
  type: 'torrent',
  hash,
  sources: [],
  metadata: { titles: ['Some Movie'], year: 2020 },
};

function file(name: string, extra: Partial<DebridFile> = {}): DebridFile {
  return { name, size: 1000, link: `https://store.test/${name}`, ...extra };
}

/** Resolve a downloaded torrent whose account copy holds `files`. */
function resolve(
  t: TestContext,
  files: DebridFile[],
  info: Partial<PlaybackInfo & { type: 'torrent' }> = {}
): Promise<string | undefined> {
  const service = new StremThruService({
    serviceName: 'torbox',
    stremthru: {
      baseUrl: 'https://stremthru.test',
      store: 'torbox',
      token: 'x',
    },
    capabilities: { torrents: true, usenet: false },
  });
  const download: DebridDownload = {
    id: 1,
    hash,
    name: title,
    // addMagnet sums the file sizes; selection scores files against it.
    size: files.reduce((sum, f) => sum + f.size, 0),
    status: 'downloaded',
    files,
  };
  const linkCache = (StremThruService as any).playbackLinkCache;
  t.mock.method(linkCache, 'get', async () => undefined);
  t.mock.method(linkCache, 'set', async () => {});
  t.mock.method(DebridFailureCache, 'check', async () => {});
  t.mock.method(service, 'addMagnet', async () => download);
  t.mock.method(service, 'generateTorrentLink', async (link: string) => link);
  return (service as any)._resolveTorrent(
    { ...playbackInfo, ...info },
    title,
    false
  );
}

async function errorCode(
  promise: Promise<unknown>
): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof DebridError);
    return err.code;
  }
  assert.fail('expected a DebridError');
}

describe('isArchiveFile', () => {
  it('recognises archives and split volumes', () => {
    for (const name of [
      'a.zip',
      'a.RAR',
      'a.7z',
      'a.part01.rar',
      'a.r00',
      'a.7z.001',
    ]) {
      assert.equal(isArchiveFile(file(name)), true, name);
    }
  });

  it('leaves videos and sidecars alone', () => {
    for (const name of ['a.mkv', 'a.nfo', 'a.srt', 'a.rmvb']) {
      assert.equal(isArchiveFile(file(name)), false, name);
    }
  });
});

describe('isArchiveOnly', () => {
  it('is true for archives with sidecars and no video', () => {
    assert.equal(isArchiveOnly([file('a.zip')]), true);
    assert.equal(
      isArchiveOnly([file('a.rar'), file('a.r00'), file('a.nfo')]),
      true
    );
  });

  it('is false when a video is present or nothing is archived', () => {
    assert.equal(isArchiveOnly([file('a.zip'), file('a.mkv')]), false);
    assert.equal(
      isArchiveOnly([
        file('a.zip'),
        file('a.mkv', { mimeType: 'application/octet-stream' }),
      ]),
      false
    );
    assert.equal(isArchiveOnly([file('a.nfo')]), false);
    assert.equal(isArchiveOnly([]), false);
    assert.equal(isArchiveOnly(undefined), false);
  });
});

describe('StremThruService torrent resolve with archives', () => {
  before(async () => {
    mock.method(SettingsRepository, 'getAll', async () => []);
    mock.method(SettingsRepository, 'getVersion', async () => 0);
    await settingsStore.initialise();
  });

  it('reports ARCHIVE_ONLY when the download is a single zip', async (t) => {
    const zip = file(`${title}.zip`, { mimeType: 'application/zip' });
    assert.equal(await errorCode(resolve(t, [zip])), 'ARCHIVE_ONLY');
  });

  it('reports ARCHIVE_ONLY when the requested file index was zipped', async (t) => {
    const zip = file(`${title}.zip`, { index: 0 });
    assert.equal(
      await errorCode(resolve(t, [zip], { fileIndex: 5 })),
      'ARCHIVE_ONLY'
    );
    assert.equal(
      await errorCode(resolve(t, [zip], { fileIndex: 0 })),
      'ARCHIVE_ONLY'
    );
  });

  it('plays the video when a zip sits beside it', async (t) => {
    const link = await resolve(t, [
      file(`${title}.zip`, { size: 5000 }),
      file(`${title}.mkv`),
    ]);
    assert.equal(link, `https://store.test/${title}.mkv`);
  });

  it('reports ARCHIVE_ONLY when the requested index is a sidecar beside a zip', async (t) => {
    assert.equal(
      await errorCode(
        resolve(
          t,
          [
            file(`${title}.zip`, { index: 0 }),
            file(`${title}.nfo`, { index: 1 }),
          ],
          {
            fileIndex: 1,
          }
        )
      ),
      'ARCHIVE_ONLY'
    );
  });

  it('reports ARCHIVE_ONLY when the requested index is a zip beside a video', async (t) => {
    const files = [
      file(`${title}.zip`, { index: 0 }),
      file(`${title}.mkv`, { index: 1 }),
    ];
    assert.equal(
      await errorCode(resolve(t, files, { fileIndex: 0 })),
      'ARCHIVE_ONLY'
    );
  });

  it('keeps NO_MATCHING_FILE for a missing episode beside a zip', async (t) => {
    const files = [
      file('pack.zip', { size: 50_000_000 }),
      file('Show.S01E01.1080p.WEB.x264.mkv', { size: 1_000_000 }),
    ];
    assert.equal(
      await errorCode(
        resolve(t, files, {
          metadata: { titles: ['Show'], season: 1, episode: 5 },
        })
      ),
      'NO_MATCHING_FILE'
    );
  });

  it('keeps NO_MATCHING_FILE when the download lists no files', async (t) => {
    assert.equal(await errorCode(resolve(t, [])), 'NO_MATCHING_FILE');
  });

  it('keeps NO_MATCHING_FILE for a missing index without archives', async (t) => {
    assert.equal(
      await errorCode(
        resolve(t, [file(`${title}.mkv`, { index: 0 })], { fileIndex: 5 })
      ),
      'NO_MATCHING_FILE'
    );
  });
});
