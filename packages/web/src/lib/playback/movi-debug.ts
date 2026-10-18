import { storage } from '../storage';

/**
 * Whether the movi engine says what it does in the console: in a dev build,
 * or once `localStorage['aiostreams-movi-debug'] = '1'` and the page reloads.
 */
export const moviDebugging =
  process.env.NODE_ENV !== 'production' ||
  !!storage.get<unknown>('aiostreams-movi-debug');

/** One `[movi]` line, filtered in the console by that prefix. */
export function moviDebug(event: string, data?: unknown): void {
  if (!moviDebugging) return;
  if (data === undefined) console.debug('[movi]', event);
  else console.debug('[movi]', event, data);
}
