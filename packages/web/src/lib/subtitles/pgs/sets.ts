import { parseDisplaySet, shownPictures, type DisplaySet } from './display-set';

/** In the video's pixels. */
export interface DrawnSet {
  width: number;
  height: number;
  pictures: { x: number; y: number; image: ImageBitmap }[];
}

export class PgsSets {
  private sets: { startMs: number; set: DisplaySet }[] = [];
  private readonly starts = new Set<number>();

  add(events: { startMs: number; data: Uint8Array }[]): void {
    for (const { startMs, data } of events) {
      if (this.starts.has(startMs)) continue;
      this.starts.add(startMs);
      this.sets.push({ startMs, set: parseDisplaySet(data) });
    }
    this.sets.sort((a, b) => a.startMs - b.startMs);
  }

  drop(startMs: number): void {
    this.sets = this.sets.filter((s) => {
      if (s.startMs >= startMs) return true;
      this.starts.delete(s.startMs);
      return false;
    });
  }

  async draw(startMs: number): Promise<DrawnSet | null> {
    const at = this.sets.findIndex((s) => s.startMs === startMs);
    const found =
      at < 0
        ? null
        : shownPictures(
            this.sets.map((s) => s.set),
            at
          );
    if (!found) return null;
    return {
      width: found.width,
      height: found.height,
      pictures: await Promise.all(
        found.pictures.map(async ({ x, y, width, height, rgba }) => ({
          x,
          y,
          image: await createImageBitmap(new ImageData(rgba, width, height)),
        }))
      ),
    };
  }
}
