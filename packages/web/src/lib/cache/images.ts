import React from 'react';
import { imageAccept, noteRead, refused } from '../artwork';
import { isReachable } from '../connection';
import { settings, useSetting } from '../settings';
import { maybeSaved, noteSaved, schedulePrune } from '.';
import { readImage, writeImage } from './store';

const MAX_URLS = 400;

const urls = new Map<string, string>();
const lookups = new Map<string, Promise<string>>();
/** Images whose host refused to let the page read them, so they load plainly. */
const unreadable = new Set<string>();

function keep(src: string, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  urls.set(src, url);
  if (urls.size > MAX_URLS) {
    // An image already drawn keeps its picture after its URL is revoked.
    const [oldest, objectUrl] = urls.entries().next().value!;
    urls.delete(oldest);
    URL.revokeObjectURL(objectUrl);
  }
  return url;
}

/*
 * Fetched here, not by the `<img>`: the browser caches a fetch and an image
 * load apart, so saving after a load would download it twice.
 */
async function fetchAndSave(src: string): Promise<string> {
  if (unreadable.has(src) || refused(src)) return src;
  let res: Response;
  try {
    res = await fetch(src, { headers: { Accept: imageAccept() } });
  } catch {
    noteRead(src, false);
    if (isReachable()) unreadable.add(src);
    return src;
  }
  // The `<img>` gets the failure to show, and moves on to the next source.
  if (!res.ok) return src;
  noteRead(src, true);
  const blob = await res.blob();
  void blob
    .arrayBuffer()
    .then((bytes) => writeImage(src, blob.type, bytes))
    .then(() => {
      noteSaved(src);
      schedulePrune();
    })
    .catch(() => undefined);
  return keep(src, blob);
}

function lookUp(src: string): Promise<string> {
  let pending = lookups.get(src);
  if (!pending) {
    pending = (maybeSaved(src) ? readImage(src) : Promise.resolve(null))
      .then((saved) =>
        saved
          ? keep(src, new Blob([saved.bytes], { type: saved.type }))
          : fetchAndSave(src)
      )
      .catch(() => src)
      .finally(() => lookups.delete(src));
    lookups.set(src, pending);
  }
  return pending;
}

function useArtworkSaved(): boolean {
  const [enabled] = useSetting(settings.cache.enabled);
  const [artwork] = useSetting(settings.cache.categories.artwork);
  return enabled && artwork;
}

/**
 * What an `<img>` should load for `src`, or undefined while it is looked up.
 * Nothing is looked up until `wanted`.
 */
export function useSavedSrc(
  src: string | undefined,
  wanted: boolean
): string | undefined {
  const on = useArtworkSaved();
  const known = src && on ? urls.get(src) : undefined;
  const [found, setFound] = React.useState<{ src: string; url: string }>();
  React.useEffect(() => {
    if (!src || !on || known || !wanted) return;
    let live = true;
    void lookUp(src).then((url) => {
      if (live) setFound({ src, url });
    });
    return () => {
      live = false;
    };
  }, [src, on, known, wanted]);
  if (!src || !on) return src;
  return known ?? (found?.src === src ? found.url : undefined);
}
