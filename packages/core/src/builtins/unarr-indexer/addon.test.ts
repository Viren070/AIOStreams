import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildUnarrSearchParams,
  connectUnarr,
  unarrQuotaMetadata,
  validateUnarrApiUrl,
} from './addon.js';
import type { ParsedId } from '../../utils/id-parser.js';
import {
  issueUnarrConfigProxyGrant,
  UnarrIndexerStreamParser,
} from '../../presets/unarrIndexer.js';
import type { Addon, ParsedStream, Stream } from '../../db/index.js';
import {
  isConfigProxyRequestAllowed,
  issueConfigProxyGrant,
  verifyConfigProxyGrant,
} from '../../utils/index.js';

class TestUnarrParser extends UnarrIndexerStreamParser {
  extras(stream: Stream, parsed: ParsedStream) {
    return this.getExtras(stream, parsed);
  }
  folderSize(stream: Stream, parsed: ParsedStream) {
    return this.getFolderSize(stream, parsed);
  }
  releaseGroup(stream: Stream, parsed: ParsedStream) {
    return this.getReleaseGroup(stream, parsed);
  }
  indexer() {
    return this.getIndexer();
  }
}

const parsedEpisode: ParsedId = {
  type: 'imdbId',
  value: 'tt1196946',
  fullId: 'tt1196946:1:1',
  externalType: 'imdb_id',
  mediaType: 'series',
  season: '1',
  episode: '1',
  generator: (value, season, episode) => `${value}:${season}:${episode}`,
};

test('builds Unarr episode search with IDs, query, and season mapping', () => {
  assert.deepEqual(
    buildUnarrSearchParams(
      parsedEpisode,
      {
        primaryTitle: 'The Mentalist',
        titles: ['The Mentalist'],
        year: 2008,
        imdbId: 'tt1196946',
        tvdbId: 82459,
        season: 1,
        episode: 1,
      },
      30
    ),
    {
      query: 'The Mentalist 2008',
      imdbId: 'tt1196946',
      tvdbId: '82459',
      season: 1,
      episode: 1,
      limit: 30,
    }
  );
});

test('uses the parsed IMDb ID when metadata has no external ID', () => {
  assert.equal(
    buildUnarrSearchParams(parsedEpisode, { titles: ['The Mentalist'] }, 10)
      .imdbId,
    'tt1196946'
  );
});

test('allows only the official HTTPS Unarr host family', () => {
  assert.equal(validateUnarrApiUrl('https://unarr.app/'), 'https://unarr.app');
  assert.equal(
    validateUnarrApiUrl('https://api.unarr.app/'),
    'https://api.unarr.app'
  );
  assert.throws(() => validateUnarrApiUrl('http://unarr.app'));
  assert.throws(() => validateUnarrApiUrl('https://unarr.app.example.com'));
});

test('fully bypasses local quota metadata when the ceiling is disabled', () => {
  assert.deepEqual(unarrQuotaMetadata(false, 'release-key', 42), {
    indexer: 'Unarr',
  });
  assert.deepEqual(unarrQuotaMetadata(true, 'release-key', 42), {
    indexer: 'TorrentClaw / Unarr',
    quotaReservationKey: 'release-key',
    quotaBytes: 42,
  });
});

test('rejects non-Unarr credentials before making a network request', async () => {
  await assert.rejects(
    connectUnarr({ apiUrl: 'https://unarr.app', credential: 'not-a-key' }),
    /tc_|unarr-authkey-/
  );
});

test('issues deterministic, isolated per-config proxy grants', () => {
  const first = issueConfigProxyGrant(
    'preset-instance-a',
    'unarr-nzb',
    'https://unarr.app'
  );
  const repeated = issueConfigProxyGrant(
    'preset-instance-a',
    'unarr-nzb',
    'https://unarr.app'
  );
  const second = issueConfigProxyGrant(
    'preset-instance-b',
    'unarr-nzb',
    'https://unarr.app'
  );

  assert.equal(first, repeated);
  assert.notEqual(first, second);
  assert.match(verifyConfigProxyGrant(first)?.identity ?? '', /^config:/);
});

