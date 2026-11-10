/** Packaged from `packages/smart-tv/webos-service`. */
const SERVICE = 'luna://io.github.viren070.aiostreams.service/fetch';

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
