import { readFile } from 'node:fs/promises';

const input = process.env.TEST_INPUT_FILE
  ? JSON.parse(await readFile(process.env.TEST_INPUT_FILE, 'utf8'))
  : undefined;
const manifestUrl = process.env.AIOSTREAMS_MANIFEST_URL || input?.manifest;
if (!manifestUrl) throw new Error('AIOSTREAMS_MANIFEST_URL is required');

const manifest = new URL(manifestUrl);
if (process.env.TEST_ORIGIN) {
  const origin = new URL(process.env.TEST_ORIGIN);
  manifest.protocol = origin.protocol;
  manifest.host = origin.host;
}
const base = manifest.toString().replace(/\/manifest\.json$/, '');
const delayMs = Math.max(1_000, Number(process.env.TEST_DELAY_MS || 5_000));
const timeoutMs = Math.max(10_000, Number(process.env.TEST_TIMEOUT_MS || 150_000));
const cases = input?.cases || JSON.parse(process.env.TEST_CASES_JSON || '[]');

for (const item of cases) {
  const started = performance.now();
  const url = `${base}/stream/${item.type}/${encodeURIComponent(item.id)}.json`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AIOStreams-live-matrix/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json();
    const streams = Array.isArray(payload.streams) ? payload.streams : [];
    const errors = streams
      .filter((stream) =>
        /timeout|certificate|fetch failed|aborted/i.test(
          `${stream.name || ''}\n${stream.description || ''}`
        )
      )
      .map((stream) => ({
        name: stream.name,
        description: String(stream.description || '').slice(0, 300),
      }));
    process.stdout.write(
      `${JSON.stringify({
        label: item.label,
        status: response.status,
        elapsedMs: Math.round(performance.now() - started),
        streamCount: streams.length,
        deepbridCount: streams.filter((stream) =>
          /deepbrid/i.test(`${stream.name || ''}\n${stream.description || ''}`)
        ).length,
        errors,
      })}\n`
    );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        label: item.label,
        elapsedMs: Math.round(performance.now() - started),
        requestError: error instanceof Error ? error.message : String(error),
      })}\n`
    );
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
