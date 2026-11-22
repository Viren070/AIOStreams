import type { HeadersInit } from 'undici';
import { resolveHeaderOverride, type FetchContext } from './overrides.js';

export interface HeaderReader {
  get(name: string): string | null;
}

/** Sends headers in the order and case they were set. */
export class RequestHeaders implements HeaderReader {
  readonly #entries = new Map<string, [name: string, value: string]>();

  constructor(init?: HeadersInit | Iterable<[string, string]>) {
    if (!init) return;
    const pairs: Iterable<[string, string | readonly string[] | undefined]> =
      Symbol.iterator in init
        ? (init as Iterable<[string, string]>)
        : Object.entries(init);
    for (const [name, value] of pairs) {
      if (value === undefined) continue;
      this.set(name, typeof value === 'string' ? value : value.join(', '));
    }
  }

  get(name: string): string | null {
    return this.#entries.get(name.toLowerCase())?.[1] ?? null;
  }

  has(name: string): boolean {
    return this.#entries.has(name.toLowerCase());
  }

  set(name: string, value: string): void {
    this.#entries.set(name.toLowerCase(), [
      name,
      value.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, ''),
    ]);
  }

  delete(name: string): void {
    this.#entries.delete(name.toLowerCase());
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.#entries.values();
  }

  toObject(): Record<string, string> {
    return Object.fromEntries(this.#entries.values());
  }
}

/** Caller headers a preset replaces, whether or not it sets them. */
const PRESET_OWNED_HEADERS = [
  'user-agent',
  'accept',
  'accept-encoding',
  'accept-language',
];
const NO_USER_AGENT = ['none', 'false', '', 'undefined'];

/** A preset's Host line stays, marking where its client writes it. */
export function headersFor(
  base: RequestHeaders,
  url: URL,
  context?: FetchContext
): { headers: RequestHeaders; preset?: string } {
  const override = resolveHeaderOverride(url, context);
  let headers: RequestHeaders;
  if (override?.preset) {
    headers = new RequestHeaders(override.headers);
    for (const [name, value] of base) {
      const owned = PRESET_OWNED_HEADERS.includes(name.toLowerCase());
      if (!owned && !headers.has(name)) headers.set(name, value);
    }
  } else {
    headers = new RequestHeaders(base);
    for (const [name, value] of Object.entries(override?.headers ?? {})) {
      headers.set(name, value);
    }
    const encoding = headers.has('range')
      ? 'identity'
      : url.protocol === 'https:'
        ? 'br, gzip, deflate'
        : 'gzip, deflate';
    const defaults: [string, string][] = [
      ['accept', '*/*'],
      ['user-agent', 'undici'],
      ['accept-encoding', encoding],
    ];
    for (const [name, value] of defaults) {
      if (!headers.has(name)) headers.set(name, value);
    }
  }
  if (
    NO_USER_AGENT.includes(
      (headers.get('user-agent') ?? '').toLowerCase().trim()
    )
  ) {
    headers.delete('user-agent');
  }
  if (!override?.preset) headers.delete('host');
  return { headers, preset: override?.preset };
}
