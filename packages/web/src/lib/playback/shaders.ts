import { t } from '@lingui/core/macro';

/** Pass files for the WebGPU engine that the user added in this browser. */
export interface Shader {
  name: string;
  text: string;
}

const NAME = 'aiostreams-web-shaders';
const STORE = 'shaders';

let opening: Promise<IDBDatabase | null> | null = null;
const listeners = new Set<() => void>();

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(NAME, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE, { keyPath: 'name' });
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

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** In name order, the order they apply in. */
export async function readShaders(): Promise<Shader[]> {
  const db = await open();
  if (!db) return [];
  const request = db.transaction(STORE).objectStore(STORE).getAll();
  const all = await new Promise<Shader[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as Shader[]);
    request.onerror = () => reject(request.error);
  });
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export const shaderNames = () =>
  readShaders().then((all) => all.map((s) => s.name));

async function change(
  edit: (store: IDBObjectStore) => void
): Promise<string[]> {
  const db = await open();
  if (!db) throw new Error(t`This browser keeps no files for this site.`);
  const tx = db.transaction(STORE, 'readwrite');
  edit(tx.objectStore(STORE));
  await committed(tx);
  listeners.forEach((listener) => listener());
  return shaderNames();
}

export function addShader(name: string, text: string): Promise<string[]> {
  if (/^\s*\/\/!HOOK\s/m.test(text))
    return Promise.reject(
      new Error(
        t`This is a GLSL shader. Convert it to a .wgsl pass file first.`
      )
    );
  if (!/^\s*\/\/!\s*shape\s*:/m.test(text))
    return Promise.reject(new Error(t`This isn't a .wgsl pass file.`));
  return change((store) => store.put({ name, text } satisfies Shader));
}

export const removeShader = (name: string): Promise<string[]> =>
  change((store) => store.delete(name));

export function onShadersChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
