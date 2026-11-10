import { createLive, useLive } from '@/lib/live-value';

/*
 * Whether the server answers. A request that cannot reach it marks it
 * unreachable; any answer, or a probe that keeps trying, marks it back.
 */

const PROBE_MS = [2_000, 5_000, 10_000, 15_000];

const reachable = createLive(true);
let probeUrl: string | null = null;
let probes = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
export const isReachable = (): boolean => reachable.get();

export const useReachable = (): boolean => useLive(reachable);

export function reached(): void {
  probes = 0;
  clearTimeout(timer);
  timer = undefined;
  reachable.set(true);
}

export function unreachable(): void {
  reachable.set(false);
  if (!timer) schedule();
}

function schedule() {
  const wait = PROBE_MS[Math.min(probes++, PROBE_MS.length - 1)];
  timer = setTimeout(() => void probe(), wait);
}

async function probe() {
  timer = undefined;
  if (!probeUrl || reachable.get()) return;
  try {
    const res = await fetch(probeUrl, { cache: 'no-store' });
    if (res.ok) return reached();
  } catch {}
  if (!reachable.get() && !timer) schedule();
}

/** The address a probe asks, for the server the app is signed in to. */
export function watchServer(base: string): () => void {
  probeUrl = `${base}/System/Info/Public`;
  return () => {
    if (probeUrl === `${base}/System/Info/Public`) probeUrl = null;
  };
}

/** Asks the server now, and starts the waits between tries over. */
export function retryNow(): void {
  probes = 0;
  clearTimeout(timer);
  timer = undefined;
  void probe();
}

window.addEventListener('offline', unreachable);
window.addEventListener('online', retryNow);

/** For TanStack's `onlineManager`, so changes made offline wait for the server. */
export function followReachable(setOnline: (online: boolean) => void) {
  setOnline(reachable.get());
  return reachable.subscribe(() => setOnline(reachable.get()));
}
