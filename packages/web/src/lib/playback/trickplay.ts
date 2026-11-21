import type { JellyfinClient } from '@/lib/jellyfin/client';
import type { BaseItemDto, SourceInfo } from '@/lib/jellyfin/types';
import type { Thumbnail } from './engine';
import type { Chapter } from './chapters';
import { parseChapters } from './chapters';
import { TICKS_PER_MS } from '@/lib/format';

interface Sheet {
  Width?: number;
  Height?: number;
  TileWidth?: number;
  TileHeight?: number;
  ThumbnailCount?: number;
  Interval?: number;
}

/** The server's chapters for a title, as the player lists them. */
export function serverChapters(item: BaseItemDto): Chapter[] {
  return parseChapters(
    (item.Chapters ?? []).map((c) => ({
      title: c.Name ?? undefined,
      startMs: (c.StartPositionTicks ?? 0) / TICKS_PER_MS,
    }))
  );
}

/**
 * Seek bar pictures from the server's trickplay sheets for the version, the
 * narrowest at least 320 pixels wide; null where it has none.
 */
export function trickplayFeed(
  client: JellyfinClient,
  item: BaseItemDto,
  source: SourceInfo
) {
  const widths = (
    item.Trickplay as Record<string, Record<string, Sheet>> | null | undefined
  )?.[source.Id ?? ''];
  const sheets = Object.values(widths ?? {}).sort(
    (a, b) => (a.Width ?? 0) - (b.Width ?? 0)
  );
  const sheet = sheets.find((s) => (s.Width ?? 0) >= 320) ?? sheets.at(-1);
  const {
    Width: width = 0,
    Height: height = 0,
    TileWidth: across = 0,
    TileHeight: down = 0,
    ThumbnailCount: count = 0,
    Interval: interval = 0,
  } = sheet ?? {};
  if (!width || !height || !across || !down || !count || !interval) return null;
  const perSheet = across * down;

  return (onThumbnail: (thumbnail: Thumbnail | null) => void) => {
    const images = new Map<number, Promise<ImageBitmap>>();
    const pictures = new Map<number, string>();
    let stopped = false;
    let wanted = -1;
    const image = (index: number) => {
      const at = Math.floor(index / perSheet);
      let loading = images.get(at);
      if (!loading) {
        const url = client.url(
          `/Videos/${item.Id}/Trickplay/${width}/${at}.jpg`,
          {
            MediaSourceId: source.Id,
            ApiKey: client.token,
          }
        );
        loading = fetch(url)
          .then((res) => {
            if (!res.ok) throw new Error(String(res.status));
            return res.blob();
          })
          .then((blob) => createImageBitmap(blob));
        images.set(at, loading);
      }
      return loading;
    };
    const picture = async (index: number): Promise<string> => {
      const made = pictures.get(index);
      if (made) return made;
      const sheet = await image(index);
      const at = index % perSheet;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas
        .getContext('2d')
        ?.drawImage(
          sheet,
          (at % across) * width,
          Math.floor(at / across) * height,
          width,
          height,
          0,
          0,
          width,
          height
        );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85)
      );
      if (!blob) throw new Error('no picture');
      const src = URL.createObjectURL(blob);
      pictures.set(index, src);
      return src;
    };
    return {
      want(ms: number, showingMs?: number) {
        const index = Math.min(
          count - 1,
          Math.max(0, Math.floor(ms / interval))
        );
        const positionMs = index * interval;
        wanted = index;
        if (positionMs === showingMs) return;
        picture(index).then(
          (src) => {
            if (!stopped && wanted === index) onThumbnail({ positionMs, src });
          },
          () => {
            if (!stopped && wanted === index) onThumbnail(null);
          }
        );
      },
      prepare() {
        void image(0).catch(() => {});
      },
      stop() {
        stopped = true;
        for (const src of pictures.values()) URL.revokeObjectURL(src);
        pictures.clear();
        for (const loading of images.values())
          void loading.then(
            (bitmap) => bitmap.close(),
            () => {}
          );
        images.clear();
      },
    };
  };
}
