import React from 'react';
import type { Download } from './types';

/*
 * Downloads in a database of their own, so clearing or trimming the cache
 * never touches them. Progress stays in memory; only changes of state are
 * written.
 */

const NAME = 'aiostreams-web-downloads';
const STORE = 'jobs';

let downloads: Download[] = [];
/** Bytes a second of each running download. */
let speeds: Record<string, number> = {};
let folder: string | null = null;
const listeners = new Set<() => void>();

function announce() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(NAME, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

export const loaded: Promise<void> = open().then(
  (db) =>
    new Promise((resolve) => {
      if (!db) return resolve();
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => {
        downloads = (request.result as Download[]).sort(
          (a, b) => a.addedAt - b.addedAt
        );
        announce();
        resolve();
      };
      request.onerror = () => resolve();
    })
);

async function persist(write: (store: IDBObjectStore) => void) {
  const db = await open();
  if (!db) return;
  const tx = db.transaction(STORE, 'readwrite');
  write(tx.objectStore(STORE));
}

export function allDownloads(): Download[] {
  return downloads;
}

export function useDownloadList(): Download[] {
  return React.useSyncExternalStore(subscribe, allDownloads);
}

export function useDownloadSpeeds(): Record<string, number> {
  return React.useSyncExternalStore(subscribe, () => speeds);
}

export function useDownloadFolder(): string | null {
  return React.useSyncExternalStore(subscribe, () => folder);
}

export function addDownloads(added: Download[]): void {
  if (!added.length) return;
  downloads = [...downloads, ...added];
  announce();
  void persist((store) => added.forEach((d) => store.put(d)));
}

/** `save` false keeps it in memory, for progress. */
export function updateDownloads(
  changes: { id: string; patch: Partial<Download> }[],
  save = true
): void {
  if (!changes.length) return;
  const byId = new Map(changes.map((c) => [c.id, c.patch]));
  const changed: Download[] = [];
  downloads = downloads.map((d) => {
    const patch = byId.get(d.id);
    if (!patch) return d;
    const next = { ...d, ...patch };
    changed.push(next);
    return next;
  });
  announce();
  if (save) void persist((store) => changed.forEach((d) => store.put(d)));
}

export function deleteDownloads(ids: string[]): void {
  const gone = new Set(ids);
  downloads = downloads.filter((d) => !gone.has(d.id));
  announce();
  void persist((store) => ids.forEach((id) => store.delete(id)));
}

export function setProgress(
  id: string,
  bytes: number,
  total: number | undefined,
  speed: number
): void {
  speeds = { ...speeds, [id]: speed };
  updateDownloads(
    [{ id, patch: { bytes, ...(total ? { total } : {}) } }],
    false
  );
}

export function setFolder(next: string): void {
  if (next === folder) return;
  folder = next;
  announce();
}
