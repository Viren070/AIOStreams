export interface Drawn {
  src: string;
  width: number;
  height: number;
}

const addresses = new Map<string, { key: string; origin: string }>();
/** Past this many, the parsed addresses start over. */
const ADDRESSES_KEPT = 4000;

/** Parsed once, as every card asks again each time it draws. */
function address(url: string) {
  let found = addresses.get(url);
  if (!found) {
    const parsed = new URL(url, location.href);
    parsed.searchParams.delete('maxWidth');
    found = { key: parsed.href, origin: parsed.origin };
    if (addresses.size >= ADDRESSES_KEPT) addresses.clear();
    addresses.set(url, found);
  }
  return found;
}

/** An image's address without the size asked of it, naming it at any size. */
export const artworkKey = (url: string): string => address(url).key;

export const artworkOrigin = (url: string): string => address(url).origin;

interface Kept extends Drawn {
  bytes: number;
  /** The worker that made the address `src`, which revokes it. */
  maker: Worker;
}

/** Artwork by address, oldest first, so a card drawn again shows it at once. */
const drawn = new Map<string, Kept & { key: string }>();
/** Each image's newest address. */
const newest = new Map<string, string>();
let drawnBytes = 0;
/** Some hundreds of posters at the sizes servers send for a card. */
const DRAWN_BUDGET = 24_000_000;

export function drawnArtwork(url: string): Drawn | undefined {
  const src = newest.get(artworkKey(url));
  const entry = src ? drawn.get(src) : undefined;
  if (entry) {
    drawn.delete(entry.src);
    drawn.set(entry.src, entry);
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

export function keepDrawn(url: string, entry: Kept) {
  const key = artworkKey(url);
  // An older copy ages out with the rest, as a card may be decoding it before
  // it holds it.
  newest.set(key, entry.src);
  drawn.set(entry.src, { ...entry, key });
  drawnBytes += entry.bytes;
  for (const [oldest, old] of drawn) {
    if (drawnBytes <= DRAWN_BUDGET) break;
    drawn.delete(oldest);
    drawnBytes -= old.bytes;
    if (newest.get(old.key) === oldest) newest.delete(old.key);
    drop(old);
  }
  for (const onCopy of waiting.get(key) ?? []) onCopy(entry.src);
}
