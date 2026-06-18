import type { Readable } from 'node:stream';
import { settingsStore } from '../../../config/index.js';
import { createLogger } from '../../../logging/logger.js';
import {
  UsenetMetricsRepository,
  UsenetLibraryRepository,
} from '../../../db/index.js';
import {
  ProviderConfig,
  parseNzb,
  UsenetEngine,
  type Nzb,
  type SeekableStream,
} from '../../index.js';
import { NntpConnection } from '../../nntp/connection.js';
import { NntpError } from '../../nntp/errors.js';
import { getSpeedTestEngineConfig } from '../engine.js';
import { fetchNzb } from '../library.js';

const logger = createLogger('usenet/dashboard');

/** Placeholder returned/accepted in place of a stored provider password. */
export const PROVIDER_SECRET_MASK = '__stored__';

/** Provider config with the password redacted for the dashboard. */
export interface MaskedProvider extends Omit<ProviderConfig, 'password'> {
  /** True when a password is stored (the value itself is never returned). */
  hasPassword: boolean;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  code?: string;
}

export interface ProviderSpeedTestResult {
  ok: boolean;
  /** Measured download rate in bytes/second. */
  bytesPerSec?: number;
  /** Bytes downloaded during the test. */
  bytes?: number;
  /** Wall-clock duration of the streamed transfer window, ms. */
  durationMs?: number;
  /** Number of articles fetched. */
  segments?: number;
  /** Parallel socket fetches per stream the test ran under. */
  connectionsPerStream?: number;
  /** In-flight BODY commands per connection (NNTP pipelining). */
  pipelineDepth?: number;
  /** Read-ahead depth, in segments. */
  prefetchSegments?: number;
  error?: string;
  code?: string;
}

/** Read configured providers (passwords masked) for the dashboard editor. */
export function getUsenetProviders(): MaskedProvider[] {
  const providers = (settingsStore.current.usenet?.providers ??
    []) as ProviderConfig[];
  return providers.map(({ password, ...rest }) => ({
    ...rest,
    hasPassword: !!password,
  }));
}

/**
 * Persist the provider list. Any provider whose password equals
 * {@link PROVIDER_SECRET_MASK} keeps its previously-stored password (matched by
 * id), so the editor never has to round-trip secrets. Validation + encryption
 * happen in the settings store.
 */
export async function saveUsenetProviders(
  incoming: (Partial<ProviderConfig> & { password?: string })[],
  username?: string
): Promise<void> {
  const existing = (settingsStore.current.usenet?.providers ??
    []) as ProviderConfig[];
  const byId = new Map(existing.map((p) => [p.id, p]));

  const merged = incoming.map((p) => {
    const prev = p.id ? byId.get(p.id) : undefined;
    const password =
      p.password === PROVIDER_SECRET_MASK || p.password === undefined
        ? prev?.password
        : p.password;
    return { ...p, password };
  });

  await settingsStore.set('usenet.providers', merged, username);
}

/** Test a single provider connection (dial + auth + DATE health probe). */
export async function testUsenetProvider(
  provider: Partial<ProviderConfig> & { password?: string },
  signal?: AbortSignal
): Promise<ProviderTestResult> {
  // Resolve a masked password from the stored config by id.
  let password = provider.password;
  if (password === PROVIDER_SECRET_MASK || password === undefined) {
    const existing = (settingsStore.current.usenet?.providers ??
      []) as ProviderConfig[];
    password = existing.find((p) => p.id === provider.id)?.password;
  }

  if (!provider.host || !provider.port) {
    return { ok: false, error: 'host and port are required', code: 'invalid' };
  }

  const config: ProviderConfig = {
    id: provider.id ?? 'test',
    host: provider.host,
    port: provider.port,
    tls: provider.tls ?? false,
    tlsSkipVerify: provider.tlsSkipVerify,
    username: provider.username,
    password,
    maxConnections: 1,
    priority: provider.priority ?? 0,
  };

  const start = Date.now();
  let conn: NntpConnection | undefined;
  try {
    conn = await NntpConnection.connect(config, {
      dialTimeoutMs: 15_000,
      idleConnectionMs: 60_000,
    });
    await conn.date(signal, 15_000);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    const code = err instanceof NntpError ? err.kind : 'unknown';
    const error = err instanceof Error ? err.message : String(err);
    logger.debug({ host: config.host, code, error }, 'provider test failed');
    return { ok: false, error, code };
  } finally {
    conn?.quit();
  }
}

