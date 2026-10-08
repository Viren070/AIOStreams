/*
 * Sizes and eviction read only `entries`, so a scan never loads `bodies`.
 * Imports nothing, as the artwork worker uses it too.
 */

export const CACHE_CATEGORIES = [
  'home',
  'titles',
  'history',
  'search',
  'artwork',
  'account',
] as const;
export type CacheCategory = (typeof CACHE_CATEGORIES)[number];

interface Entry {
  id: string;
  category: CacheCategory;
  /** `<server>|<user>`, or `<server>|` for what a server's users share. */
  scope: string;
  size: number;
  usedAt: number;
}

export interface SavedQuery {
  savedAt: number;
  data: unknown;
}

export interface SavedImage {
  type: string;
  blob: Blob;
}

type Body =
  | { id: string; savedAt: number; json: string }
  | { id: string; type: string; blob: Blob };

const NAME = 'aiostreams-web-cache';
const ENTRIES = 'entries';
const BODIES = 'bodies';
/** Reads only move an entry up the eviction order this often. */
const TOUCH_MS = 6 * 60 * 60_000;
const PRUNE_TO = 0.9;

let opening: Promise<IDBDatabase | null> | null = null;

/** Null where the engine refuses storage, as private windows can. */
function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const entries = db.createObjectStore(ENTRIES, { keyPath: 'id' });
        entries.createIndex('category', 'category');
        entries.createIndex('scope', 'scope');
        db.createObjectStore(BODIES, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

const touched = new Set<string>();
let touchTimer: ReturnType<typeof setTimeout> | undefined;

function touch(entry: Entry | undefined) {
  if (!entry || Date.now() - entry.usedAt < TOUCH_MS) return;
  touched.add(entry.id);
  touchTimer ??= setTimeout(async () => {
    touchTimer = undefined;
    const ids = [...touched];
    touched.clear();
    const db = await open();
    if (!db) return;
    const tx = db.transaction(ENTRIES, 'readwrite', { durability: 'relaxed' });
    const store = tx.objectStore(ENTRIES);
    const now = Date.now();
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        const found = request.result as Entry | undefined;
        if (found) store.put({ ...found, usedAt: now });
      };
    }
    await committed(tx).catch(() => undefined);
  }, 2_000);
}

async function read(id: string): Promise<Body | null> {
  const db = await open();
  if (!db) return null;
  const tx = db.transaction([ENTRIES, BODIES]);
  const [entry, body] = await Promise.all([
    settled(tx.objectStore(ENTRIES).get(id) as IDBRequest<Entry | undefined>),
    settled(tx.objectStore(BODIES).get(id) as IDBRequest<Body | undefined>),
  ]);
  if (!entry || !body) return null;
  touch(entry);
  return body;
}

interface Pending {
  entry: Entry;
  body: Body;
  done: (error?: unknown) => void;
}

