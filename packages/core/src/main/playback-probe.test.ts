import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_PLAUSIBLE_FILE_SIZE,
  classifyProbedBody,
  verifyPlaybackUrl,
  type ProbeResponse,
} from './playback-probe.js';

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

function okResponse(): ProbeResponse {
  return {
    status: 206,
    headers: headers({
      'content-type': 'video/mp4',
      'content-range': `bytes 0-0/${20 * GiB}`,
    }),
  };
}

test('accepts a ranged response whose declared total is a plausible release', () => {
  const verdict = classifyProbedBody({
    status: 206,
    headers: headers({
      'content-type': 'video/mp4',
      'content-range': `bytes 0-0/${20 * GiB}`,
    }),
  });

  assert.deepEqual(verdict, { ok: true });
});

test('rejects a ranged response whose declared total is an error-video-sized file', () => {
  const verdict = classifyProbedBody({
    status: 206,
    headers: headers({
      'content-type': 'video/mp4',
      'content-range': 'bytes 0-0/1048576',
    }),
  });

  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.reason : '', /1048576/);
});

test('accepts a file that is only just above the floor', () => {
  const verdict = classifyProbedBody({
    status: 206,
    headers: headers({
      'content-type': 'video/mp4',
      'content-range': `bytes 0-0/${MIN_PLAUSIBLE_FILE_SIZE}`,
    }),
  });

  assert.deepEqual(verdict, { ok: true });
});

test('accepts a ranged response that states no total', () => {
  const verdict = classifyProbedBody({
    status: 206,
    headers: headers({ 'content-type': 'video/mp4' }),
  });

  assert.deepEqual(verdict, { ok: true });
});

test('rejects a response that is not video or octet-stream', () => {
  const verdict = classifyProbedBody({
    status: 200,
    headers: headers({
      'content-type': 'text/html',
      'content-length': String(20 * GiB),
    }),
  });

  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.reason : '', /text\/html/);
});

test('accepts octet-stream, which debrid CDNs use for direct downloads', () => {
  const verdict = classifyProbedBody({
    status: 200,
    headers: headers({
      'content-type': 'application/octet-stream',
      'content-length': String(20 * GiB),
    }),
  });

  assert.deepEqual(verdict, { ok: true });
});

test('rejects a response that ignored Range and declared a tiny body', () => {
  const verdict = classifyProbedBody({
    status: 200,
    headers: headers({
      'content-type': 'video/mp4',
      'content-length': String(2 * MiB),
    }),
  });

  assert.equal(verdict.ok, false);
});

test('rejects a response that ignored Range and declared no size at all', () => {
  const verdict = classifyProbedBody({
    status: 200,
    headers: headers({ 'content-type': 'video/mp4' }),
  });

  assert.equal(verdict.ok, false);
});

test('rejects a non-success status', () => {
  const verdict = classifyProbedBody({
    status: 404,
    headers: headers({ 'content-type': 'video/mp4' }),
  });

  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.reason : '', /404/);
});

test('verifyPlaybackUrl resolves for a healthy target and cancels the body', async () => {
  let cancelled = false;
  const response: ProbeResponse = {
    ...okResponse(),
    body: {
      cancel: async () => {
        cancelled = true;
      },
    },
  };

  await verifyPlaybackUrl('https://cdn.example.com/file.mkv', {
    request: async () => response,
  });

  assert.equal(cancelled, true);
});

test('verifyPlaybackUrl throws a retryable error for an error video', async () => {
  const response: ProbeResponse = {
    status: 206,
    headers: headers({
      'content-type': 'video/mp4',
      'content-range': 'bytes 0-0/524288',
    }),
  };

  await assert.rejects(
    () =>
      verifyPlaybackUrl('https://cdn.example.com/file.mkv', {
        request: async () => response,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      // No `code`, so isFailoverRetryableError() lets the chain advance.
      assert.equal((err as { code?: string }).code, undefined);
      return true;
    }
  );
});

test('verifyPlaybackUrl sends a single-byte range request for the given url', async () => {
  let seenUrl: string | undefined;
  let seenInit: Record<string, any> | undefined;

  await verifyPlaybackUrl('https://cdn.example.com/file.mkv', {
    clientIp: '1.2.3.4',
    request: async (url, init) => {
      seenUrl = url;
      seenInit = init as Record<string, any>;
      return okResponse();
    },
  });

  assert.equal(seenUrl, 'https://cdn.example.com/file.mkv');
  assert.equal(seenInit?.headers?.Range, 'bytes=0-0');
  assert.equal(seenInit?.forwardIp, '1.2.3.4');
});

test('verifyPlaybackUrl aborts the probe when the caller aborts', async () => {
  const caller = new AbortController();
  let probeSignal: AbortSignal | undefined;

  await verifyPlaybackUrl('https://cdn.example.com/file.mkv', {
    signal: caller.signal,
    request: async (_url, init) => {
      probeSignal = (init as { signal?: AbortSignal }).signal;
      return okResponse();
    },
  });

  assert.ok(probeSignal);
  assert.equal(probeSignal!.aborted, false);
  caller.abort();
  assert.equal(probeSignal!.aborted, true);
});

test('verifyPlaybackUrl bounds the probe with its own timeout even when the caller passes a signal', async () => {
  // makeRequest only applies `timeout` when no signal is given, so a probe that
  // forwards the caller's signal verbatim would inherit the whole chain deadline
  // instead of failing fast.
  const caller = new AbortController();
  let probeSignal: AbortSignal | undefined;

  await verifyPlaybackUrl('https://cdn.example.com/file.mkv', {
    signal: caller.signal,
    timeout: 10,
    request: async (_url, init) => {
      probeSignal = (init as { signal?: AbortSignal }).signal;
      return okResponse();
    },
  });

  assert.notEqual(probeSignal, caller.signal);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(probeSignal!.aborted, true);
});

test('verifyPlaybackUrl still bounds the probe when no caller signal is given', async () => {
  let probeSignal: AbortSignal | undefined;

  await verifyPlaybackUrl('https://cdn.example.com/file.mkv', {
    timeout: 10,
    request: async (_url, init) => {
      probeSignal = (init as { signal?: AbortSignal }).signal;
      return okResponse();
    },
  });

  assert.ok(probeSignal);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(probeSignal!.aborted, true);
});
