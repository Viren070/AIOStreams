import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import {
  buildNewshostingQueries,
  decodeNewshostingNzbId,
  encodeNewshostingNzbId,
  rankNewshostingResult,
} from './addon.js';
import {
  buildNewshostingNzb,
  parseNewshostingGroups,
} from './client.js';
import {
  decodeNewshostingFrame,
  encodeNewshostingFrame,
} from './protocol.js';
import {
  parseNewshostingRelease,
  scoreNewshostingReleaseMatch,
} from './release.js';
import {
  isConfigProxyRequestAllowed,
  issueConfigProxyGrant,
  verifyConfigProxyGrant,
} from '../../utils/index.js';

test('round-trips the proprietary compressed XML frame', async () => {
  const xml = '<response><login valid="true"/></response>';
  const stream = new PassThrough();
  stream.end(encodeNewshostingFrame(xml));
  assert.equal(await decodeNewshostingFrame(stream, 1_000), xml);
});

test('parses Newshosting group search results', () => {
  const parsed = parseNewshostingGroups(
    '<response><groups items="1" pages="1"><group size="1234" files="2" timestamp="2026-01-02T03:04:05Z" media-category="TV"><id index="idx" scope="scope" item="item"/><title>The.Mentalist.S01E01.1080p.WEB-DL.mkv</title><author>poster</author></group></groups></response>'
  );
  assert.equal(parsed.totalItems, 1);
  assert.deepEqual(parsed.results[0], {
    name: 'The.Mentalist.S01E01.1080p.WEB-DL.mkv',
    size: 1234,
    date: '2026-01-02T03:04:05Z',
    files: 2,
    category: 'TV',
    author: 'poster',
    index: 'idx',
    scope: 'scope',
    itemId: 'item',
  });
});

test('builds valid escaped NZB XML', () => {
  const nzb = buildNewshostingNzb(
    [
      {
        name: 'Episode & One.mkv',
        author: 'poster@example',
        timestamp: '2026-01-02T03:04:05Z',
        articles: [
          { number: 1, bytes: 42, messageId: 'part&one@example' },
        ],
      },
    ],
    ['alt.binaries.test']
  );
  assert.match(nzb, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(nzb, /Episode &amp; One\.mkv/);
  assert.match(nzb, /part&amp;one@example/);
});

test('builds the proven episode-first search plan', () => {
  assert.deepEqual(
    buildNewshostingQueries(
      {
        title: 'The Mentalist',
        aliases: ['The Mentalist'],
        year: 2008,
      },
      { type: 'series', season: 1, episode: 1 }
    ),
    ['The Mentalist S01E01', 'The Mentalist']
  );
});

test('scores exact episodes above mismatched episodes', () => {
  const metadata = {
    title: 'The Mentalist',
    aliases: ['The Mentalist'],
    year: 2008,
    countries: ['US'],
  };
  const media = { type: 'series' as const, season: 1, episode: 1 };
  const exactTitle = 'The.Mentalist.S01E01.1080p.WEB-DL-GROUP';
  const wrongTitle = 'The.Mentalist.S01E02.1080p.WEB-DL-GROUP';
  const exact = scoreNewshostingReleaseMatch(
    exactTitle,
    media,
    parseNewshostingRelease(exactTitle),
    metadata
  );
  const wrong = scoreNewshostingReleaseMatch(
    wrongTitle,
    media,
    parseNewshostingRelease(wrongTitle),
    metadata
  );
  assert.ok(exact.score >= 650);
  assert.ok(exact.score > wrong.score);
});

test('round-trips validated NZB result ids and rejects malformed ids', () => {
  const result = {
    name: 'The.Mentalist.S01E01.1080p.WEB-DL.mkv',
    size: 1_000_000_000,
    date: '2026-01-02T03:04:05Z',
    files: 2,
    category: 'TV',
    author: 'poster',
    index: 'idx',
    scope: 'scope',
    itemId: 'item',
  };
  assert.deepEqual(decodeNewshostingNzbId(encodeNewshostingNzbId(result)), {
    index: 'idx',
    scope: 'scope',
    itemId: 'item',
    title: result.name,
    files: 2,
  });
  assert.throws(() => decodeNewshostingNzbId('not-valid'));
});

test('applies file-count and playable-video ranking signals', () => {
  const base = {
    name: 'Movie.2026.1080p.WEB-DL.mkv',
    size: 5 * 1_073_741_824,
    date: '',
    category: 'Movie',
    author: '',
    index: 'idx',
    scope: 'scope',
    itemId: 'item',
  };
  assert.ok(
    rankNewshostingResult({ ...base, files: 1 }, 800) >
      rankNewshostingResult({ ...base, files: 30 }, 800)
  );
});

test('binds Newshosting grants to only the protected NZB route', () => {
  const token = issueConfigProxyGrant(
    'newshosting-config-a',
    'newshosting-nzb',
    'https://aio.example'
  );
  const grant = verifyConfigProxyGrant(token);
  assert.ok(grant);
  const configToken = 'A'.repeat(64);
  const resultToken = 'B'.repeat(32);
  assert.equal(
    isConfigProxyRequestAllowed(grant, {
      url: `https://aio.example/builtins/newshosting-indexer/${configToken}/nzb/${resultToken}`,
      type: 'nzb',
    }),
    true
  );
  assert.equal(
    isConfigProxyRequestAllowed(grant, {
      url: `https://evil.example/builtins/newshosting-indexer/${configToken}/nzb/${resultToken}`,
      type: 'nzb',
    }),
    false
  );
  assert.equal(
    isConfigProxyRequestAllowed(grant, {
      url: `https://aio.example/builtins/newshosting-indexer/${configToken}/stream/${resultToken}`,
      type: 'nzb',
    }),
    false
  );
  assert.equal(
    isConfigProxyRequestAllowed(grant, {
      url: `https://aio.example/builtins/newshosting-indexer/${configToken}/nzb/${resultToken}`,
      type: 'stream',
    }),
    false
  );
});
