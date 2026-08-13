const apiKey = process.env.DEEPBRID_API_KEY;
if (!apiKey) throw new Error('DEEPBRID_API_KEY is required');

const core = await import('../packages/core/dist/index.js');
await core.initDb('sqlite::memory:');
await core.initialiseConfig();
const { DeepbridUsenetAddon } = core;

const config = {
  services: [],
  apiKey,
  maxResults: 4,
  maxContentResolves: 6,
  resolveConcurrency: 2,
  timeout: 45_000,
};

const cases = [
  { type: 'series', id: 'tt0460681:1:1', label: 'Supernatural S01E01' },
  { type: 'movie', id: 'tt0133093', label: 'The Matrix' },
];

const output = [];
for (const item of cases) {
  const streams = await new DeepbridUsenetAddon(config).getStreams(item.type, item.id);
  const playable = streams.filter((stream) => typeof stream.url === 'string' && stream.url.startsWith('https://'));
  if (!playable.length) throw new Error(`${item.label}: no playable streams`);
  output.push({
    case: item.label,
    streamCount: streams.length,
    playableCount: playable.length,
    firstFilename: playable[0].behaviorHints?.filename,
    firstType: playable[0].type,
    firstIdMatched: playable[0].idMatched,
  });
}
process.stdout.write(JSON.stringify(output, null, 2));