// --- Provider speed test ----------------------------------------------------

/** Stop the test once this many bytes have been streamed. */
const SPEEDTEST_MAX_BYTES = 96 * 1024 * 1024;
/** Hard wall-clock cap for the measurement phase. */
const SPEEDTEST_MAX_MS = 10_000;
/**
 * Discard this much of the transfer before measuring. A real playback runs for
 * minutes and amortises the connection dial + GROUP select + initial buffer
 * fill; a 10s test would otherwise count that cold ramp against the rate. The
 * warm-up makes the result reflect sustained throughput.
 */
const SPEEDTEST_WARMUP_MS = 1_000;
/**
 * RAM-only segment cache for the throughput engine. The warm registry engine
 * owns the shared on-disk `segments` cache as the single writer, so the
 * speed-test engine must never touch disk; this also keeps the measurement a
 * cold network read rather than a cache replay.
 */
const SPEEDTEST_CACHE_BYTES = 64 * 1024 * 1024;
/** How many distinct library entries to resolve into speed-test samples. */
const SPEEDTEST_MAX_SAMPLES = 5;
/** Singleflight: one in-flight speed test per provider id (avoid storms). */
const speedTestInFlight = new Map<string, Promise<ProviderSpeedTestResult>>();

/** A real file to stream for the speed test: a parsed NZB + the file to open. */
interface SpeedTestSample {
  nzb: Nzb;
  fileIndex: number;
}

/**
 * Resolve real files to stream for a speed test from already-imported, available
 * library entries. Returns several samples (the largest file of different
 * entries) because availability is decided across the whole provider pool: a
 * given entry's articles may not be carried by the single provider under test,
 * so the runner can fall back to another sample. Empty when nothing is
 * importable.
 */
async function resolveSpeedTestSamples(
  maxSamples = SPEEDTEST_MAX_SAMPLES
): Promise<SpeedTestSample[]> {
  const { entries } = await UsenetLibraryRepository.list({
    group: 'history',
    limit: 25,
  });
  const candidates = entries.filter(
    (e) => e.status === 'available' && e.nzbUrl
  );
  const samples: SpeedTestSample[] = [];
  for (const entry of candidates) {
    if (samples.length >= maxSamples) break;
    try {
      const xml = await fetchNzb(entry.nzbUrl!);
      const nzb = await parseNzb(xml);
      // Largest file by encoded size: the most data to stream for a stable rate.
      let fileIndex = -1;
      let best = -1;
      nzb.files.forEach((f, i) => {
        if (f.segments.length > 0 && f.encodedSize > best) {
          best = f.encodedSize;
          fileIndex = i;
        }
      });
      if (fileIndex >= 0) samples.push({ nzb, fileIndex });
    } catch {
      // Try the next candidate.
    }
  }
  return samples;
}

/**
 * Read a range stream in FLOWING mode until the byte budget, the time cap, end,
 * or an error, counting decoded bytes and timing from the first byte.
 *
 * Flowing mode (`.on('data')`) is required: the engine's range stream only
 * re-resumes its inner prefetch on the OUTER stream's `resume` event, which a
 * paused `for await` consumer never emits, so it would deadlock the moment the
 * prefetch buffer fills. The hard cap also guarantees the request can't hang
 * forever if a provider stalls mid-transfer.
 */
