import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  UsenetLibraryRepository,
  usenetLibraryBus,
  resolveWebdavNode,
  renderPropfind,
  webdavHref,
  assignReleaseFolders,
  categoryFolder,
  sanitizeSegment,
  webdavContentType,
  webdavLibraryStoragePath,
  type UsenetLibraryEntry,
  type WebdavNode,
} from '../../../index.js';

function entry(over: Partial<UsenetLibraryEntry> = {}): UsenetLibraryEntry {
  return {
    nzbHash: 'hash0001',
    name: 'Show.S01E01.1080p.WEB.mkv',
    size: 2048,
    files: [
      {
        name: 'Show.S01E01.1080p.WEB.mkv',
        size: 2048,
        index: 0,
        streamable: true,
        category: 'video',
      },
    ],
    status: 'available',
    failCount: 0,
    addedAt: '2024-01-01T00:00:00Z',
    lastUsedAt: '2024-01-02T00:00:00Z',
    progress: 1,
    bytesDone: 2048,
    bytesTotal: 2048,
    source: 'auto',
    category: 'tv',
    ...over,
  };
}

const MOVIE = entry({
  nzbHash: 'hash0002',
  name: 'Big.Movie.2024.2160p.mkv',
  files: [
    {
      name: 'Big.Movie.2024.2160p.mkv',
      size: 4096,
      index: 0,
      streamable: true,
      category: 'video',
    },
  ],
  category: 'movies',
});

// A season pack: has a season but no episode marker.
const SEASON_PACK = entry({
  nzbHash: 'hash0003',
  name: 'Big.Show.S03.1080p.WEB',
  files: [
    {
      name: 'Big.Show.S03.1080p.WEB.mkv',
      size: 5000,
      index: 0,
      streamable: true,
      category: 'video',
    },
  ],
  category: 'tv',
});

describe('webdav paths', () => {
  test('sanitizeSegment strips path separators and trims', () => {
    assert.equal(sanitizeSegment('a/b\\c'), 'a_b_c');
    assert.equal(sanitizeSegment('  .name.  '), 'name');
    assert.equal(sanitizeSegment(''), 'unnamed');
  });

  test('categoryFolder maps blank/star to uncategorised', () => {
    assert.equal(categoryFolder('tv'), 'tv');
    assert.equal(categoryFolder('*'), 'uncategorised');
    assert.equal(categoryFolder(undefined), 'uncategorised');
  });

  test('assignReleaseFolders gives each entry a unique suffixed folder', () => {
    const a = entry({ nzbHash: 'aaaaaa11', name: 'Same.Release' });
    const b = entry({ nzbHash: 'bbbbbb22', name: 'Same.Release' });
    const folders = assignReleaseFolders([a, b]).map((f) => f.folder);
    assert.notEqual(folders[0], folders[1]);
    assert.match(folders[0], /^Same\.Release \[aaaaaa11\]$/);
    assert.match(folders[1], /^Same\.Release \[bbbbbb22\]$/);
  });

  test('webdavLibraryStoragePath matches the library tree path', () => {
    assert.equal(
      webdavLibraryStoragePath(MOVIE),
      '/dav/library/movies/Big.Movie.2024.2160p.mkv [hash0002]'
    );
  });

  test('webdavContentType resolves known extensions', () => {
    assert.equal(webdavContentType('a.mkv'), 'video/x-matroska');
    assert.equal(webdavContentType('a.unknown'), 'application/octet-stream');
  });
});

describe('webdav xml', () => {
  const file: WebdavNode = {
    kind: 'file',
    name: 'a b.mkv',
    segments: ['library', 'tv', 'a b.mkv'],
    size: 10,
    contentType: 'video/x-matroska',
    entry: entry(),
    file: entry().files[0],
  };
  const dir: WebdavNode = {
    kind: 'collection',
    name: 'tv',
    segments: ['library', 'tv'],
  };

  test('webdavHref encodes segments; collections get a trailing slash', () => {
    assert.equal(webdavHref(file), '/dav/library/tv/a%20b.mkv');
    assert.equal(webdavHref(dir), '/dav/library/tv/');
  });

  test('renderPropfind emits multistatus with file length', () => {
    const xml = renderPropfind([dir, file]);
    assert.match(xml, /<D:multistatus xmlns:D="DAV:">/);
    assert.match(xml, /<D:collection\/>/);
    assert.match(xml, /<D:getcontentlength>10<\/D:getcontentlength>/);
  });
});

