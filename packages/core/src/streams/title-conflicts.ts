import pLimit from 'p-limit';
import {
  conflictEpisodeBound,
  type ConflictNumberingBounds,
} from './title-conflict-episodes.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
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
    /** UTC year derived from a finite, nonnegative upload age. */
    uploadYear?: number;
    /** Lowest number in a request-matching episode batch. */
    episode?: number;
    season?: number;
    conflictNumberingBounds?: ReadonlyMap<
      number | string,
      ConflictNumberingBounds
    >;
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
    const bounds = evidence.conflictNumberingBounds?.get(
      conflict.tvdbId ?? `tmdb:${conflict.tmdbId}`
    );
    // Uploads from before a remake existed can identify the older series.
    // Leave a full calendar-year margin, require the requested show to exist,
    // and never let this override explicit year/country tags.
    const predatesCompetitor =
      evidence.year === undefined &&
      !evidence.country &&
      Number.isSafeInteger(evidence.uploadYear) &&
      Number.isSafeInteger(metadata.year) &&
      metadata.year! >= 1800 &&
      Number.isSafeInteger(conflict.year) &&
      evidence.uploadYear! >= metadata.year! &&
      evidence.uploadYear! < conflict.year! - 1;
    return (
      predatesCompetitor ||
      (evidence.year === undefined &&
        !evidence.country &&
        bounds !== undefined &&
        ((evidence.episode !== undefined &&
          Number.isSafeInteger(evidence.episode) &&
          bounds.episode !== undefined &&
          evidence.episode > bounds.episode) ||
          (evidence.season !== undefined &&
            Number.isSafeInteger(evidence.season) &&
            evidence.season > bounds.season))) ||
      (countryMatches && !!otherCountry && otherCountry !== country) ||
      (yearMatches &&
        conflict.year !== undefined &&
        (conflict.year < startYear! - 1 || conflict.year > endYear! + 1))
    );
  });
}

/** Remove numbered presentation labels, never a bare label or the episode name. */
export function showIdentityEpisodeTitleKey(title: string): string {
  return normaliseTitle(
    title.replace(
      /^(?:episode|chapter|part|session)[\s._-]+#?\s*\d+[\s.:_-]+(?=\S)/i,
      ''
    )
  );
}

/** Exclude generic labels from show-identity evidence. */
export function isDistinctiveEpisodeTitle(title: string | undefined): boolean {
  if (!title) return false;
  const normalized = showIdentityEpisodeTitleKey(title);
  return (
    normalized.length >= 8 &&
    !/^(?:episode|ep|chapter|part|day|week|session|season|special|ova|oad|pilot|finale|premiere|tba|tbd|untitled)(?:[0-9ivxlcdm]*|one|two|three|four|five|six|seven|eight|nine|ten)$/.test(
      normalized
    )
  );
}

/**
 * A distinctive episode name can identify the SHOW even when providers disagree
 * on episode ordering. This does not establish which episode was requested and
 * never supplies titles to the separate episode-title/numbering filters.
 * Missing or incomplete competitor catalogs provide no evidence.
 */
export async function getShowIdentityEpisodeTitles(
  metadata: Metadata,
  conflicts: ReadonlyMap<string, TitleConflict[]>,
  getShow = (id: number) => new SkyhookMetadata().getShow(id)
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (!metadata.tvdbId || !conflicts.size) return result;
  const limit = pLimit(3);
  const pending = new Map<number, ReturnType<typeof getShow>>();
  const read = (id: number) => {
    if (!pending.has(id))
      pending.set(
        id,
        limit(() => getShow(id)).catch(() => null)
      );
    return pending.get(id)!;
  };
  const requested = await read(metadata.tvdbId);
  if (requested?.tvdbId !== metadata.tvdbId) return result;
  const names = new Set(
    (requested.episodes ?? [])
      .filter(
        (e) =>
          (e.seasonNumber ?? 0) > 0 &&
          isDistinctiveEpisodeTitle(e.title ?? undefined)
      )
      .map((e) => showIdentityEpisodeTitleKey(e.title!))
  );
  if (!names.size) return result;
  await Promise.all(
    [...conflicts].map(async ([alias, competitors]) => {
      if (!competitors.length || competitors.some((c) => !c.tvdbId)) return;
      const shows = await Promise.all(competitors.map((c) => read(c.tvdbId!)));
      if (
        shows.some(
          (show, i) =>
            show?.tvdbId !== competitors[i].tvdbId ||
            conflictEpisodeBound(show!) === undefined ||
            show!.episodes!.some((e) => !e.title?.trim())
        )
      )
        return;
      const otherNames = new Set(
        shows.flatMap((show) =>
          show!.episodes!.map((e) => showIdentityEpisodeTitleKey(e.title!))
        )
      );
      result.set(
        alias,
        new Set([...names].filter((name) => !otherNames.has(name)))
      );
    })
  );
  return result;
}
