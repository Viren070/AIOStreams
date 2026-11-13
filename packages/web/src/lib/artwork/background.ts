import React from 'react';
import { themeVariables } from '@aiostreams/ui/utils/palette';
import type { JellyfinClient } from '@/lib/jellyfin/client';
import { useSession } from '@/lib/jellyfin/session';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { usePageShown } from '@/lib/page-shown';
import { settings, useSetting } from '@/lib/settings';
import { imageAccept } from './reads';
import { washArtwork } from './shrink';
import { backdropUrls, posterUrl } from './urls';
import {
  drawWash,
  GRID_H,
  GRID_W,
  makeWash,
  WASH_H,
  WASH_W,
  type Wash,
} from './wash';

export interface WashFrame {
  src: string;
  image: ImageBitmap | HTMLCanvasElement;
  /** Where the art meets the page: its bottom edge's colour. */
  tint: string;
  panel: string;
}

const PANELS =
  '.UI-Popover__root, .UI-DropdownMenu__root, .UI-DropdownMenu__subContent, .UI-ContextMenu__root, .UI-Select__content, .UI-Tooltip__root, .UI-Modal__content, .UI-Drawer__content, .UI-Input__root, [data-ui=settings-card], [data-ui=settings-tab-group], [data-ui=pill-tabs]';

let panelStyle: HTMLStyleElement | null = null;

/** A rule on the panels alone: variables on the root restyle the whole page on each change. */
function paintPanels(panel: string | null) {
  panelStyle ??= document.head.appendChild(document.createElement('style'));
  panelStyle.dataset.ui = 'art-panels';
  const vars = panel
    ? Object.entries(themeVariables({ background: panel }))
        .map(([name, value]) => `${name}: ${value};`)
        .join(' ')
    : '';
  panelStyle.textContent = vars
    ? `html[data-art-wash]:not(.playing) :is(${PANELS}) { ${vars} }`
    : '';
}

/** Made on the page where no worker can draw. */
const madeHere = new Map<string, Wash>();

async function washHere(src: string): Promise<WashFrame | null> {
  let wash = madeHere.get(src);
  if (!wash) {
    const res = await fetch(src, {
      headers: { Accept: imageAccept() },
      priority: 'low',
    });
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const grid = document.createElement('canvas');
    grid.width = GRID_W;
    grid.height = GRID_H;
    const ctx = grid.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    const scale = Math.max(GRID_W / bitmap.width, GRID_H / bitmap.height);
    const sw = GRID_W / scale;
    const sh = GRID_H / scale;
    ctx.drawImage(
      bitmap,
      (bitmap.width - sw) / 2,
      (bitmap.height - sh) / 2,
      sw,
      sh,
      0,
      0,
      GRID_W,
      GRID_H
    );
    bitmap.close();
    wash = makeWash(ctx.getImageData(0, 0, GRID_W, GRID_H).data);
    madeHere.set(src, wash);
  }
  const image = document.createElement('canvas');
  image.width = WASH_W;
  image.height = WASH_H;
  const ctx = image.getContext('2d')!;
  const pixels = ctx.createImageData(WASH_W, WASH_H);
  drawWash(wash, pixels.data);
  ctx.putImageData(pixels, 0, 0);
  return { src, image, tint: wash.tint, panel: wash.panel };
}

async function frameOf(src: string): Promise<WashFrame | null> {
  const made = await washArtwork(src);
  if (made === undefined) return washHere(src).catch(() => null);
  return (
    made && { src, image: made.bitmap, tint: made.tint, panel: made.panel }
  );
}

type Shown = { src: string; over: boolean };

/** Newest last. */
const shown: Shown[] = [];
/** A card rested on, until a page comes to show its own title. */
let selectedSrc: string | undefined;
let restTimer: ReturnType<typeof setTimeout> | undefined;
let restingOn: string | undefined;
const REST_MS = 500;
/** Held while something plays, so the wash takes nothing from it. */
let paused = false;
let making: string | undefined;

let frame: WashFrame | null = null;
const listeners = new Set<() => void>();
export const subscribeWash = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const currentWash = () => frame;
export const useWashShown = () =>
  React.useSyncExternalStore(subscribeWash, () => frame !== null);

const newest = (over: boolean) =>
  shown.filter((entry) => entry.over === over).pop()?.src;

/** A dialog's title over the card rested on, over the page's own. */
function apply() {
  const src = newest(true) ?? selectedSrc ?? newest(false);
  // A page without art keeps the last.
  if (paused || !src || src === frame?.src || src === making) return;
  making = src;
  void frameOf(src).then((next) => {
    if (making === src) making = undefined;
    const wanted = newest(true) ?? selectedSrc ?? newest(false);
    if (!next || paused || wanted !== src) {
      if (next?.image instanceof ImageBitmap) next.image.close();
      if (next && wanted !== src) apply();
      return;
    }
    const was = frame;
    frame = next;
    document.documentElement.setAttribute('data-art-wash', '');
    paintPanels(next.panel);
    // The layers draw it as they hear of it, so the last can go.
    for (const listener of listeners) listener();
    if (was?.image instanceof ImageBitmap) was.image.close();
  });
}

export function setWashPaused(on: boolean) {
  paused = on;
  if (!on) apply();
}

/** Gives the background back to the page's own title. */
export function releaseArtSelection() {
  clearTimeout(restTimer);
  restingOn = undefined;
  if (selectedSrc === undefined) return;
  selectedSrc = undefined;
  apply();
}

export function clearArtBackground() {
  if (frame?.image instanceof ImageBitmap) frame.image.close();
  frame = null;
  document.documentElement.removeAttribute('data-art-wash');
  paintPanels(null);
  for (const listener of listeners) listener();
}

const artSrc = (client: JellyfinClient, item: BaseItemDto) =>
  backdropUrls(client, item, { maxWidth: 300 })[0] ??
  posterUrl(client, item, { maxWidth: 160 }) ??
  undefined;

/** Puts the title's artwork behind the pages while it is shown; `over` for a dialog's. */
export function useArtBackground(
  item: BaseItemDto | null | undefined,
  over = false
) {
  const { client } = useSession();
  const [on] = useSetting(settings.theme.artBackground);
  const pageShown = usePageShown();
  const src = on && pageShown && item ? artSrc(client, item) : undefined;
  const last = React.useRef<string>(undefined);
  React.useEffect(() => {
    const arriving = !last.current;
    last.current = src;
    if (!src) return;
    if (arriving && !over) selectedSrc = undefined;
    const entry: Shown = { src, over };
    shown.push(entry);
    apply();
    return () => {
      shown.splice(shown.indexOf(entry), 1);
      apply();
    };
  }, [src, over]);
}

/** A card's handlers that put its artwork behind the pages once it is rested on. */
export function useArtTarget(item: BaseItemDto) {
  const { client } = useSession();
  const [on] = useSetting(settings.theme.artBackground);
  const src = on ? artSrc(client, item) : undefined;
  if (!src) return undefined;
  const rest = () => {
    if (selectedSrc === src || restingOn === src) return;
    clearTimeout(restTimer);
    restingOn = src;
    restTimer = setTimeout(() => {
      restingOn = undefined;
      selectedSrc = src;
      apply();
    }, REST_MS);
  };
  const leave = () => {
    clearTimeout(restTimer);
    restingOn = undefined;
  };
  return {
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') rest();
    },
    onPointerLeave: leave,
    onFocus: (e: React.FocusEvent) => {
      if ((e.target as Element).matches(':focus-visible')) rest();
    },
    onBlur: leave,
  };
}
