import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Pool, type Dispatcher } from 'undici';
import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import type { RequestHeaders } from './headers.js';

const logger = createLogger('impersonation');

const START_TIMEOUT = 10_000;
const RETRY_AFTER = 60_000;

export class ImpersonationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ImpersonationError';
  }
}

export interface ImpersonatedRequest {
  preset: string;
  method: string;
  url: URL;
  headers: RequestHeaders;
  body?: Buffer;
  proxy?: string;
  /** The only addresses a new connection may use. */
  addresses?: string[];
  signal: AbortSignal;
}

/** The protocol is in AIOStreams/impersonate's internal/bridge. */
class ImpersonationHost {
  readonly #pool: Pool;

  constructor(
    readonly child: ChildProcess,
    address: string,
    readonly token: string
  ) {
    this.#pool = new Pool(`http://${address}`, { keepAliveTimeout: 60_000 });
  }

  async request(req: ImpersonatedRequest): Promise<Dispatcher.ResponseData> {
    const upstream = {
      profile: req.preset,
      method: req.method,
      url: req.url.href,
      headers: [...req.headers],
      proxy: req.proxy,
      addresses: req.addresses,
    };
    const res = await this.#pool.request({
      path: '/request',
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'x-impersonate': Buffer.from(JSON.stringify(upstream)).toString(
          'base64'
        ),
      },
      body: req.body,
      signal: req.signal,
    });
    if (res.statusCode !== 200) {
      const failure = (await res.body.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
      };
      throw new ImpersonationError(
        failure.code ?? 'ERR_IMPERSONATION',
        failure.message ?? `impersonation program answered ${res.statusCode}`
      );
    }
    return {
      statusCode: Number(res.headers['x-impersonate-status']),
      statusText: String(res.headers['x-impersonate-status-text'] ?? ''),
      headers: decodeHeaders(String(res.headers['x-impersonate-headers'])),
      body: res.body,
      trailers: {},
      opaque: null,
      context: {},
    };
  }
}

function decodeHeaders(encoded: string): Record<string, string | string[]> {
  const pairs = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as [
    string,
    string,
  ][];
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of pairs) {
    const key = name.toLowerCase();
    const previous = headers[key];
    headers[key] =
      previous === undefined
        ? value
        : [...(Array.isArray(previous) ? previous : [previous]), value];
  }
  return headers;
}

let current: Promise<ImpersonationHost | undefined> | undefined;
let unavailableUntil = 0;

/** Started on first use; undefined while it can't run. */
export function impersonationHost(): Promise<ImpersonationHost | undefined> {
  if (current) return current;
  if (Date.now() < unavailableUntil) return Promise.resolve(undefined);
  current = start().then((host) => {
    if (!host) {
      current = undefined;
      unavailableUntil = Date.now() + RETRY_AFTER;
    }
    return host;
  });
  return current;
}

function start(): Promise<ImpersonationHost | undefined> {
  const program = appConfig.http.impersonationPath;
  const token = randomBytes(32).toString('hex');
  return new Promise((resolve) => {
    let host: ImpersonationHost | undefined;
    let settled = false;
    const settle = (result?: ImpersonationHost) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(program, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      logger.warn({ program }, 'impersonation program did not start in time');
      child.kill();
      settle();
    }, START_TIMEOUT);
    child.once('error', (err) => {
      logger.warn(
        { program, err: err.message },
        'impersonation program unavailable; presets send their headers only'
      );
      settle();
    });
    child.once('exit', (code, signal) => {
      if (settled && host) {
        logger.warn({ code, signal }, 'impersonation program exited');
        current = undefined;
      }
      settle();
    });
    createInterface({ input: child.stdout! }).once('line', (line) => {
      const address = /^listening (127\.0\.0\.1:\d+)$/.exec(line)?.[1];
      if (!address) {
        logger.warn(
          { line },
          'impersonation program said something unexpected'
        );
        child.kill();
        return settle();
      }
      host = new ImpersonationHost(child, address, token);
      logger.info({ program, pid: child.pid }, 'impersonation program started');
      settle(host);
    });
    createInterface({ input: child.stderr! }).on('line', (line) =>
      logger.warn({ line }, 'impersonation program')
    );
    // Its stdin closing is how it knows we are gone.
    child.stdin!.write(`${token}\n`);
    child.unref();
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      (stream as unknown as { unref?: () => void } | null)?.unref?.();
    }
  });
}
