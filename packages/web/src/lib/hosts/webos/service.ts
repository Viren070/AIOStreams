import { appLog } from '../shell/bridge';

/** Packaged from `packages/smart-tv/webos-service`. */
const SERVICE = 'luna://io.github.viren070.aiostreams.service/fetch';
const SERVE = 'luna://io.github.viren070.aiostreams.service/serve';
const HOLD = 'luna://io.github.viren070.aiostreams.service/hold';

interface PalmServiceBridge {
  onservicecallback: ((message: string) => void) | null;
  call(uri: string, parameters: string): void;
  cancel(): void;
}

declare global {
  interface Window {
    PalmServiceBridge?: new () => PalmServiceBridge;
  }
}

interface Answer {
  /** The service numbers its answers; the bus's own have none. */
  n?: number;
  returnValue: boolean;
  errorText?: string;
  /** The service ran but the host failed, rather than the service missing. */
  fetchFailed?: boolean;
  status?: number;
  url?: string;
  redirected?: boolean;
  retryAfter?: string | null;
  contentRange?: string | null;
  data?: string;
  done?: boolean;
}

const NULL_BODY = [204, 205, 304];

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// Without the service, reads use the page's own fetch.
let missing = false;
// Without the service, what the page made plays from its own memory instead.
let unserved = false;
// The service is held once, for the addresses it serves outlive the ask
// that made them, and an idle service is killed with its loopback.
let holding = false;

/** Keeps the TV's service up for the app's session, by holding one open. */
function hold(): void {
  if (holding) return;
  holding = true;
  const Bridge = window.PalmServiceBridge;
  if (!Bridge) return;
  const bridge = new Bridge();
  bridge.onservicecallback = (message) => {
    bridge.onservicecallback = null;
    let answer: Answer;
    try {
      answer = JSON.parse(message) as Answer;
    } catch {
      return;
    }
    if (!answer.returnValue) {
      bridge.cancel();
      appLog(
        'warn',
        `service: would not hold: ${answer.errorText ?? 'silent'}`
      );
      return;
    }
    appLog('info', 'service: held for the app');
  };
  bridge.call(HOLD, JSON.stringify({ subscribe: true }));
}

/** Sends headers a page can't. The body streams in as the service reads it. */
export function serviceFetch(
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string }
): Promise<Response> {
  const Bridge = window.PalmServiceBridge;
  if (missing || !Bridge) return fetch(url, init);
  return new Promise((resolve, reject) => {
    const bridge = new Bridge();
    let body: ReadableStreamDefaultController<Uint8Array> | null = null;
    let started = false;
    let last = -1;
    const end = () => {
      bridge.onservicecallback = null;
      bridge.cancel();
    };
    bridge.onservicecallback = (message) => {
      let answer: Answer;
      try {
        answer = JSON.parse(message) as Answer;
      } catch {
        answer = { returnValue: false, fetchFailed: true };
      }
      if (answer.n !== undefined) {
        if (answer.n <= last) return;
        last = answer.n;
      }
      if (!answer.returnValue) {
        end();
        const error = new TypeError(
          // eslint-disable-next-line lingui/no-unlocalized-strings -- only logged
          answer.errorText ?? 'The TV service failed'
        );
        if (started) return body?.error(error);
        if (answer.fetchFailed) return reject(error);
        missing = true;
        return fetch(url, init).then(resolve, reject);
      }
      if (!started) {
        started = true;
        const status = answer.status ?? 0;
        if (status < 200 || status > 599) {
          end();
          // eslint-disable-next-line lingui/no-unlocalized-strings -- only logged
          return reject(new TypeError(`The host answered ${status}`));
        }
        const stream = new ReadableStream<Uint8Array>({
          start: (controller) => {
            body = controller;
          },
          cancel: end,
        });
        const headers: Record<string, string> = {};
        if (answer.retryAfter) headers['retry-after'] = answer.retryAfter;
        if (answer.contentRange) headers['content-range'] = answer.contentRange;
        const response = new Response(
          NULL_BODY.includes(status) ? null : stream,
          { status, headers }
        );
        Object.defineProperties(response, {
          url: { value: answer.url ?? url },
          redirected: { value: !!answer.redirected },
        });
        return resolve(response);
      }
      if (answer.data) body?.enqueue(bytesOf(answer.data));
      if (answer.done) {
        end();
        body?.close();
      }
    };
    bridge.call(SERVICE, JSON.stringify({ url, ...init, subscribe: true }));
  });
}

/**
 * Holds `text` in the TV's service, and answers the address a player reads
 * it from — or null when there is no service to hold it, so the caller
 * serves the text from the page's own memory instead.
 */
export function serveText(text: string, type: string): Promise<string | null> {
  const Bridge = window.PalmServiceBridge;
  if (unserved || !Bridge) return Promise.resolve(null);
  // What serving hands out has to outlive the ask, so the service stays held.
  hold();
  return new Promise((resolve) => {
    const bridge = new Bridge();
    bridge.onservicecallback = (message) => {
      bridge.onservicecallback = null;
      bridge.cancel();
      let answer: Answer;
      try {
        answer = JSON.parse(message) as Answer;
      } catch {
        return resolve(null);
      }
      // A service without a `serve`, or none at all, will never have one.
      if (!answer.returnValue) {
        unserved = true;
        return resolve(null);
      }
      resolve(answer.url ?? null);
    };
    bridge.call(SERVE, JSON.stringify({ text, type }));
  });
}