function measureStream(
  readable: Readable,
  signal?: AbortSignal
): Promise<{ bytes: number; durationMs: number; error?: unknown }> {
  return new Promise((resolve) => {
    let totalBytes = 0; // since first byte; fallback for transfers shorter than warm-up
    let firstByteAt = 0;
    let windowBytes = 0; // steady-state: bytes after the warm-up
    let windowStart = 0;
    let done = false;
    const finish = (error?: unknown): void => {
      if (done) return;
      done = true;
      clearTimeout(cap);
      readable.destroy();
      const now = Date.now();
      // Prefer the post-warm-up steady-state window; fall back to the whole
      // transfer for files that finished during (or just after) the warm-up.
      const useWindow = windowStart > 0 && now - windowStart >= 250;
      resolve({
        bytes: useWindow ? windowBytes : totalBytes,
        durationMs: useWindow
          ? now - windowStart
          : firstByteAt
            ? now - firstByteAt
            : 0,
        error,
      });
    };
    const cap = setTimeout(() => finish(), SPEEDTEST_MAX_MS);
    cap.unref?.();
    readable.on('data', (chunk: Buffer) => {
      const now = Date.now();
      if (!firstByteAt) firstByteAt = now;
      totalBytes += chunk.length;
      // Once past the warm-up, start the steady-state accounting.
      if (windowStart === 0 && now - firstByteAt >= SPEEDTEST_WARMUP_MS) {
        windowStart = now;
      }
      if (windowStart > 0) windowBytes += chunk.length;
      if (totalBytes >= SPEEDTEST_MAX_BYTES) finish();
    });
    readable.on('end', () => finish());
    readable.on('error', (err) => finish(err));
    if (signal) {
      if (signal.aborted) finish();
      else signal.addEventListener('abort', () => finish(), { once: true });
    }
  });
}

/**
 * Measure a provider's download throughput by streaming a real library file
 * through the actual engine path (`UsenetEngine.openFileStream` →
 * `FileStream.createReadStream` → the multi-provider pool) so the test honours
 * the configured `maxConnectionsPerStream`, pipeline depth and `prefetchSegments`
 * (and yEnc-decodes like playback), replicating a real stream. The engine is
 * built with ONLY the provider under test so the rate is attributable to it.
 * Singleflighted per provider id so repeated clicks don't open a connection
 * storm; the measured bytes are folded into the hourly rollups so the result
 * shows in the windowed average.
 */
export async function runProviderSpeedTest(
  provider: Partial<ProviderConfig> & { password?: string },
  signal?: AbortSignal
): Promise<ProviderSpeedTestResult> {
  const key = provider.id ?? `${provider.host}:${provider.port}`;
  const existing = speedTestInFlight.get(key);
  if (existing) return existing;
  const run = runProviderSpeedTestInner(provider, signal).finally(() =>
    speedTestInFlight.delete(key)
  );
  speedTestInFlight.set(key, run);
  return run;
}

