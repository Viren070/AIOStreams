import { RandomAccess } from '../random-access.js';
import { VolumeCtx, SIG_PREFIX, MAX_SFX_SCAN } from './types.js';

/**
 * Read `[abs, abs+len)` clamped to the volume: from the in-memory head when
 * it covers the window (the common case: signature + leading block headers),
 * else from the backing source.
 */
export async function readWindow(
  ra: RandomAccess,
  ctx: VolumeCtx,
  abs: number,
  len: number
): Promise<Buffer> {
  const want = Math.min(len, ctx.range.end - abs);
  if (want <= 0) return Buffer.alloc(0);
  if (ctx.head) {
    const rel = abs - ctx.range.start;
    if (rel >= 0 && rel + want <= ctx.head.length) {
      return ctx.head.subarray(rel, rel + want);
    }
  }
  return ra.readAt(abs, want);
}

export function scanSignature(
  win: Buffer,
  base: number
): { version: 4 | 5; dataStart: number } | undefined {
  let i = 0;
  while (i + SIG_PREFIX.length + 2 <= win.length) {
    const idx = win.indexOf(SIG_PREFIX, i);
    if (idx < 0) break;
    const after = idx + SIG_PREFIX.length;
    const vByte = win[after];
    if (vByte === 0) {
      return { version: 4, dataStart: base + after + 1 };
    }
    if (win[after + 1] === 0) {
      return { version: 5, dataStart: base + after + 2 };
    }
    i = idx + 1; // false positive; keep scanning
  }
  return undefined;
}

/** Scan for the RAR marker; returns version + post-marker offset. */
export async function findSignature(
  ra: RandomAccess,
  ctx: VolumeCtx
): Promise<{ version: 4 | 5; dataStart: number } | undefined> {
  const { range, head } = ctx;
  const volLen = range.end - range.start;
  // Pass 1: the in-memory head (free). Pass 2: a 64KB cold read, only for
  // volumes whose signature is not within the probed prefix (SFX stubs).
  if (head && head.length >= SIG_PREFIX.length + 2) {
    const hit = scanSignature(
      head.subarray(0, Math.min(head.length, volLen)),
      range.start
    );
    if (hit) return hit;
    if (head.length >= Math.min(volLen, MAX_SFX_SCAN)) return undefined;
  }
  const win = await ra.readAt(
    range.start,
    Math.min(volLen, MAX_SFX_SCAN, 64 * 1024)
  );
  return scanSignature(win, range.start);
}