describe('webdav tree resolution round-trip', () => {
  function mockList(t: any, entries: UsenetLibraryEntry[]) {
    t.mock.method(UsenetLibraryRepository, 'list', async () => ({
      entries,
      total: entries.length,
    }));
    // Clear the module-level projection cache so each scenario sees its own
    // stubbed entries instead of a previous test's snapshot.
    usenetLibraryBus.emit('change');
  }

  test('root lists library and media', async (t) => {
    mockList(t, [entry(), MOVIE]);
    const root = await resolveWebdavNode([]);
    assert.ok(root);
    assert.deepEqual(
      root!.children.map((c) => c.name).sort(),
      ['library', 'media']
    );
  });

  test('library category/release/file round-trips and streams a real entry', async (t) => {
    mockList(t, [entry(), MOVIE]);

    const cats = await resolveWebdavNode(['library']);
    assert.ok(cats);
    assert.deepEqual(
      cats!.children.map((c) => c.name).sort(),
      ['movies', 'tv']
    );

    const releases = await resolveWebdavNode(['library', 'tv']);
    assert.ok(releases);
    assert.equal(releases!.children.length, 1);
    const releaseSeg = releases!.children[0].name;

    const files = await resolveWebdavNode(['library', 'tv', releaseSeg]);
    assert.ok(files);
    assert.equal(files!.children.length, 1);
    const fileSeg = files!.children[0].name;

    const fileNode = await resolveWebdavNode(['library', 'tv', releaseSeg, fileSeg]);
    assert.ok(fileNode);
    assert.equal(fileNode!.self.kind, 'file');
    if (fileNode!.self.kind === 'file') {
      assert.equal(fileNode!.self.size, 2048);
      assert.equal(fileNode!.self.entry.nzbHash, 'hash0001');
    }
  });

  test('media Series tree buckets an episode by show + season', async (t) => {
    mockList(t, [entry(), MOVIE]);

    const media = await resolveWebdavNode(['media']);
    assert.deepEqual(
      media!.children.map((c) => c.name).sort(),
      ['Movies', 'Series']
    );

    const shows = await resolveWebdavNode(['media', 'Series']);
    assert.ok(shows);
    assert.ok(shows!.children.some((c) => c.name === 'Show'));

    const seasons = await resolveWebdavNode(['media', 'Series', 'Show']);
    assert.ok(seasons);
    assert.ok(seasons!.children.some((c) => c.name === 'Season 01'));

    const eps = await resolveWebdavNode(['media', 'Series', 'Show', 'Season 01']);
    assert.ok(eps);
    assert.equal(eps!.children.length, 1);
    const epSeg = eps!.children[0].name;

    const ep = await resolveWebdavNode([
      'media',
      'Series',
      'Show',
      'Season 01',
      epSeg,
    ]);
    assert.ok(ep);
    assert.equal(ep!.self.kind, 'file');
    if (ep!.self.kind === 'file') {
      assert.equal(ep!.self.entry.nzbHash, 'hash0001');
      assert.equal(ep!.self.size, 2048);
    }
  });

  test('media Movies tree resolves down to the movie file', async (t) => {
    mockList(t, [entry(), MOVIE]);
    const movies = await resolveWebdavNode(['media', 'Movies']);
    assert.ok(movies);
    assert.ok(movies!.children.some((c) => c.name === 'Big Movie (2024)'));

    const files = await resolveWebdavNode(['media', 'Movies', 'Big Movie (2024)']);
    assert.ok(files);
    assert.equal(files!.children.length, 1);
    const fileSeg = files!.children[0].name;

    const file = await resolveWebdavNode([
      'media',
      'Movies',
      'Big Movie (2024)',
      fileSeg,
    ]);
    assert.ok(file);
    assert.equal(file!.self.kind, 'file');
    if (file!.self.kind === 'file') {
      assert.equal(file!.self.entry.nzbHash, 'hash0002');
      assert.equal(file!.self.size, 4096);
    }
  });

  test('season packs (season, no episode) classify under Series', async (t) => {
    mockList(t, [MOVIE, SEASON_PACK]);
    const shows = await resolveWebdavNode(['media', 'Series']);
    assert.ok(shows!.children.some((c) => c.name === 'Big Show'));
    const movies = await resolveWebdavNode(['media', 'Movies']);
    assert.ok(!movies!.children.some((c) => c.name.startsWith('Big Show')));

    const seasons = await resolveWebdavNode(['media', 'Series', 'Big Show']);
    assert.ok(seasons!.children.some((c) => c.name === 'Season 03'));
    const eps = await resolveWebdavNode([
      'media',
      'Series',
      'Big Show',
      'Season 03',
    ]);
    assert.ok(eps);
    assert.equal(eps!.children.length, 1);
    const ep = await resolveWebdavNode([
      'media',
      'Series',
      'Big Show',
      'Season 03',
      eps!.children[0].name,
    ]);
    assert.ok(ep);
    assert.equal(ep!.self.kind, 'file');
    if (ep!.self.kind === 'file') {
      assert.equal(ep!.self.entry.nzbHash, 'hash0003');
      assert.equal(ep!.self.size, 5000);
    }
  });

  test('unknown path resolves to undefined', async (t) => {
    mockList(t, [entry()]);
    assert.equal(await resolveWebdavNode(['nope']), undefined);
    assert.equal(
      await resolveWebdavNode(['library', 'tv', 'no-such-release']),
      undefined
    );
  });
});
