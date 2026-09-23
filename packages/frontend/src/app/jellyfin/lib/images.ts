import type { JellyfinClient } from './client';
import type { BaseItemDto } from './types';

type Size = { maxWidth?: number };

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
  return client.url(path, { tag, maxWidth: size.maxWidth, quality: 90 });
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
    return (
      image(client, item.Id, 'Primary', item.ImageTags?.Primary, size) ??
      image(client, item.SeriesId, 'Primary', item.SeriesPrimaryImageTag, size)
    );
  }
  return image(client, item.Id, 'Primary', item.ImageTags?.Primary, size);
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

export function logoUrl(
  client: JellyfinClient,
  item: BaseItemDto
): string | null {
  return (
    image(client, item.Id, 'Logo', item.ImageTags?.Logo) ??
    image(client, item.ParentLogoItemId, 'Logo', item.ParentLogoImageTag)
  );
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
    maxWidth: 240,
  });
}
