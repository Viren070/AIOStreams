import { z } from 'zod';

/**
 * Which stream formats an Xtream login's channels are offered in: HLS
 * (`m3u8`) or MPEG-TS (`ts`), either first or alone.
 */
export const XTREAM_FORMATS = ['hls-first', 'ts-first', 'hls', 'ts'] as const;
export const XtreamFormatSchema = z.enum(XTREAM_FORMATS);
export type XtreamFormat = z.infer<typeof XtreamFormatSchema>;

const WANTED = {
  'hls-first': 'm3u8',
  hls: 'm3u8',
  'ts-first': 'ts',
  ts: 'ts',
} as const;

/**
 * The account's formats in the order to offer them. A format the account does
 * not allow is not offered; if that leaves none, all it allows are, so a
 * channel always has a stream.
 */
export function orderFormats(
  available: string[],
  preference: XtreamFormat
): string[] {
  const wanted = WANTED[preference];
  const first = available.filter((f) => f === wanted);
  const rest = available.filter((f) => f !== wanted);
  if (preference === 'hls' || preference === 'ts')
    return first.length ? first : rest;
  return [...first, ...rest];
}
