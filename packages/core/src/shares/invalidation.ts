import { EventEmitter } from 'node:events';

/**
 * "The tree changed here": the one signal a provider raises so whatever is
 * caching listings downstream (a FUSE mount's kernel, an rclone mount's VFS)
 * can drop them. Providers only know what changed, which keeps core from
 * importing the mounts.
 */
export type ShareInvalidation =
  | { type: 'dirs'; dirs: string[] }
  | { type: 'entry'; dir: string; name: string };

type Listener = (event: ShareInvalidation) => void;

const bus = new EventEmitter();
bus.setMaxListeners(20);

/** These directories' listings (or attributes) changed. */
export function invalidateShareDirs(...dirs: string[]): void {
  if (dirs.length > 0) bus.emit('invalidate', { type: 'dirs', dirs });
}

/** One name under `dir` appeared or went away. */
export function invalidateShareEntry(dir: string, name: string): void {
  bus.emit('invalidate', { type: 'entry', dir, name });
}

export function onShareInvalidation(listener: Listener): () => void {
  bus.on('invalidate', listener);
  return () => {
    bus.off('invalidate', listener);
  };
}
