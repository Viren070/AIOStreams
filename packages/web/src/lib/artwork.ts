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
  /** What the small encoded copy for this box is saved as. */
  copy: string;
  lookCopy: boolean;
  accept: string;
}

export interface ShrinkReply {
  id: number;
  /** The image as it is, at a blob address the worker made. */
  src?: string;
  /** How large the image at `src` is. */
  bytes?: number;
  /** The image shrunk to the box. */
  bitmap?: ImageBitmap;
  /** Sent on its own once a shrunk image has a small encoded copy. */
  encoded?: { url: string; bytes: number } & Drawn;
  error?: string;
  /** The fetch itself failed, as it does when the host refuses cross-origin reads. */
  blocked?: true;
  /** The worker cannot draw at all, so no later job will fare better. */
  unsupported?: true;
  /** Sent on its own with the address once a fetched image is saved. */
  saved?: string;
}

export type Shrunk =
  | { src: string }
  | { bitmap: ImageBitmap }
  | { plain: true };

export interface Drawn {
  src: string;
  width: number;
  height: number;
}

/** An image's address without the size asked of it, naming it at any size. */
export function artworkKey(url: string): string {
  const parsed = new URL(url, location.href);
  parsed.searchParams.delete('maxWidth');
  return parsed.href;
}

interface Kept extends Drawn {
  bytes: number;
  /** The worker that made the address `src`, which revokes it. */
  maker: Worker;
}

/** Artwork by image, oldest first, so a card drawn again shows it at once. */
const drawn = new Map<string, Kept>();
let drawnBytes = 0;
/** Some hundreds of posters at the sizes servers send for a card. */
const DRAWN_BUDGET = 24_000_000;

export function drawnArtwork(url: string): Drawn | undefined {
  const key = artworkKey(url);
  const entry = drawn.get(key);
  if (entry) {
    drawn.delete(key);
    drawn.set(key, entry);
  }
  return entry;
}

// Addresses left out of the cache are revoked once no card shows them.
const shown = new Map<string, number>();
const dropped = new Map<string, Worker>();

/** Marks the address as shown until the returned function is called. */
export function holdArtwork(src: string): () => void {
  shown.set(src, (shown.get(src) ?? 0) + 1);
  return () => {
    const left = (shown.get(src) ?? 1) - 1;
    if (left > 0) return void shown.set(src, left);
    shown.delete(src);
    const maker = dropped.get(src);
    if (!maker) return;
    dropped.delete(src);
    maker.postMessage({ revoke: src });
  };
}

function drop(entry: Kept) {
  if (shown.has(entry.src)) dropped.set(entry.src, entry.maker);
  else entry.maker.postMessage({ revoke: entry.src });
}

const waiting = new Map<string, Set<(src: string) => void>>();

/** Calls `onCopy` with the image's encoded copy once one exists. */
export function onDrawn(
  url: string,
  onCopy: (src: string) => void
): () => void {
  const key = artworkKey(url);
  let set = waiting.get(key);
  if (!set) waiting.set(key, (set = new Set()));
  set.add(onCopy);
  return () => {
    set.delete(onCopy);
    if (!set.size) waiting.delete(key);
  };
}

function keep(url: string, entry: Kept) {
  const key = artworkKey(url);
  const was = drawn.get(key);
  if (was) {
    drawnBytes -= was.bytes;
    if (was.src !== entry.src) drop(was);
  }
  drawn.delete(key);
  drawn.set(key, entry);
  drawnBytes += entry.bytes;
  for (const [oldest, old] of drawn) {
    if (drawnBytes <= DRAWN_BUDGET) break;
    drawn.delete(oldest);
    drawnBytes -= old.bytes;
    drop(old);
  }
  for (const onCopy of waiting.get(key) ?? []) onCopy(entry.src);
}

/** Drawn a little larger is close enough, as an `<img>` shrinks that cleanly. */
const fits = (entry: Drawn, width: number, height: number) =>
  entry.width >= width && entry.height >= height && entry.width <= width * 1.5;

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

interface Pending extends Omit<
  ShrinkJob,
  'save' | 'look' | 'copy' | 'lookCopy' | 'accept'
