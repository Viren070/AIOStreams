import React from 'react';
import {
  blobAddress,
  imageAccept,
  noteRead,
  refused,
  type BlobAddress,
} from '../artwork';
import { isReachable } from '../connection';
import { settings, useSetting } from '../settings';
import { maybeSaved, noteSaved, schedulePrune } from '.';
import { readImage, writeImage } from './store';

const MAX_URLS = 400;

const urls = new Map<string, BlobAddress>();

interface Lookup {
  url: Promise<string>;
  users: number;
  controller: AbortController;
}

const lookups = new Map<string, Lookup>();
/** Images whose host refused to let the page read them, so they load plainly. */
const unreadable = new Set<string>();

async function keep(src: string, blob: Blob): Promise<string> {
  const address = await blobAddress(blob);
  urls.set(src, address);
  if (urls.size > MAX_URLS) {
    // An image already drawn keeps its picture after its URL is revoked.
    const [oldest, old] = urls.entries().next().value!;
    urls.delete(oldest);
    old.revoke();
  }
  return address.src;
}

/*
 * Fetched here, not by the `<img>`: the browser caches a fetch and an image
 * load apart, so saving after a load would download it twice.
 */
async function fetchAndSave(src: string, signal: AbortSignal): Promise<string> {
  if (unreadable.has(src) || refused(src)) return src;
  let res: Response;
  try {
    res = await fetch(src, { headers: { Accept: imageAccept() }, signal });
  } catch {
    if (signal.aborted) return src;
    noteRead(src, false);
    if (isReachable()) unreadable.add(src);
    return src;
  }
  // The `<img>` gets the failure to show, and moves on to the next source.
  if (!res.ok) return src;
  noteRead(src, true);
  const blob = await res.blob();
  void writeImage(src, blob.type, blob)
    .then((bytes) => {
      noteSaved(src);
      schedulePrune(bytes);
    })
    .catch(() => undefined);
  return keep(src, blob);
}

function lookUp(src: string): Lookup {
  const found = lookups.get(src);
  if (found) return found;
  const controller = new AbortController();
  const lookup: Lookup = {
    url: (maybeSaved(src) ? readImage(src) : Promise.resolve(null))
      .then((saved) =>
        saved ? keep(src, saved.blob) : fetchAndSave(src, controller.signal)
      )
      .catch(() => src)
      .finally(() => {
        if (lookups.get(src) === lookup) lookups.delete(src);
      }),
    users: 0,
    controller,
  };
  lookups.set(src, lookup);
  return lookup;
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
  const known = src && on ? urls.get(src)?.src : undefined;
  const [found, setFound] = React.useState<{ src: string; url: string }>();
  React.useEffect(() => {
    if (!src || !on || known || !wanted) return;
    let live = true;
    const lookup = lookUp(src);
    lookup.users++;
    void lookup.url.then((url) => {
      if (live) setFound({ src, url });
    });
    return () => {
      live = false;
      // Unwanted now, so it frees one of the server's few connections.
      if (--lookup.users) return;
      lookup.controller.abort();
      if (lookups.get(src) === lookup) lookups.delete(src);
    };
  }, [src, on, known, wanted]);
  if (!src || !on) return src;
  return known ?? (found?.src === src ? found.url : undefined);
}
