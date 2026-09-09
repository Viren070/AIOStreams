import type { ParsedStream } from '../db/schemas.js';
import { constants } from '../utils/index.js';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function serviceShortName(stream: ParsedStream): string | undefined {
  const id = stream.service?.id;
  if (!id) return undefined;
  const details = (
    constants.SERVICE_DETAILS as Record<
      string,
      { shortName?: string } | undefined
    >
  )[id];
  const short = details?.shortName ?? id.toUpperCase();
  return stream.service?.cached === false ? `${short} (uncached)` : short;
}

/** One line a client can show in a version picker. */
export function defaultLabel(stream: ParsedStream): string {
  const pf = stream.parsedFile;
  const hdr = (pf?.visualTags ?? []).filter((t) => /HDR|DV|Dolby|HLG/i.test(t));
  const parts = [
    pf?.resolution && pf.resolution !== 'Unknown' ? pf.resolution : undefined,
    pf?.encode && pf.encode !== 'Unknown' ? pf.encode : undefined,
    hdr.length ? hdr.join('/') : undefined,
    stream.size ? formatBytes(stream.size) : undefined,
    serviceShortName(stream),
    stream.addon?.name,
  ].filter((p): p is string => !!p);
  const label = parts.join(' · ');
  return label || stream.originalName || stream.addon?.name || 'Stream';
}

/** The name a client shows in its version picker. */
export function labelFrom(
  formatted: { name: string },
  stream: ParsedStream
): string {
  return formatted.name.trim() || defaultLabel(stream);
}
