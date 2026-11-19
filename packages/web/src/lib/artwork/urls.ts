import React from 'react';
import type { JellyfinClient } from '@/lib/jellyfin/client';
import { currentHost } from '@/lib/hosts';
import type { BaseItemDto } from '@/lib/jellyfin/types';

/** `maxWidth` is the widest the image is drawn at, in CSS pixels. */
type Size = { maxWidth?: number };

const STEPS = [
  120, 160, 240, 320, 400, 480, 640, 800, 960, 1280, 1600, 1920, 2560, 3840,
];

/**
 * In device pixels, rounded up to a step so the same URLs come back, and no
 * wider than the screen.
 */
function deviceWidth(css: number): number {
  const { ratio, screenPx } = drawn();
  const px = Math.min(css * ratio, screenPx);
  const step = STEPS.find((s) => s >= px) ?? Math.ceil(px);
  // A step can round past the screen, as 1366 does to 1600.
  return Math.min(step, Math.ceil(screenPx));
}

const RESOLUTIONS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
/** As decoding bigger artwork stutters a TV. */
const TV_MAX_RATIO = 2;

/** Amazon's WebView reports twice its ratio, which CSS resolution gets right. */
function resolution(reported: number): number {
  // Only when far below the reported one, so fractional ratios stand.
  if (!matchMedia(`(max-resolution: ${reported / 1.5}dppx)`).matches)
    return reported;
  let ratio = 1;
  for (const r of RESOLUTIONS)
    if (matchMedia(`(min-resolution: ${r}dppx)`).matches) ratio = r;
  return ratio;
}

// Read again on resize only: reading innerWidth lays the page out, which a TV
// pays for on every card.
let measured: { reported: number; ratio: number; screenPx: number } | null =
  null;
addEventListener('resize', () => (measured = null));

function drawn() {
  const reported = window.devicePixelRatio || 1;
  if (measured?.reported !== reported) {
    const dppx = resolution(reported);
    measured = {
      reported,
      // A TV lays the page out 1280 wide and fits it to its screen, up or down.
      ratio: currentHost().tv
        ? Math.min(TV_MAX_RATIO, (screen.width * dppx) / innerWidth || dppx)
        : dppx,
      screenPx: Math.max(screen.width, screen.height) * dppx || Infinity,
    };
  }
  return measured;
}

/** Device pixels per CSS pixel, as the page is drawn. */
export const drawnRatio = () => drawn().ratio;

function image(
  client: JellyfinClient,
  itemId: string | null | undefined,
  type: 'Primary' | 'Backdrop' | 'Thumb' | 'Logo',
  tag: string | null | undefined,
  size: Size = {}
): string | null {
  if (!itemId || !tag) return null;
  const path =
    type === 'Backdrop'
      ? `/Items/${itemId}/Images/Backdrop/0`
      : `/Items/${itemId}/Images/${type}`;
  return client.url(path, {
    tag,
    maxWidth: size.maxWidth && deviceWidth(size.maxWidth),
    quality: 90,
  });
}

/** A portrait poster; an episode borrows its show's. */
export function posterUrl(
  client: JellyfinClient,
  item: BaseItemDto,
  size?: Size
): string | null {
  if (item.Type === 'Episode') {
    return (
      image(
        client,
        item.SeriesId,
        'Primary',
        item.SeriesPrimaryImageTag,
        size
      ) ?? image(client, item.Id, 'Primary', item.ImageTags?.Primary, size)
    );
  }
  if (item.Type === 'Season') {
    const own = item.ImageTags?.Primary;
    // A season showing its show's poster asks for the show's, which every such season then shares.
    return (
      (own !== item.SeriesPrimaryImageTag
        ? image(client, item.Id, 'Primary', own, size)
        : null) ??
      image(client, item.SeriesId, 'Primary', item.SeriesPrimaryImageTag, size)
    );
  }
  return image(client, item.Id, 'Primary', item.ImageTags?.Primary, size);
}

/** A card's images, best first: a landscape card takes the landscape art made for it before the poster. */
export function cardImages(
  client: JellyfinClient,
  item: BaseItemDto,
  shape: 'poster' | 'landscape' | 'square',
  size?: Size
): string[] {
  return [
    shape === 'landscape'
      ? image(client, item.Id, 'Thumb', item.ImageTags?.Thumb, size)
      : null,
    posterUrl(client, item, size),
  ].filter((url): url is string => !!url);
}

/**
 * A wide card's art as the hero, its page and the player's cover show the
 * title: its backdrop first, an episode's its show's, the same picture
 * throughout.
 */
export function wideCardUrls(
  client: JellyfinClient,
  item: BaseItemDto,
  size?: Size
): string[] {
  const all = landscapeUrls(client, item, size);
  const backdrop = backdropUrl(client, item, size);
  return backdrop ? [backdrop, ...all.filter((url) => url !== backdrop)] : all;
}

/** A landscape still: an episode's own, else a thumb or backdrop. */
export function landscapeUrl(
  client: JellyfinClient,
  item: BaseItemDto,
  size?: Size
): string | null {
  return landscapeUrls(client, item, size)[0] ?? null;
}

