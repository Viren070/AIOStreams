import { LocalWatchStateProvider } from './local-provider.js';
import type { WatchStateProvider } from './types.js';

export * from './types.js';
export * from './handoff/index.js';
export * from './sessions.js';
export { LocalWatchStateProvider } from './local-provider.js';

let provider: WatchStateProvider | null = null;

export function getWatchStateProvider(): WatchStateProvider {
  provider ??= new LocalWatchStateProvider();
  return provider;
}

/** Persists pending progress; called from the server shutdown sequence. */
export async function flushWatchState(): Promise<void> {
  if (provider) await provider.flush();
}
