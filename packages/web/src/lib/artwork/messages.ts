import type { Drawn } from './drawn';

export interface ShrinkJob {
  id: number;
  url: string;
  width: number;
  height: number;
  save: boolean;
  /** Reads the device's saved copy first. */
  look: boolean;
  /** What the small encoded copy for this box is saved as. */
  copy: string;
  lookCopy: boolean;
  accept: string;
}

export interface ShrinkReply {
  id: number;
  /** The image as it is, at a blob address the worker made. */
  src?: string;
  /** How large the image at `src` is. */
  bytes?: number;
  /** The image shrunk to the box. */
  bitmap?: ImageBitmap;
  /** Sent on its own once a shrunk image has a small encoded copy. */
  encoded?: { url: string; bytes: number } & Drawn;
  error?: string;
  /** The fetch itself failed, as it does when the host refuses cross-origin reads. */
  blocked?: true;
  /** The worker cannot draw at all, so no later job will fare better. */
  unsupported?: true;
  /** Sent on its own once a fetched image is saved. */
  saved?: { url: string; bytes: number };
}
