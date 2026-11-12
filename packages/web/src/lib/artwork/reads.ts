import { isReachable } from '@/lib/jellyfin/connection';
import { artworkOrigin } from './drawn';

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

/*
 * A plain image cannot reuse a refused fetch's download, as the two are cached
 * apart, so a server whose images have never been readable stops being tried.
 */
const reads = new Map<string, { blocked: number; read: number }>();

function readsFor(url: string) {
  const origin = artworkOrigin(url);
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
