/**
 * Pooled article/segment buffers are sized in this granularity so a post
 * whose article sizes vary by a few hundred bytes shares one slot size
 * instead of dropping and reallocating a slot on every mismatch.
 */
const SLOT_GRANULARITY = 64 * 1024;

export function roundSlotSize(bytes: number): number {
  return Math.ceil(bytes / SLOT_GRANULARITY) * SLOT_GRANULARITY;
}
