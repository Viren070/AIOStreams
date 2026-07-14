import { settingsStore } from '../../../config/index.js';
import { createLogger } from '../../../logging/logger.js';
import { UsenetMetricsRepository } from '../../../db/index.js';
import {
  ProviderConfig,
  parseNzb,
  UsenetEngine,
  type Nzb,
  type NzbSegment,
} from '../../index.js';
import { detectFileType } from '../../pool/file-type.js';
import { NntpConnection } from '../../nntp/connection.js';
import { NntpError } from '../../nntp/errors.js';
import { getSpeedTestEngineConfig, usenetEngineRegistry } from '../engine.js';
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
  /** Aggregate download rate in bytes/second over the steady-state window. */
  bytesPerSec?: number;
  /** Wire bytes counted during the steady-state measurement window. */
  bytes?: number;
  /** Duration of the steady-state measurement window, ms. */
  durationMs?: number;
  /** Number of articles fetched. */
  segments?: number;
  /** In-flight BODY commands per connection (NNTP pipelining). */
  pipelineDepth?: number;
  /** Connections fanned out across (parallel width = connections × depth). */
  connections?: number;
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
  // Drop warm engines so the next request rebuilds with the saved providers.
  usenetEngineRegistry.invalidate();
}

/** Test a single provider connection (dial + auth + DATE health probe).
 *
 * `latencyMs` in the result measures only the DATE command round-trip after the
 * connection (TCP/TLS/greeting/auth) is fully established, so it reflects the
 * true server responsiveness rather than including connection setup overhead. */
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
    name: provider.name,
    host: provider.host,
    port: provider.port,
    tls: provider.tls ?? false,
    tlsSkipVerify: provider.tlsSkipVerify,
    username: provider.username,
    password,
    maxConnections: 1,
    priority: provider.priority ?? 0,
  };

  let conn: NntpConnection | undefined;
  try {
    conn = await NntpConnection.connect(config, {
      dialTimeoutMs: 15_000,
      idleConnectionMs: 60_000,
    });
    // Measure only the DATE round-trip; connection setup is already done.
    const start = Date.now();
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

/**
 * Fixed, well-propagated test NZB to stream for the throughput measurement (the
 * SABnzbd download-speed test file the wider usenet community uses). Blasting a
 * known-good, fully-available file makes the result reflect the provider + line
 * capability rather than the availability of whatever is in the user's library.
 * Override with `USENET_SPEEDTEST_NZB_URL`; the articles must be retained on the
 * provider under test (otherwise the test reports `article_not_found`).
 */
const SPEEDTEST_NZB_URL =
  process.env.USENET_SPEEDTEST_NZB_URL ||
  'https://sabnzbd.org/tests/test_download_1GB.nzb';
/** Stop once this many WIRE bytes have been fetched (caps quota per run). */
const SPEEDTEST_MAX_BYTES = 1024 * 1024 * 1024;
/** Hard wall-clock cap for the measurement, timed from the first byte. */
const SPEEDTEST_MAX_MS = 12_000;
/**
 * Discard this much of the transfer (from the first byte) before the steady-
 * state window opens. A fan-out's first ~second is the connection dial/auth
 * ramp where not every connection is up yet; charging it against the rate would
 * understate sustained throughput.
 */
const SPEEDTEST_WARMUP_MS = 1_500;
/** Singleflight: one in-flight speed test per provider id (avoid storms). */
const speedTestInFlight = new Map<string, Promise<ProviderSpeedTestResult>>();

/** A parsed NZB plus the data-file indexes to stream, largest first. */
export interface SpeedTestSource {
  nzb: Nzb;
  fileIndexes: number[];
}

/**
 * Parsed test NZB, cached module-level keyed by URL: repeated tests don't
 * re-fetch sabnzbd.org, and a transient outage after the first fetch doesn't
 * break later runs.
 */
let cachedTestSource: { url: string; source: SpeedTestSource } | null = null;

/**
 * Indexes of the streamable DATA files in an NZB, largest (by encoded size)
 * first. Reuses {@link detectFileType} (extension-only here, no bytes yet) to
 * keep only real content (video/archive) and never PAR2/NFO/SFV/subtitle/image
 * sidecars, whose articles are often missing and never represent throughput.
 */
export function dataFileIndexes(nzb: Nzb): number[] {
  return nzb.files
    .map((f, i) => ({ i, f }))
    .filter(({ f }) => {
      if (f.segments.length === 0) return false;
      const { category } = detectFileType(
        Buffer.alloc(0),
        f.filename ?? f.subject
      );
      return category === 'video' || category === 'archive';
    })
    .sort((a, b) => b.f.encodedSize - a.f.encodedSize)
    .map(({ i }) => i);
}

/**
 * Resolve the fixed test NZB to stream (parsed once, then cached). Returns null
 * when the NZB can't be fetched/parsed or carries no data files; there is no
 * library fallback, so the caller surfaces that as a hard error.
 */
async function resolveSpeedTestSource(
  signal?: AbortSignal
): Promise<SpeedTestSource | null> {
  if (cachedTestSource?.url === SPEEDTEST_NZB_URL) {
    return cachedTestSource.source;
  }
  try {
    const xml = await fetchNzb(SPEEDTEST_NZB_URL, signal);
    const nzb = await parseNzb(xml);
    const fileIndexes = dataFileIndexes(nzb);
    if (fileIndexes.length === 0) return null;
    const source: SpeedTestSource = { nzb, fileIndexes };
    cachedTestSource = { url: SPEEDTEST_NZB_URL, source };
    return source;
  } catch (err) {
    logger.debug(
      { url: SPEEDTEST_NZB_URL, err: (err as Error).message },
      'speed-test NZB unreachable'
    );
    return null;
  }
}

/** Outcome of a throughput run: the steady-state window plus totals. */
interface ThroughputResult {
  /** Wire bytes counted inside the steady-state window. */
  windowWireBytes: number;
  /** Steady-state window duration, ms (≥1 once any byte arrived). */
  windowMs: number;
  /** Total wire bytes fetched (whole run). */
  wireBytes: number;
  /** Total decoded bytes fetched (whole run). */
  decodedBytes: number;
  /** Articles successfully fetched. */
  segments: number;
  /** Last per-fetch error, surfaced when nothing was fetched. */
  lastError?: unknown;
}

/**
 * Measure provider throughput by blasting every data segment of the test file
 * across the whole pool out of order and discarding the bytes: a raw capability
 * measurement, not a single in-order playback stream (which is gated by
 * reassembly and the Readable pipeline and reads far lower). `concurrency`
 * workers (= connections × pipeline depth) saturate the pool's pipelines exactly
 * like a production fan-out.
 *
 * Counts wire bytes (each article's NZB-declared yEnc-encoded size, i.e. what
 * crossed the socket; falls back to the decoded length when the NZB omits it)
 * over a steady-state window that opens after {@link SPEEDTEST_WARMUP_MS}, so the
 * one-time dial/auth ramp isn't charged against the rate. Stops at the byte
 * budget or the wall-clock cap.
 */
export async function measureThroughput(
  engine: UsenetEngine,
  source: SpeedTestSource,
  concurrency: number,
  signal?: AbortSignal
): Promise<ThroughputResult> {
  // Flatten every segment of the data files into one work list, largest file
  // first (dataFileIndexes order), to dispatch out of order.
  const work: NzbSegment[] = [];
  for (const fileIndex of source.fileIndexes) {
    for (const s of source.nzb.files[fileIndex].segments) work.push(s);
  }

  let wireBytes = 0;
  let decodedBytes = 0;
  let segments = 0;
  let firstByteAt = 0;
  let lastByteAt = 0;
  let windowStart = 0; // steady-state window opens after the warm-up
  let windowStartWire = 0; // cumulative wire bytes when the window opened
  let lastError: unknown;
  let next = 0;
  let stop = false;

  const worker = async (): Promise<void> => {
    while (!stop && !signal?.aborted) {
      const i = next++;
      if (i >= work.length) return;
      try {
        const d = await engine.fetchArticle(work[i], source.nzb.hash, signal);
        const now = Date.now();
        if (!firstByteAt) firstByteAt = now;
        // NZB-declared segment size = the posted (yEnc-encoded) wire size; fall
        // back to the decoded length when the NZB omits it.
        wireBytes += work[i].bytes > 0 ? work[i].bytes : d.size;
        decodedBytes += d.size;
        segments++;
        lastByteAt = now;
        if (windowStart === 0 && now - firstByteAt >= SPEEDTEST_WARMUP_MS) {
          windowStart = now;
          windowStartWire = wireBytes;
        }
        if (
          wireBytes >= SPEEDTEST_MAX_BYTES ||
          now - firstByteAt >= SPEEDTEST_MAX_MS
        ) {
          stop = true;
        }
      } catch (err) {
        lastError = err;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker())
  );

  // Prefer the post-warm-up steady-state window; fall back to the whole transfer
  // for the rare test that finishes (or hits a cap) before the warm-up elapses.
  const haveWindow = windowStart > 0 && wireBytes - windowStartWire > 0;
  const windowWireBytes = haveWindow ? wireBytes - windowStartWire : wireBytes;
  const windowMs = haveWindow
    ? Math.max(1, lastByteAt - windowStart)
    : firstByteAt
      ? Math.max(1, lastByteAt - firstByteAt)
      : 0;

  return {
    windowWireBytes,
    windowMs,
    wireBytes,
    decodedBytes,
    segments,
    lastError,
  };
}

/**
 * Measure a provider's download capability by fanning the fixed test NZB out
 * across the whole pool out of order ({@link measureThroughput}), yEnc-decoding
 * each article like playback but discarding the bytes. The engine is built with
 * only the provider under test so the rate is attributable to it. Singleflighted
 * per provider id so repeated clicks don't open a connection storm; the transfer
 * is folded into the hourly rollups so it shows in the windowed average.
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

  const source = await resolveSpeedTestSource(signal);
  if (!source) {
    return {
      ok: false,
      code: 'test_nzb_unreachable',
      error: `Could not fetch the speed-test NZB (${SPEEDTEST_NZB_URL}).`,
    };
  }

  // A single-provider, primary, enabled config so the engine fetches ONLY from
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
  const depth = summary.pipelineDepth;
  // The global in-flight download budget (an explicit maxConcurrentDownloads, or
  // the auto Σ conn×depth) is now a hard cap, so the test honours it: fan out the
  // provider's full pipeline capacity, clamped to that budget. Sockets used =
  // in-flight ÷ depth (pipelining packs `depth` requests onto each connection).
  const budget = Math.max(
    1,
    options.maxConcurrentDownloads ?? providerConfig.maxConnections * depth
  );
  const connections = Math.max(
    1,
    Math.min(providerConfig.maxConnections, Math.floor(budget / depth))
  );
  const concurrency = connections * depth;
  const config = { connections, pipelineDepth: depth };
  // Bound the test engine's account to `connections` sockets so it uses exactly
  // the connections × depth in-flight we report (and never exceeds the budget).
  const engine = new UsenetEngine(
    [{ ...providerConfig, maxConnections: connections }],
    {
      ...options,
      // Never share the warm engine's on-disk cache: measure cold network reads
      // rather than a cache replay.
      segmentDiskCacheBytes: 0,
      segmentDiskCachePath: undefined,
    }
  );

  try {
    const { windowWireBytes, windowMs, segments, lastError } =
      await measureThroughput(engine, source, concurrency, signal);

    if (segments === 0 || windowWireBytes <= 0) {
      const code = lastError instanceof NntpError ? lastError.kind : 'no_data';
      const error =
        lastError instanceof NntpError && lastError.kind === 'auth_failed'
          ? 'Authentication failed: check the username and password.'
          : lastError instanceof NntpError &&
              lastError.kind === 'article_not_found'
            ? 'No articles fetched: the test article is missing on this provider.'
            : lastError instanceof Error
              ? `No articles fetched: ${lastError.message}`
              : 'No articles fetched';
      logger.debug(
        { host, code, error },
        'provider speed test fetched no bytes'
      );
      return { ok: false, code, error, ...config };
    }

    // Aggregate wire bytes/sec (raw socket bytes) over the steady-state window.
    const bytesPerSec = Math.round(windowWireBytes / (windowMs / 1000));

    // Fold the real transfer into the rollups (decoded bytes, real per-fetch
    // durations) so it contributes to the window average speed.
    const deltas = engine.drainMetrics();
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

    return {
      ok: true,
      bytesPerSec,
      bytes: windowWireBytes,
      durationMs: windowMs,
      segments,
      ...config,
    };
  } catch (err) {
    const code = err instanceof NntpError ? err.kind : 'unknown';
    const error = err instanceof Error ? err.message : String(err);
    logger.debug({ host, code, error }, 'provider speed test failed');
    return { ok: false, error, code, ...config };
  } finally {
    engine.close();
  }
}
