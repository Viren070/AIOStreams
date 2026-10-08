/*
 * Artwork shrunk to its box's device pixels in a worker. Some engines draw an
 * image several times larger than its box without filtering, which breaks thin
 * lines into dots.
 */

import { maybeSaved, noteSaved, saving, schedulePrune } from './cache';
import { isReachable } from './connection';

export interface ShrinkJob {
  id: number;
  url: string;
  width: number;
  height: number;
  save: boolean;
  /** Reads the device's saved copy first. */
  look: boolean;
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
  /** Sent on its own with the address once a fetched image is saved. */
  saved?: string;
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
/** One core is left to the page. */
const WORKERS = Math.max(
  1,
  Math.min(3, (navigator.hardwareConcurrency || 2) - 1)
);

interface Pending extends Omit<ShrinkJob, 'save' | 'look' | 'accept'> {
  resolve: (result: Shrunk) => void;
  cancelled: boolean;
}

interface Slot {
  worker: Worker;
  busy: number;
}

const slots: Slot[] = [];
let broken = false;
let nextId = 0;
const queue: Pending[] = [];
const running = new Map<number, { job: Pending; slot: Slot }>();

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

export function refused(url: string): boolean {
  const { blocked, read } = readsFor(url);
  return blocked >= 8 && read === 0;
}

/** Offline, a failed fetch says nothing about the host. */
export function noteRead(url: string, readable: boolean): void {
  if (readable) readsFor(url).read++;
  else if (isReachable()) readsFor(url).blocked++;
}

function settle(job: Pending, reply: ShrinkReply) {
  if (reply.blocked) noteRead(job.url, false);
  else if (reply.bitmap) noteRead(job.url, true);
  if (job.cancelled) reply.bitmap?.close();
  else job.resolve(reply.bitmap ? { bitmap: reply.bitmap } : { plain: true });
}

function start(): Slot | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./artwork-worker.ts', import.meta.url));
  } catch {
    broken = true;
    return null;
  }
  const slot = { worker, busy: 0 };
  worker.onmessage = (e: MessageEvent<ShrinkReply>) => {
    if (e.data.unsupported) broken = true;
    if (e.data.saved) {
      noteSaved(e.data.saved);
      schedulePrune();
    }
    const entry = running.get(e.data.id);
    if (!entry) return;
    running.delete(e.data.id);
    slot.busy--;
    settle(entry.job, e.data);
    pump();
  };
  worker.onerror = () => {
    broken = true;
    for (const s of slots.splice(0)) s.worker.terminate();
    for (const job of [
      ...[...running.values()].map((r) => r.job),
      ...queue.splice(0),
    ])
      settle(job, { id: job.id, error: 'worker failed' });
    running.clear();
  };
  slots.push(slot);
  return slot;
}

/** Starts another worker only while every one is busy. */
function freeSlot(): Slot | null {
  if (broken) return null;
  const least = slots.reduce<Slot | null>(
    (best, s) => (!best || s.busy < best.busy ? s : best),
    null
  );
  if ((!least || least.busy > 0) && slots.length < WORKERS) return start();
  return least && least.busy < IN_FLIGHT ? least : null;
}

function pump() {
  while (queue.length) {
    const job = queue[0];
    if (refused(job.url)) {
      queue.shift();
      job.resolve({ plain: true });
      continue;
    }
    const slot = freeSlot();
    if (!slot) {
      if (broken) settle(queue.shift()!, { id: job.id, error: 'no worker' });
      else return;
      continue;
    }
    queue.shift();
    slot.busy++;
    running.set(job.id, { job, slot });
    const { id, url, width, height } = job;
    slot.worker.postMessage({
      id,
      url,
      width,
      height,
      save: saving('artwork'),
      look: saving('artwork') && maybeSaved(url),
      accept,
    } satisfies ShrinkJob);
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
