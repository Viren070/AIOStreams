import { readFile } from 'node:fs/promises';

const input = JSON.parse(await readFile(process.env.TEST_INPUT_FILE, 'utf8'));
const base = input.manifest.replace(/\/manifest\.json$/, '');
const response = await fetch(`${base}/stream/movie/tt0133093.json`, {
  signal: AbortSignal.timeout(150_000),
  headers: { 'User-Agent': 'AIOStreams-Deepbrid-playback-smoke/1.0' },
});
const payload = await response.json();
const stream = (payload.streams || []).find(
  (item) =>
    typeof item.url === 'string' &&
    /(?:deepbrid|\bDB\b)/i.test(
      `${item.name || ''}\n${item.description || ''}`
    ) &&
    !/timeout|certificate|aborted/i.test(item.description || '')
);
if (!stream) {
  process.stdout.write(
    JSON.stringify(
      (payload.streams || [])
        .filter((item) =>
          /(?:deepbrid|\bDB\b)/i.test(
            `${item.name || ''}\n${item.description || ''}`
          )
        )
        .map((item) => ({
          name: item.name,
          description: String(item.description || '').slice(0, 180),
          hasUrl: typeof item.url === 'string',
          urlHost:
            typeof item.url === 'string' ? new URL(item.url).hostname : null,
        }))
    )
  );
  throw new Error('No playable Deepbrid stream returned');
}

const range = await fetch(stream.url, {
  headers: { Range: 'bytes=0-65535' },
  signal: AbortSignal.timeout(120_000),
});
const body = await range.arrayBuffer();
if (![200, 206].includes(range.status) || body.byteLength === 0) {
  throw new Error(`Deepbrid Range playback failed: ${range.status}`);
}
process.stdout.write(
  JSON.stringify({
    status: range.status,
    bytes: body.byteLength,
    contentRange: Boolean(range.headers.get('content-range')),
    acceptRanges: range.headers.get('accept-ranges'),
    filename: stream.behaviorHints?.filename,
  })
);