> {
  resolve: (result: Shrunk) => void;
  cancelled: boolean;
  /** Only coming up, as a row's next cards are, so it waits for a free worker. */
  ahead: boolean;
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
/** Blobs a worker is making an address for, kept to make one here if it fails. */
const addressing = new Map<
  number,
  { blob: Blob; resolve: (address: BlobAddress) => void }
>();

export interface BlobAddress {
  src: string;
  revoke: () => void;
}

function addressHere(blob: Blob): BlobAddress {
  const src = URL.createObjectURL(blob);
  return { src, revoke: () => URL.revokeObjectURL(src) };
}

/** An address for `blob`, made by a worker: making one waits on the browser, which is slow while the app starts. */
export function blobAddress(blob: Blob): Promise<BlobAddress> {
  const slot = broken
    ? null
    : slots.reduce<Slot | null>(
        (best, s) => (!best || s.busy < best.busy ? s : best),
        null
      );
  if (!slot) return Promise.resolve(addressHere(blob));
  const id = nextId++;
  return new Promise((resolve) => {
    addressing.set(id, { blob, resolve });
    slot.worker.postMessage({ id, blob });
  });
}

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

function settle(job: Pending, reply: ShrinkReply, maker?: Worker) {
  if (reply.blocked) noteRead(job.url, false);
  else if (reply.src || reply.bitmap) noteRead(job.url, true);
  if (reply.src && maker)
    keep(job.url, {
      src: reply.src,
      width: job.width,
      height: job.height,
      bytes: reply.bytes ?? 0,
      maker,
    });
  if (job.cancelled) reply.bitmap?.close();
  else
    job.resolve(
      reply.src
        ? { src: reply.src }
        : reply.bitmap
          ? { bitmap: reply.bitmap }
          : { plain: true }
    );
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
    if (e.data.encoded) {
      const { url, ...entry } = e.data.encoded;
      keep(url, { ...entry, maker: worker });
    }
    const asked = addressing.get(e.data.id);
    if (asked) {
      addressing.delete(e.data.id);
      const src = e.data.src;
      asked.resolve(
        src
          ? { src, revoke: () => worker.postMessage({ revoke: src }) }
          : addressHere(asked.blob)
      );
      return;
    }
    const entry = running.get(e.data.id);
    if (!entry) return;
    running.delete(e.data.id);
    slot.busy--;
    settle(entry.job, e.data, worker);
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
    for (const { blob, resolve } of addressing.values())
      resolve(addressHere(blob));
    addressing.clear();
  };
  slots.push(slot);
  return slot;
}

// Started with the page, so the first artwork doesn't wait on the workers loading.
if (canShrink) for (let i = 0; i < WORKERS; i++) start();

/** Starts another worker only while every one is busy. */
function freeSlot(ahead: boolean): Slot | null {
  if (broken) return null;
  const least = slots.reduce<Slot | null>(
    (best, s) => (!best || s.busy < best.busy ? s : best),
    null
  );
  if ((!least || least.busy > 0) && slots.length < WORKERS) return start();
  if (!least) return null;
  return least.busy < (ahead ? 1 : IN_FLIGHT) ? least : null;
}

function pump() {
  while (queue.length) {
    const sooner = queue.findIndex((j) => !j.ahead);
    const at = sooner >= 0 ? sooner : 0;
    const job = queue[at];
    if (refused(job.url)) {
      queue.splice(at, 1);
      job.resolve({ plain: true });
      continue;
    }
    const slot = freeSlot(job.ahead);
    if (!slot) {
      if (broken) {
        queue.splice(at, 1);
        settle(job, { id: job.id, error: 'no worker' });
      } else return;
      continue;
    }
    queue.splice(at, 1);
    slot.busy++;
    running.set(job.id, { job, slot });
    const { id, url, width, height } = job;
    const save = saving('artwork');
    const copy = `${artworkKey(url)}#${width}x${height}`;
    slot.worker.postMessage({
      id,
      url,
      width,
      height,
      save,
      look: save && maybeSaved(url),
      copy,
      lookCopy: save && maybeSaved(copy),
      accept,
    } satisfies ShrinkJob);
  }
}

/**
 * The image for a `width`x`height` box: as it is when near that size, else
 * shrunk to it, or `plain` when an `<img>` should fetch the original itself.
 */
export function shrinkArtwork(
  url: string,
  width: number,
  height: number,
  ahead = false
): { promise: Promise<Shrunk>; cancel: () => void } {
  let job!: Pending;
  const promise = new Promise<Shrunk>((resolve) => {
    job = {
      id: nextId++,
      url,
      width,
      height,
      resolve,
      cancelled: false,
      ahead,
    };
  });
  const kept = drawnArtwork(url);
  if (kept && fits(kept, width, height)) job.resolve({ src: kept.src });
  else if (broken || refused(url)) job.resolve({ plain: true });
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