/** Every landscape image, best first. */
export function landscapeUrls(
  client: JellyfinClient,
  item: BaseItemDto,
  size?: Size
): string[] {
  const candidates =
    item.Type === 'Episode'
      ? [
          image(client, item.Id, 'Primary', item.ImageTags?.Primary, size),
          image(
            client,
            item.ParentThumbItemId,
            'Thumb',
            item.ParentThumbImageTag,
            size
          ),
          backdropUrl(client, item, size),
        ]
      : [
          image(client, item.Id, 'Thumb', item.ImageTags?.Thumb, size),
          backdropUrl(client, item, size),
          image(client, item.Id, 'Primary', item.ImageTags?.Primary, size),
        ];
  return candidates.filter((url): url is string => !!url);
}

/**
 * One backdrop per title wherever it shows. The server tags each list's
 * items with the art of whichever source the list came from, some of it
 * small, so one title can carry a different backdrop in each. The finest
 * source's holds: the hero's, then the title's own details', then any
 * list's; one that turns up finer than what's drawn redraws it.
 */
export const BACKDROP_RANK = { list: 1, details: 2, hero: 3 } as const;
type BackdropRank = keyof typeof BACKDROP_RANK;

const backdropOf = new Map<string, { tag: string; rank: number }>();
let backdropsVersion = 0;
let notifying = false;
const backdropListeners = new Set<() => void>();

function settle(
  id: string | null | undefined,
  tag: string | null | undefined,
  rank: BackdropRank
): void {
  if (!id || !tag) return;
  const was = backdropOf.get(id);
  // A list's first holds; a newer fetch of the hero or the details replaces its own.
  const strength = BACKDROP_RANK[rank];
  if (
    was &&
    (was.rank > strength || (was.rank === strength && rank === 'list'))
  )
    return;
  backdropOf.set(id, { tag, rank: BACKDROP_RANK[rank] });
  if (!was || was.tag === tag || notifying) return;
  // Often while drawing, so after it.
  notifying = true;
  queueMicrotask(() => {
    notifying = false;
    backdropsVersion++;
    for (const listener of backdropListeners) listener();
  });
}

/** Settles `item`'s backdrop, and its show's, at `rank`'s strength. */
export function settleBackdrop(
  item: BaseItemDto,
  rank: BackdropRank = 'list'
): void {
  settle(item.Id, item.BackdropImageTags?.[0], rank);
  settle(item.ParentBackdropItemId, item.ParentBackdropImageTags?.[0], rank);
}

/** Redraws the caller when a title's backdrop is settled on a finer one. */
const subscribeBackdrops = (listener: () => void) => {
  backdropListeners.add(listener);
  return () => void backdropListeners.delete(listener);
};
const backdropsNow = () => backdropsVersion;

export function useBackdropsSettled(): number {
  return React.useSyncExternalStore(subscribeBackdrops, backdropsNow);
}

const settledTag = (id: string | null | undefined) =>
  id ? backdropOf.get(id)?.tag : undefined;

export function backdropUrl(
  client: JellyfinClient,
  item: BaseItemDto,
  size?: Size
): string | null {
  settleBackdrop(item);
  const own = item.BackdropImageTags?.[0];
  if (own)
    return image(client, item.Id, 'Backdrop', settledTag(item.Id) ?? own, size);
  // An episode's is its show's, the same as the show's own wherever it shows.
  const show = item.ParentBackdropItemId;
  return image(
    client,
    show,
    'Backdrop',
    settledTag(show) ?? item.ParentBackdropImageTags?.[0],
    size
  );
}

/**
 * The backdrop each title was last shown with, as a list's details can lead
 * with another picture than its page's, often a poorer one; its page then
 * opens on the same.
 */
const shownBackdrops = new Map<string, string>();

export function noteShownBackdrop(
  id: string | null | undefined,
  src: string | null | undefined
): void {
  if (id && src) shownBackdrops.set(id, src);
}

/** `urls` led by the backdrop `id` was last shown with, where there's one. */
export function shownFirst(id: string | undefined, urls: string[]): string[] {
  const shown = id ? shownBackdrops.get(id) : undefined;
  return shown ? [shown, ...urls.filter((url) => url !== shown)] : urls;
}

export function backdropUrls(
  client: JellyfinClient,
  item: BaseItemDto,
  size?: Size
): string[] {
  return [
    backdropUrl(client, item, size),
    image(client, item.Id, 'Thumb', item.ImageTags?.Thumb, size),
  ].filter((url): url is string => !!url);
}

export function logoUrl(
  client: JellyfinClient,
  item: BaseItemDto,
  size?: Size
): string | null {
  return (
    image(client, item.Id, 'Logo', item.ImageTags?.Logo, size) ??
    image(client, item.ParentLogoItemId, 'Logo', item.ParentLogoImageTag, size)
  );
}

export function animatedPosterOf(item: BaseItemDto): string | undefined {
  const url = (item as { aiostreams?: { animatedPoster?: unknown } }).aiostreams
    ?.animatedPoster;
  return typeof url === 'string' ? url : undefined;
}

/** The shape a collection's own art was made for; everything else is a poster. */
export function cardShape(
  item: BaseItemDto
): 'poster' | 'landscape' | 'square' {
  const ratio = item.PrimaryImageAspectRatio ?? 0.6666;
  if (ratio > 1.2) return 'landscape';
  return ratio > 0.85 ? 'square' : 'poster';
}

export function personImageUrl(
  client: JellyfinClient,
  person: { Id?: string; PrimaryImageTag?: string | null }
): string | null {
  return image(client, person.Id, 'Primary', person.PrimaryImageTag, {
    maxWidth: 104,
  });
}
