import {
  createLogger,
  makeRequest,
  type RequestOptions,
} from '../utils/index.js';

const logger = createLogger('failover');

/**
 * Smallest body we will accept as a real release. Debrid providers answer a dead
 * or unavailable link with a few-seconds "content unavailable" clip; those clips
 * are orders of magnitude below this.
 *
 * Deliberately a blanket floor rather than a comparison against the size the
 * source advertised: `ParsedStream.size` is only reliably per-file for our own
 * builtins, and falls back to whatever an external addon put in `stream.size` or
 * its description — often a season-pack total. Sizing the check off that would
 * reject perfectly good single-episode files.
 */
export const MIN_PLAUSIBLE_FILE_SIZE = 16 * 1024 * 1024;

/** How long a probe may take before it is abandoned. */
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

export type ProbeVerdict = { ok: true } | { ok: false; reason: string };

/** The parts of a probe response the classifier reads. */
export interface ProbedBody {
  status: number;
  headers: Headers;
}

/** Total size out of a `Content-Range: bytes 0-0/12345` header, when stated. */
export function parseContentRangeTotal(
  value: string | null | undefined
): number | undefined {
  const total = value?.match(/\/\s*(\d+)\s*$/)?.[1];
  return total === undefined ? undefined : Number(total);
}

/**
 * Decide whether a probed response is the real release or a stand-in error
 * video, from status, content type and declared size alone. Pure — the body is
 * never read.
 */
export function classifyProbedBody({
  status,
  headers,
}: ProbedBody): ProbeVerdict {
  if (status < 200 || status >= 300) {
    return { ok: false, reason: `probe failed with status ${status}` };
  }

  const contentType = headers.get('content-type') ?? '';
  // RFC 9110 §8.3: type and subtype are case-insensitive, so a CDN answering
  // `Video/MP4` is serving a perfectly good file.
  const mediaType = contentType.toLowerCase();
  if (
    !mediaType.startsWith('video/') &&
    !mediaType.startsWith('application/octet-stream')
  ) {
    return {
      ok: false,
      reason: `returned a non-video response (${contentType || status})`,
    };
  }

  if (status === 206) {
    const total = parseContentRangeTotal(headers.get('content-range'));
    if (total !== undefined && total < MIN_PLAUSIBLE_FILE_SIZE) {
      return {
        ok: false,
        reason: `served a ${total}-byte file, too small to be the release`,
      };
    }
    return { ok: true };
  }

  // 200: the server ignored our Range. A link that cannot seek is unusable for
  // playback anyway, so accept it only if it at least declares a real size.
  const lengthHeader = headers.get('content-length');
  const length = lengthHeader === null ? undefined : Number(lengthHeader);
  if (
    length !== undefined &&
    Number.isFinite(length) &&
    length >= MIN_PLAUSIBLE_FILE_SIZE
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `ignored Range and returned ${lengthHeader ?? 'an unsized'} body (${contentType}); treating as an error video`,
  };
}

/** The parts of a response {@link verifyPlaybackUrl} needs. */
export interface ProbeResponse {
  status: number;
  headers: Headers;
  body?: { cancel: () => Promise<unknown> } | null;
}

export type ProbeRequestFn = (
  url: string,
  options: RequestOptions
) => Promise<ProbeResponse>;

export interface VerifyPlaybackOptions {
  clientIp?: string;
  signal?: AbortSignal;
  timeout?: number;
  /** Injectable for tests; defaults to the shared request helper. */
  request?: ProbeRequestFn;
}

const defaultRequest: ProbeRequestFn = makeRequest;

/**
 * A signal that trips when the caller aborts OR when the probe outstays its
 * timeout. `makeRequest` only honours its `timeout` when no signal is supplied,
 * so a probe that forwarded the caller's signal verbatim would inherit the whole
 * failover deadline instead of failing fast.
 */
export function createProbeSignal(
  timeout: number,
  callerSignal: AbortSignal | undefined
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeout);
  return callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;
}

/**
 * Probe a resolved playback URL with a single-byte range request and throw when
 * it looks like a debrid error video rather than the release. The thrown error
 * carries no debrid error code, so the failover chain treats it as retryable and
 * moves on to the next stream.
 *
 * `clientIp` is forwarded so IP-bound CDN links resolve for the client, not the
 * server.
 */
export async function verifyPlaybackUrl(
  url: string,
  opts: VerifyPlaybackOptions = {}
): Promise<void> {
  const request = opts.request ?? defaultRequest;
  const timeout = opts.timeout ?? DEFAULT_PROBE_TIMEOUT_MS;
  const res = await request(url, {
    timeout,
    method: 'GET',
    forwardIp: opts.clientIp,
    signal: createProbeSignal(timeout, opts.signal),
    headers: { Range: 'bytes=0-0' },
  });

  try {
    const verdict = classifyProbedBody({
      status: res.status,
      headers: res.headers,
    });
    if (!verdict.ok) {
      throw new Error(`playback target ${verdict.reason}`);
    }
    logger.debug({ status: res.status }, 'playback target verified');
  } finally {
    // Never read the body. A server that ignores Range answers 200 with the
    // whole file, and we only ever needed the headers.
    try {
      await res.body?.cancel();
    } catch {
      // already closed
    }
  }
}
