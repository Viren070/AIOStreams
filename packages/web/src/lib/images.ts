import type { JellyfinClient } from './client';
import type { BaseItemDto } from './types';

/** `maxWidth` is the widest the image is drawn at, in CSS pixels. */
type Size = { maxWidth?: number };

const STEPS = [
  120, 160, 240, 320, 400, 480, 640, 800, 960, 1280, 1600, 1920, 2560, 3840,
];

/**
 * Screen pixels per CSS pixel. A TV lays the page out at 1280 wide (see tv.ts)
 * and scales it to its screen, which `devicePixelRatio` may leave out.
 */
export function pixelRatio(): number {
  return (tvRatio ??= tvScale());
}

// Read once and again on resize: reading innerWidth lays the page out, which
// a TV pays dearly for on every card.
let tvRatio: number | null = null;
addEventListener('resize', () => (tvRatio = null));

function tvScale(): number {
  const ratio = window.devicePixelRatio || 1;
  return document.documentElement.hasAttribute('data-tv')
    ? Math.max(ratio, screen.width / innerWidth)
    : ratio;
}

/**
 * In device pixels, rounded up to a step so the same URLs come back; never
 * wider than the screen, as a TV decoding 4K backdrops stutters.
 */
function deviceWidth(css: number): number {
  const screenPx = screen.width * (window.devicePixelRatio || 1);
  const px = Math.min(css * pixelRatio(), screenPx || Infinity);
  return STEPS.find((step) => step >= px) ?? Math.ceil(px);
}

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