test('rejects tampered or malformed config proxy grants', () => {
  const grant = issueConfigProxyGrant(
    'preset-instance-a',
    'unarr-nzb',
    'https://unarr.app'
  );
  const replacement = grant.endsWith('A') ? 'B' : 'A';
  assert.equal(verifyConfigProxyGrant(grant.slice(0, -1) + replacement), null);
  assert.equal(verifyConfigProxyGrant('pcg_not-a-grant'), null);
  assert.throws(() =>
    issueConfigProxyGrant('preset-instance-a', 'unarr-nzb', 'http://unarr.app')
  );
});

test('binds Unarr grants to NZB downloads on the signed origin', () => {
  const token = issueConfigProxyGrant(
    'preset-instance-a',
    'unarr-nzb',
    'https://unarr.app'
  );
  const grant = verifyConfigProxyGrant(token);
  assert.ok(grant);
  assert.equal(
    isConfigProxyRequestAllowed(grant, {
      url: 'https://unarr.app/api/internal/agent/nzb-download?nzbId=123',
      type: 'nzb',
    }),
    true
  );
  assert.equal(
    isConfigProxyRequestAllowed(grant, {
      url: 'https://unarr.app/api/internal/agent/nzb-download?nzbId=123',
      type: 'stream',
    }),
    false
  );
  assert.equal(
    isConfigProxyRequestAllowed(grant, {
      url: 'https://evil.example/api/internal/agent/nzb-download?nzbId=123',
      type: 'nzb',
    }),
    false
  );
  assert.equal(
    isConfigProxyRequestAllowed(grant, {
      url: 'https://unarr.app/api/internal/agent/me',
      type: 'nzb',
    }),
    false
  );
});

test('generates a per-config Unarr proxy grant without AIOSTREAMS_AUTH input', () => {
  const options = {
    name: 'Unarr test',
    unarrAuth: {
      apiUrl: 'https://unarr.app',
      apiKey: 'tc_test-only-key',
    },
  };
  const grant = issueUnarrConfigProxyGrant(
    'unarr-config-test',
    'https://unarr.app'
  );
  assert.match(grant, /^pcg_/);
  assert.ok(verifyConfigProxyGrant(grant));
  assert.equal(options.proxyAuth, undefined);
});

test('formats Unarr NZBs with TorrentClaw metadata and pack sizes', () => {
  const addon = {
    name: 'TorrentClaw Unarr',
    instanceId: 'unarr-test',
    preset: {
      id: 'test',
      type: 'unarr-indexer',
      options: { formatting: {} },
    },
  } as Addon;
  const stream = {
    behaviorHints: {
      folderSize: 10_000_000_000,
    },
    unarr: {
      grabs: 1234,
      category: 'TV > HD',
      group: 'GROUP',
    },
  } as Stream;
  const parsed = {
    service: { id: 'aiostreams', cached: true },
    library: false,
  } as ParsedStream;
  const parser = new TestUnarrParser(addon);

  assert.equal(parser.indexer(), 'TorrentClaw');
  assert.equal(parser.folderSize(stream, parsed), 10_000_000_000);
  assert.equal(parser.releaseGroup(stream, parsed), 'GROUP');
  assert.deepEqual(parser.extras(stream, parsed)?.formattingSuffix, [
    '🦞 Unarr · 1,234 grabs · TV > HD',
    '⚡ Cached',
  ]);
});

test('can hide pack size and optional Unarr formatting fields', () => {
  const addon = {
    name: 'TorrentClaw Unarr',
    instanceId: 'unarr-hidden-test',
    preset: {
      id: 'test',
      type: 'unarr-indexer',
      options: {
        formatting: {
          showEpisodeAndPackSizes: false,
          showGrabs: false,
          showCategory: false,
          showGroup: false,
        },
      },
    },
  } as Addon;
  const stream = {
    behaviorHints: { folderSize: 2_000_000_000 },
    unarr: { grabs: 99, category: 'Movies', group: 'GROUP' },
  } as Stream;
  const parsed = {
    service: { id: 'aiostreams', cached: false },
    library: false,
  } as ParsedStream;
  const parser = new TestUnarrParser(addon);

  assert.equal(parser.folderSize(stream, parsed), undefined);
  assert.equal(parser.releaseGroup(stream, parsed), undefined);
  assert.deepEqual(parser.extras(stream, parsed)?.formattingSuffix, [
    '🦞 Unarr',
    '⏳ Uncached',
  ]);
});
