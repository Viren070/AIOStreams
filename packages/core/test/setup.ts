import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV ??= 'test';
env.SECRET_KEY ??= '0'.repeat(64); // 64-char hex required by the validator
env.BASE_URL ??= 'http://localhost:3000'; // Vite-injected '/' would fail it
env.LOG_LEVEL ??= 'error'; // keep test output clean; override to debug locally

const testRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), 'aiostreams-core-test-')
);
env.DATABASE_URI = `sqlite://${path.join(testRoot, 'test.sqlite')}`;
env.DISK_CACHE_DIR = path.join(testRoot, 'cache');
delete env.USENET_PROVIDERS;

// Initialise the config-led import graph before isolated test modules import
// logger-backed utilities directly. The production entry point establishes the
// same order; without it, ESM can enter logger -> redact -> config via a cycle.
const { config, settingsStore } = await import('../src/config/index.js');
const { closeDb, initDb } = await import('../src/db/db.js');

await initDb(config.bootstrap.databaseUri);
await settingsStore.initialise();

after(async () => {
  await closeDb();
  await fs.rm(testRoot, { recursive: true, force: true });
});