async function runProviderSpeedTestInner(
  provider: Partial<ProviderConfig> & { password?: string },
  signal?: AbortSignal
): Promise<ProviderSpeedTestResult> {
  // Resolve a masked/stored password + any missing fields from the saved config.
  const stored = (settingsStore.current.usenet?.providers ??
    []) as ProviderConfig[];
  const saved = provider.id
    ? stored.find((p) => p.id === provider.id)
    : undefined;
  let password = provider.password;
  if (password === PROVIDER_SECRET_MASK || password === undefined) {
    password = saved?.password;
  }
  const host = provider.host ?? saved?.host;
  const port = provider.port ?? saved?.port;
  if (!host || !port) {
    return { ok: false, error: 'host and port are required', code: 'invalid' };
  }

  const samples = await resolveSpeedTestSamples();
  if (samples.length === 0) {
    return {
      ok: false,
      code: 'no_sample',
      error: 'Import an NZB first: a speed test downloads from your library.',
    };
  }

  // A single-provider, primary, enabled config so the engine streams ONLY from
  // the provider under test (no failover muddying the measured rate).
  const providerConfig: ProviderConfig = {
    id: provider.id ?? 'speedtest',
    name: provider.name ?? saved?.name,
    host,
    port,
    tls: provider.tls ?? saved?.tls ?? false,
    tlsSkipVerify: provider.tlsSkipVerify ?? saved?.tlsSkipVerify,
    username: provider.username ?? saved?.username,
    password,
    maxConnections: provider.maxConnections ?? saved?.maxConnections ?? 8,
    priority: 0,
    isBackup: false,
    enabled: true,
    pipelineDepth: provider.pipelineDepth ?? saved?.pipelineDepth,
  };

  const { options, summary } = getSpeedTestEngineConfig(providerConfig);
  const config = {
    connectionsPerStream: summary.connectionsPerStream,
    pipelineDepth: summary.pipelineDepth,
    prefetchSegments: summary.prefetchSegments,
  };
  const engine = new UsenetEngine([providerConfig], {
    ...options,
    // RAM-only, never share the warm engine's on-disk segment cache.
    segmentDiskCacheBytes: 0,
    segmentDiskCachePath: undefined,
    segmentCacheBytes: Math.min(
      options.segmentCacheBytes ?? SPEEDTEST_CACHE_BYTES,
      SPEEDTEST_CACHE_BYTES
    ),
  });

  try {
    let bytes = 0;
    let durationMs = 0;
    let probeError: unknown;
    let lastError: unknown;
    for (const sample of samples) {
      if (signal?.aborted) break;
      let stream: SeekableStream;
      try {
        // open() fetches the first segment, doubling as the availability probe:
        // a 430 (article missing on THIS provider) throws and we try the next.
        stream = await engine.openFileStream(
          sample.nzb,
          { fileIndex: sample.fileIndex },
          signal
        );
      } catch (err) {
        probeError = err;
        continue;
      }
      const readable = stream.createReadStream({
        start: 0,
        end: SPEEDTEST_MAX_BYTES,
      });
      const measured = await measureStream(readable, signal);
      if (measured.error) lastError = measured.error;
      if (measured.bytes > 0) {
        bytes = measured.bytes;
        durationMs = measured.durationMs;
        break;
      }
      // Nothing streamed from this sample (missing on this provider); try next.
    }

    if (bytes <= 0) {
      const errSrc = lastError ?? probeError;
      const code = errSrc instanceof NntpError ? errSrc.kind : 'no_data';
      const error =
        errSrc instanceof NntpError && errSrc.kind === 'auth_failed'
          ? 'Authentication failed: check the username and password.'
          : errSrc instanceof NntpError && errSrc.kind === 'article_not_found'
            ? 'No articles fetched: the sample articles are missing on this provider.'
            : errSrc instanceof Error
              ? `No articles fetched: ${errSrc.message}`
              : 'No articles fetched';
      logger.debug(
        { host, code, error, samples: samples.length },
        'provider speed test streamed no bytes'
      );
      return { ok: false, code, error, ...config };
    }

    const bytesPerSec = Math.round(bytes / (Math.max(1, durationMs) / 1000));

    // Fold the real transfer into the rollups (decoded bytes, real per-fetch
    // durations) so it contributes to the window average speed. The drain also
    // yields the article count for the result.
    const deltas = engine.drainMetrics();
    const segments = deltas.reduce((n, d) => n + d.articles, 0);
    if (provider.id) {
      try {
        await UsenetMetricsRepository.addDeltas(deltas);
      } catch (err) {
        logger.debug(
          { host, err: (err as Error).message },
          'failed to fold speed test into rollups'
        );
      }
    }

    return { ok: true, bytesPerSec, bytes, durationMs, segments, ...config };
  } catch (err) {
    const code = err instanceof NntpError ? err.kind : 'unknown';
    const error = err instanceof Error ? err.message : String(err);
    logger.debug({ host, code, error }, 'provider speed test failed');
    return { ok: false, error, code, ...config };
  } finally {
    engine.close();
  }
}
