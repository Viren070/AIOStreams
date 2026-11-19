import type { Meta } from '../db/schemas.js';
import { Time } from '../utils/time.js';

type MetaVideo = NonNullable<Meta['videos']>[number];

/**
 * The requested episode as its meta dates it. Meta addons number episodes
 * their own way, even under IMDb ids, so the id alone may not say which one.
 */
export interface MetaHint {
  released: string;
}

const timeOf = (value: unknown) => new Date(String(value)).getTime();

/**
 * The hint a meta gives for one of its videos, from the video's `released`
 * (its initial air date in the Stremio meta spec), if usable.
 */
export function metaHintFromMeta(
  meta: Pick<Meta, 'released'> | null | undefined,
  video: Pick<MetaVideo, 'released'> | null | undefined
): MetaHint | undefined {
  const released = video?.released;
  const aired = timeOf(released);
  // A date before the show's own is inconsistent.
  const beforeShow = aired < timeOf(meta?.released) - Time.Day;
  return released && !Number.isNaN(aired) && !beforeShow
    ? { released }
    : undefined;
}