let batch: Pending[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/** One transaction per batch, as reads wait behind every write transaction. */
async function flush() {
  flushTimer = undefined;
  const writes = batch;
  batch = [];
  const db = await open();
  if (!db) return writes.forEach((w) => w.done());
  const tx = db.transaction([ENTRIES, BODIES], 'readwrite', {
    durability: 'relaxed',
  });
  for (const { entry, body } of writes) {
    tx.objectStore(ENTRIES).put(entry);
    tx.objectStore(BODIES).put(body);
  }
  await committed(tx).then(
    () => writes.forEach((w) => w.done()),
    (error) => writes.forEach((w) => w.done(error ?? new Error('abort')))
  );
}

function write(entry: Omit<Entry, 'usedAt'>, body: Body): Promise<void> {
  return new Promise((resolve, reject) => {
    batch.push({
      entry: { ...entry, usedAt: Date.now() },
      body,
      done: (error) => (error ? reject(error) : resolve()),
    });
    flushTimer ??= setTimeout(() => void flush(), 250);
  });
}

export async function readQuery(id: string): Promise<SavedQuery | null> {
  const body = await read(id);
  if (!body || !('json' in body)) return null;
  return { savedAt: body.savedAt, data: JSON.parse(body.json) };
}

export function writeQuery(
  entry: { id: string; category: CacheCategory; scope: string },
  savedAt: number,
  data: unknown
): Promise<void> {
  const json = JSON.stringify(data);
  // UTF-16, as the engine keeps it.
  return write(
    { ...entry, size: json.length * 2 },
    { id: entry.id, savedAt, json }
  );
}

/** Every saved image's address, so a miss never waits on a read. */
export async function savedImageUrls(): Promise<Set<string>> {
  const db = await open();
  if (!db) return new Set();
  const keys = await settled(
    db
      .transaction(ENTRIES)
      .objectStore(ENTRIES)
      .index('category')
      .getAllKeys('artwork')
  );
  return new Set(keys as string[]);
}

/** Kept as Blobs, so a page URL for one needn't copy its bytes. */
export async function readImage(url: string): Promise<SavedImage | null> {
  const body = await read(url);
  if (!body || !('blob' in body)) return null;
  return { type: body.type, blob: body.blob };
}

export function writeImage(
  url: string,
  type: string,
  data: Blob | ArrayBuffer
): Promise<void> {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  return write(
    { id: url, category: 'artwork', scope: '', size: blob.size },
    { id: url, type, blob }
  );
}

/** Queued writes would otherwise land after a removal and bring things back. */
function dropQueued(match: (entry: Entry) => boolean) {
  batch = batch.filter((w) => {
    if (!match(w.entry)) return true;
    w.done();
    return false;
  });
}

async function remove(
  pick: (store: IDBObjectStore) => IDBRequest<IDBValidKey[]>
): Promise<void> {
  const db = await open();
  if (!db) return;
  const tx = db.transaction([ENTRIES, BODIES], 'readwrite');
  const ids = await settled(pick(tx.objectStore(ENTRIES)));
  for (const id of ids) {
    tx.objectStore(ENTRIES).delete(id);
    tx.objectStore(BODIES).delete(id);
  }
  await committed(tx);
}

export function removeCategory(category: CacheCategory): Promise<void> {
  dropQueued((entry) => entry.category === category);
  return remove((store) => store.index('category').getAllKeys(category));
}

export function removeScope(scope: string): Promise<void> {
  dropQueued((entry) => entry.scope === scope);
  return remove((store) => store.index('scope').getAllKeys(scope));
}

export async function removeAll(): Promise<void> {
  dropQueued(() => true);
  const db = await open();
  if (!db) return;
  const tx = db.transaction([ENTRIES, BODIES], 'readwrite');
  tx.objectStore(ENTRIES).clear();
  tx.objectStore(BODIES).clear();
  await committed(tx);
}

async function allEntries(): Promise<Entry[]> {
  const db = await open();
  if (!db) return [];
  return settled(
    db.transaction(ENTRIES).objectStore(ENTRIES).getAll() as IDBRequest<Entry[]>
  );
}

export async function usage(): Promise<Record<CacheCategory, number>> {
  const sizes = Object.fromEntries(
    CACHE_CATEGORIES.map((c) => [c, 0])
  ) as Record<CacheCategory, number>;
  for (const entry of await allEntries()) sizes[entry.category] += entry.size;
  return sizes;
}

export async function prune(maxBytes: number): Promise<void> {
  const entries = await allEntries();
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  if (total <= maxBytes) return;
  entries.sort((a, b) => a.usedAt - b.usedAt);
  const ids: string[] = [];
  for (const entry of entries) {
    if (total <= maxBytes * PRUNE_TO) break;
    total -= entry.size;
    ids.push(entry.id);
  }
  const db = await open();
  if (!db) return;
  const tx = db.transaction([ENTRIES, BODIES], 'readwrite');
  for (const id of ids) {
    tx.objectStore(ENTRIES).delete(id);
    tx.objectStore(BODIES).delete(id);
  }
  await committed(tx);
}
