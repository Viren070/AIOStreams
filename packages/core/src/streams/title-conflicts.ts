import pLimit from 'p-limit';
import {
  detectTitleConflicts,
  stripTitleDisambiguators,
  type DetectConflictsInput,
} from '../metadata/conflicts.js';
import type { Metadata, TitleConflict } from '../metadata/utils.js';
import { normaliseTitle } from '../parser/utils.js';
import { normaliseCountryCode } from '../utils/countries.js';

/** Only look up known aliases actually used by returned releases. */
export async function getStreamTitleConflicts(
  metadata: Metadata,
  streamTitles: string[],
  auth: Pick<DetectConflictsInput, 'tmdbAuth' | 'tvdbApiKey'>,
  detect = detectTitleConflicts
): Promise<Map<string, TitleConflict[]>> {
  const primary = normaliseTitle(
    stripTitleDisambiguators(metadata.title ?? '')
  );
  const conflicts = new Map<string, TitleConflict[]>([
    [primary, metadata.titleConflicts ?? []],
  ]);
  const aliases = new Map(
    (metadata.titles ?? []).map(({ title }) => [normaliseTitle(title), title])
  );
  const limit = pLimit(3);
  await Promise.all(
    [...new Set(streamTitles.map(normaliseTitle))]
      .filter((title) => title && title !== primary && aliases.has(title))
      .map((title) =>
        limit(async () => {
          const found = await detect({
            ...auth,
            title: aliases.get(title)!,
            year: metadata.year,
            country: metadata.country,
            tmdbId: metadata.tmdbId,
            tvdbId: metadata.tvdbId,
          }).catch(() => []);
          conflicts.set(title, found);
        })
      )
  );
  return conflicts;
}

/** A shared or missing discriminator cannot establish which show this is. */
export function confirmsTitleIdentity(
  metadata: Metadata,
  conflicts: TitleConflict[],
  evidence: {
    year?: string | number;
    country?: string;
    episodeTitleMatches?: boolean;
  }
): boolean {
  if (!conflicts.length) return true;
  if (evidence.episodeTitleMatches === true) return true;

  const country = normaliseCountryCode(evidence.country);
  const countryMatches =
    !!country && country === normaliseCountryCode(metadata.country);

  // A bounded range can identify an older box set, but not if it spans a
  // competing show's year. Reject malformed, open and reversed ranges.
  const years = /^(\d{4})(?:-(\d{4}))?$/.exec(String(evidence.year ?? ''));
  const startYear = years ? Number(years[1]) : undefined;
  const endYear = years ? Number(years[2] ?? years[1]) : undefined;
  const requestedYears = metadata.releaseYears?.length
    ? metadata.releaseYears
    : [metadata.year].filter((value): value is number => value !== undefined);
  const yearMatches =
    startYear !== undefined &&
    endYear !== undefined &&
    startYear <= endYear &&
    requestedYears.some(
      (value) => value >= startYear - 1 && value <= endYear + 1
    );

  // Different evidence may exclude different competitors: CN + 2025 can
  // rule out both a CN series from 2020 and a TR series from 2025.
  return conflicts.every((conflict) => {
    const otherCountry = normaliseCountryCode(conflict.country);
    return (
      (countryMatches && !!otherCountry && otherCountry !== country) ||
      (yearMatches &&
        conflict.year !== undefined &&
        (conflict.year < startYear! - 1 || conflict.year > endYear! + 1))
    );
  });
}
