#!/usr/bin/env node

const core = await import(
  '../packages/core/dist/builtins/newshosting-indexer/index.js'
);

const media = { type: 'series', season: 1, episode: 1 };
const metadata = {
  title: 'The Mentalist',
  aliases: ['The Mentalist'],
  year: 2008,
  countries: ['US'],
};
const queries = core.buildNewshostingQueries(metadata, media);
if (queries[0] !== 'The Mentalist S01E01') {
  throw new Error('native_query_smoke_failed');
}

const username = process.env.NEWSHOSTING_USERNAME?.trim();
const password = process.env.NEWSHOSTING_PASSWORD;
if (!username || !password) {
  console.log(
    JSON.stringify({
      nativeModule: true,
      queryPlan: queries,
      credentialed: false,
    })
  );
  process.exit(0);
}

const options = {
  username,
  password,
  host: process.env.NEWSHOSTING_SERVER_HOST || 'srv.aboutusenet.com',
  ip: process.env.NEWSHOSTING_SERVER_IP || '81.171.93.8',
  port: Number(process.env.NEWSHOSTING_SERVER_PORT || 5598),
  timeoutMs: Number(process.env.NEWSHOSTING_TIMEOUT_MS || 15_000),
  maxNzbFiles: Number(process.env.NEWSHOSTING_MAX_NZB_FILES || 32),
};
const client = new core.NewshostingClient(options);

try {
  await client.connect();
  const response = await client.search(queries[0], 1, 50);
  const ranked = response.results
    .map((result) => {
      const parsed = core.parseNewshostingRelease(result.name);
      const match = core.scoreNewshostingReleaseMatch(
        result.name,
        media,
        parsed,
        metadata
      );
      return {
        result,
        match,
        rank: core.rankNewshostingResult(result, match.score),
      };
    })
    .filter((item) => item.match.score >= 650)
    .sort((a, b) => b.rank - a.rank);

  let nzbBytes = 0;
  if (process.env.NEWSHOSTING_SMOKE_CREATE_NZB === '1' && ranked[0]) {
    const nzb = await client.createNzb(
      ranked[0].result.index,
      ranked[0].result.scope,
      ranked[0].result.itemId
    );
    if (!nzb.startsWith('<?xml') || !nzb.includes('<nzb ')) {
      throw new Error('newshosting_smoke_invalid_nzb');
    }
    nzbBytes = Buffer.byteLength(nzb, 'utf8');
  }

  console.log(
    JSON.stringify({
      nativeModule: true,
      credentialed: true,
      login: true,
      rawResults: response.results.length,
      matchedResults: ranked.length,
      nzbGenerated: nzbBytes > 0,
      nzbBytes,
    })
  );
} finally {
  client.close();
}
