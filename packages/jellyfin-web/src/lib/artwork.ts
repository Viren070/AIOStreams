/*
 * Artwork shrunk to its box's device pixels in a worker. Some engines draw an
 * image several times larger than its box without filtering, which breaks thin
 * lines into dots.
 */

export interface ShrinkJob {
  id: number;
  url: string;
  width: number;
  height: number;
  accept: string;
}

export interface ShrinkReply {
  id: number;
  bitmap?: ImageBitmap;
  error?: string;
  /** The fetch itself failed, as it does when the host refuses cross-origin reads. */
  blocked?: true;
  /** The worker cannot draw at all, so no later job will fare better. */
  unsupported?: true;
}

export type Shrunk = { bitmap: ImageBitmap } | { plain: true };

// What an `<img>` asks for. A fetch accepts anything, which image hosts answer
// with the original JPEG or PNG instead of a WebP or AVIF of half the size.
const ACCEPT = 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
/** The smallest AVIF there is; older WebKit can't decode AVIF, so it's tried first. */
const AVIF_PROBE =
  'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';
let accept = ACCEPT;
const probe = new Image();
probe.src = AVIF_PROBE;
probe.decode().then(
  () => (accept = `image/avif,${ACCEPT}`),
  () => undefined
);

export function imageAccept(): string {
  return accept;
}

export const canShrink =
  typeof Worker === 'function' &&
  typeof OffscreenCanvas === 'function' &&
  typeof createImageBitmap === 'function';

const IN_FLIGHT = 4;

interface Pending extends Omit<ShrinkJob, 'accept'> {
  resolve: (result: Shrunk) => void;
  cancelled: boolean;
}

let worker: Worker | null = null;
let broken = false;
let nextId = 0;
const queue: Pending[] = [];
const running = new Map<number, Pending>();

/*
 * A plain image cannot reuse a refused fetch's download, as the two are cached
 * apart, so a server whose images have never been readable stops being tried.
 */
const reads = new Map<string, { blocked: number; read: number }>();

function readsFor(url: string) {
  const origin = new URL(url, location.href).origin;
  let entry = reads.get(origin);
  if (!entry) reads.set(origin, (entry = { blocked: 0, read: 0 }));
  return entry;
}

function refused(url: string): boolean {
  const { blocked, read } = readsFor(url);
  return blocked >= 8 && read === 0;
}

function settle(job: Pending, reply: ShrinkReply) {
  if (reply.blocked) readsFor(job.url).blocked++;
  else if (reply.bitmap) readsFor(job.url).read++;
  if (job.cancelled) reply.bitmap?.close();
  else job.resolve(reply.bitmap ? { bitmap: reply.bitmap } : { plain: true });
}

function start(): Worker | null {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL('./artwork-worker.ts', import.meta.url));
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<ShrinkReply>) => {
    if (e.data.unsupported) broken = true;
    const job = running.get(e.data.id);
    if (!job) return;
    running.delete(e.data.id);
    settle(job, e.data);
    pump();
  };
  worker.onerror = () => {
    broken = true;
    worker?.terminate();
    worker = null;
    for (const job of [...running.values(), ...queue.splice(0)])
      settle(job, { id: job.id, error: 'worker failed' });
    running.clear();
  };
  return worker;
}

function pump() {
  while (running.size < IN_FLIGHT && queue.length) {
    const job = queue.shift()!;
    if (refused(job.url)) {
      job.resolve({ plain: true });
      continue;
    }
    const w = start();
    if (!w) {
      settle(job, { id: job.id, error: 'no worker' });
      continue;
    }
    running.set(job.id, job);
    const { id, url, width, height } = job;
    w.postMessage({ id, url, width, height, accept } satisfies ShrinkJob);
  }
}

/** A bitmap of exactly `width`x`height`, or `plain` when an `<img>` should draw it. */
export function shrinkArtwork(
  url: string,
  width: number,
  height: number
): { promise: Promise<Shrunk>; cancel: () => void } {
  let job!: Pending;
  const promise = new Promise<Shrunk>((resolve) => {
    job = { id: nextId++, url, width, height, resolve, cancelled: false };
  });
  if (broken || refused(url)) job.resolve({ plain: true });
  else {
    queue.push(job);
    pump();
  }
  return {
    promise,
    cancel: () => {
      job.cancelled = true;
      const at = queue.indexOf(job);
      if (at >= 0) queue.splice(at, 1);
    },
  };
}
