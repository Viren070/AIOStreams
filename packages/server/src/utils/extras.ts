import type { Request } from 'express';

/**
 * The `{/:extras}` segment as sent. Express decodes the param, turning an
 * encoded `&` inside a value into a separator.
 */
export function rawExtras(
  req: Pick<Request, 'path'> & { params: { extras?: string } }
): string | undefined {
  if (req.params.extras === undefined) return undefined;
  const segment = req.path.slice(req.path.lastIndexOf('/') + 1);
  return segment.replace(/\.json$/, '');
}
