import type { Metadata } from '../metadata/utils.js';

export interface ReleaseYearOptions {
  type?: string;
  isAnime?: boolean;
  tolerance?: number;
  useInitialAirDate?: boolean;
  seasons?: readonly number[];
}

/** Compatibility is not identity proof: a series run can include a remake's year. */
export function matchesReleaseYear(
  metadata: Metadata & { seasonYear?: number },
  year: string | number,
  options: ReleaseYearOptions = {}
): boolean {
  const parsed = /^(\d{4})(?:-(\d{4}))?$/.exec(String(year));
  if (!parsed) return false;
  const start = Number(parsed[1]);
  const end = Number(parsed[2] ?? parsed[1]);
  if (start > end) return false;
  const tolerance = options.tolerance ?? 1;
  const overlaps = (first: number, last = first) =>
    first <= end + tolerance && last >= start - tolerance;
  const initialOnly =
    options.useInitialAirDate &&
    ['series', 'anime'].includes(options.type ?? 'series');
  if (
    !initialOnly &&
    options.type !== 'movie' &&
    (options.seasons?.length ?? 0) <= 1
  ) {
    const years = [
      ...(metadata.releaseYears ?? []),
      ...(options.isAnime && metadata.seasonYear !== undefined
        ? [metadata.seasonYear]
        : []),
    ];
    // A database season year can be known even when episode metadata is not.
    // It adds compatibility; only resolved release years replace the run range.
    if (years.some((value) => overlaps(value))) return true;
    if (metadata.releaseYears?.length) return false;
  }
  if (metadata.year === undefined) return true;
  return overlaps(
    metadata.year,
    initialOnly ? metadata.year : (metadata.yearEnd ?? metadata.year)
  );
}
