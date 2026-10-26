import type { JellyfinClient } from './client';
import { currentHost } from './hosts';
import type { BaseItemDto } from './types';

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

export function backdropUrl(
  client: JellyfinClient,
  item: BaseItemDto,
  size?: Size
): string | null {
  return (
    image(client, item.Id, 'Backdrop', item.BackdropImageTags?.[0], size) ??
    image(
      client,
      item.ParentBackdropItemId,
      'Backdrop',
      item.ParentBackdropImageTags?.[0],
      size
    )
  );
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
