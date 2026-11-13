/*
 * Artwork shrunk to its box's device pixels in a worker. Some engines draw an
 * image several times larger than its box without filtering, which breaks thin
 * lines into dots.
 */

import { maybeSaved, noteSaved, saving, schedulePrune } from '@/lib/cache';
import { artworkKey, drawnArtwork, keepDrawn, type Drawn } from './drawn';
import type { ShrinkJob, ShrinkReply, WashJob } from './messages';
import { imageAccept, noteRead, refused } from './reads';

export type Shrunk =
  { src: string } | { bitmap: ImageBitmap } | { plain: true };

/** Drawn a little larger is close enough, as an `<img>` shrinks that cleanly. */
const fits = (entry: Drawn, width: number, height: number) =>
  entry.width >= width && entry.height >= height && entry.width <= width * 1.5;

export const canShrink =
  typeof Worker === 'function' &&
  typeof OffscreenCanvas === 'function' &&
  typeof createImageBitmap === 'function';

const IN_FLIGHT = 4;
/**
 * A job still running after this long, as a huge image or a slow host's is,
 * gives its place to the next, up to as many again.
 */
const SLOW_MS = 1500;
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
  /** The element the image is for, nearer the screen going first. */
  box: Element;
  distance: number;
  /** The scroll count it was measured at. */
  at: number;
  slowTimer?: ReturnType<typeof setTimeout>;
  released?: boolean;
}

interface Slot {
  worker: Worker;
  busy: number;
  /** Jobs that gave their place up. */
  slow: number;
}

const slots: Slot[] = [];
let broken = false;
let nextId = 0;
const queue: Pending[] = [];
const running = new Map<number, { job: Pending; slot: Slot }>();
/** Washes asked of the first worker, which keeps each title's. */
const washing = new Map<number, (made: Washed | null | undefined) => void>();
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

function settle(job: Pending, reply: ShrinkReply, maker?: Worker) {
  if (reply.blocked) noteRead(job.url, false);
  else if (reply.src || reply.bitmap) noteRead(job.url, true);
  if (reply.src && maker)
    keepDrawn(job.url, {
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
    worker = new Worker(new URL('./worker.ts', import.meta.url));
  } catch {
    broken = true;
    return null;
  }
  const slot = { worker, busy: 0, slow: 0 };
  worker.onmessage = (e: MessageEvent<ShrinkReply>) => {
    if (e.data.unsupported) broken = true;
    if (e.data.saved) {
      noteSaved(e.data.saved.url);
      schedulePrune(e.data.saved.bytes);
    }
    if (e.data.encoded) {
      const { url, ...entry } = e.data.encoded;
      keepDrawn(url, { ...entry, maker: worker });
    }
    const washed = washing.get(e.data.id);
    if (washed) {
      washing.delete(e.data.id);
      const { bitmap, tint, panel, unsupported } = e.data;
      washed(
        unsupported
          ? undefined
          : bitmap && tint && panel
            ? { bitmap, tint, panel }
            : null
      );
      return;
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
    clearTimeout(entry.job.slowTimer);
    if (entry.job.released) slot.slow--;
    else slot.busy--;
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
      // eslint-disable-next-line lingui/no-unlocalized-strings -- only logged
      settle(job, { id: job.id, error: 'worker failed' });
    running.clear();
    for (const { blob, resolve } of addressing.values())
      resolve(addressHere(blob));
    addressing.clear();
    for (const resolve of washing.values()) resolve(undefined);
    washing.clear();
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

let scrolls = 0;
document.addEventListener('scroll', () => scrolls++, {
  capture: true,
  passive: true,
});

function distance(box: Element, width: number, height: number): number {
  if (!box.isConnected || box.closest('[inert]')) return Infinity;
  const r = box.getBoundingClientRect();
  return (
    Math.max(0, r.left - width, -r.right) +
    Math.max(0, r.top - height, -r.bottom)
  );
}

/** Orders the queue nearest the screen first, measuring what moved since. */
function rank() {
  if (queue.length < 2) return;
  const width = innerWidth;
  const height = innerHeight;
  for (const job of queue) {
    if (job.at === scrolls) continue;
    job.at = scrolls;
    job.distance = distance(job.box, width, height);
  }
  queue.sort(
    (a, b) =>
      Number(a.ahead) - Number(b.ahead) ||
      a.distance - b.distance ||
      a.id - b.id
  );
}

let pumping = false;

/** Hands jobs out after the next frame, when the page's layout is clean to measure. */
function pump() {
  if (pumping || !queue.length) return;
  pumping = true;
  requestAnimationFrame(() =>
    setTimeout(() => {
      pumping = false;
      dispatch();
    })
  );
}

function dispatch() {
  rank();
  while (queue.length) {
    const job = queue[0];
    if (refused(job.url)) {
      queue.shift();
      job.resolve({ plain: true });
      continue;
    }
    const slot = freeSlot(job.ahead);
    if (!slot) {
      if (broken) {
        queue.shift();
        // eslint-disable-next-line lingui/no-unlocalized-strings -- only logged
        settle(job, { id: job.id, error: 'no worker' });
      } else return;
      continue;
    }
    queue.shift();
    slot.busy++;
    running.set(job.id, { job, slot });
    job.slowTimer = setTimeout(() => {
      if (!running.has(job.id) || slot.slow >= IN_FLIGHT) return;
      job.released = true;
      slot.busy--;
      slot.slow++;
      pump();
    }, SLOW_MS);
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
      accept: imageAccept(),
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
  box: Element,
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
      box,
      distance: 0,
      at: -1,
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

export interface Washed {
  bitmap: ImageBitmap;
  tint: string;
  panel: string;
}

/**
 * The artwork's wash, drawn out by a worker: undefined where none can draw,
 * null when the image couldn't be read.
 */
export function washArtwork(url: string): Promise<Washed | null | undefined> {
  const slot = broken ? undefined : slots[0];
  if (!slot) return Promise.resolve(undefined);
  if (refused(url)) return Promise.resolve(null);
  const id = nextId++;
  const save = saving('artwork');
  return new Promise((resolve) => {
    washing.set(id, resolve);
    slot.worker.postMessage({
      id,
      wash: true,
      url,
      save,
      look: save && maybeSaved(url),
      accept: imageAccept(),
    } satisfies WashJob);
  });
}
