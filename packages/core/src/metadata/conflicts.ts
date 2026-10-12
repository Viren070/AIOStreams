/**
 * Finds same-name series (reboots, country variants) so queries and matching
 * filters can tell them apart. The TVDB source falls back to Skyhook when no
 * key is set or the keyed search fails.
 */
import { untilAborted } from '../utils/abort.js';
import { createLogger } from '../logging/logger.js';
import { normaliseTitle } from '../parser/utils.js';
import { appConfig } from '../utils/index.js';
import { TitleConflict } from './utils.js';
import { TMDBMetadata } from './tmdb.js';
import { TVDBMetadata } from './tvdb.js';
import { SkyhookMetadata } from './skyhook.js';

const logger = createLogger('title-conflicts');

/** Strips disambiguators TVDB embeds in names: "The Office (CA) (2012)". */
export function stripTitleDisambiguators(title: string): string {
  let stripped = title;
  for (;;) {
    const next = stripped
      .replace(/\s*\((?:[A-Z]{2,3}|\d{4})\)\s*$/, '')
      .trimEnd();
    if (next === stripped || !next) return stripped;
    stripped = next;
  }
}

interface Candidate {
  title: string;
  year?: number;
  country?: string;
  tmdbId?: number;
  tvdbId?: number;
}

export interface DetectConflictsInput {
  /** The show's primary title (may still carry a TVDB disambiguator). */
  title: string;
  year?: number;
  country?: string;
  tmdbId?: number | null;
  tvdbId?: number | null;
  tmdbAuth?: { accessToken?: string; apiKey?: string };
  tvdbApiKey?: string;
  signal?: AbortSignal;
  onProgress?: (conflicts: TitleConflict[]) => void;
}

export async function detectTitleConflicts(
  input: DetectConflictsInput
): Promise<TitleConflict[]> {
  if (input.signal?.aborted) return [];
  const baseTitle = stripTitleDisambiguators(input.title);
  const normBase = normaliseTitle(baseTitle);
  if (!normBase) return [];

  const tmdbAvailable = !!(
    input.tmdbAuth?.accessToken ||
    input.tmdbAuth?.apiKey ||
    appConfig.metadata.tmdb.accessToken ||
    appConfig.metadata.tmdb.apiKey
  );
  const tvdbKeyAvailable = !!(
    input.tvdbApiKey || appConfig.metadata.tvdb.apiKey
  );

  const tmdbPromise: Promise<Candidate[]> = tmdbAvailable
    ? new TMDBMetadata(input.tmdbAuth)
        .searchSeries(baseTitle, input.signal)
        .then((results) =>
          results
            .filter(
              (r) =>
                normaliseTitle(r.name ?? '') === normBase ||
                normaliseTitle(r.originalName ?? '') === normBase
            )
            .map((r) => ({
              title: r.name ?? baseTitle,
              year: r.year,
              country: r.country,
              tmdbId: r.tmdbId,
            }))
        )
        .catch((error) => {
          logger.debug(`TMDB conflict search failed: ${error}`);
          throw error;
        })
    : Promise.resolve([]);

  const skyhookSearch = (): Promise<Candidate[]> =>
    new SkyhookMetadata()
      .search(baseTitle, input.signal)
      .then((results) =>
        results
          .filter(
            (r) =>
              normaliseTitle(stripTitleDisambiguators(r.title)) === normBase
          )
          .map((r) => ({
            title: r.title,
            year: r.year,
            country: r.country,
            tvdbId: r.tvdbId,
          }))
      )
      .catch((error) => {
        logger.debug(`Skyhook conflict search failed: ${error}`);
        throw error;
      });

  const tvdbPromise: Promise<Candidate[]> = tvdbKeyAvailable
    ? new TVDBMetadata({ apiKey: input.tvdbApiKey })
        .searchSeries(baseTitle, input.signal)
        .then((results) =>
          results
            .filter(
              (r) =>
                normaliseTitle(stripTitleDisambiguators(r.name)) === normBase
            )
            .map((r) => ({
              title: r.name,
              year: r.year,
              country: r.country,
              tvdbId: r.tvdbId,
            }))
        )
        .catch((error) => {
          logger.debug(
            `TVDB conflict search failed, falling back to Skyhook: ${error}`
          );
          if (input.signal?.aborted) throw error;
          return skyhookSearch();
        })
    : skyhookSearch();

  const completed: Candidate[][] = [[], []];
  let failed = false;
  await Promise.all(
    [tmdbPromise, tvdbPromise].map((operation, index) =>
      untilAborted(
        operation
          .then((candidates) => {
            if (input.signal?.aborted) return candidates;
            completed[index] = candidates;
            input.onProgress?.(
              conflictsFromCandidates(completed.flat(), input)
            );
            return candidates;
          })
          .catch(() => {
            failed = true;
          }),
        input.signal
      )
    )
  );
  if (failed) throw new Error('Title conflict search unavailable');
  return conflictsFromCandidates(completed.flat(), input);
}

function conflictsFromCandidates(
  candidates: Candidate[],
  input: DetectConflictsInput
): TitleConflict[] {
  const providerIds = ['tmdbId', 'tvdbId'] as const;
  const isSelf = (candidate: Candidate) => {
    const comparable = providerIds.filter(
      (key) => candidate[key] != null && input[key] != null
    );
    return (
      comparable.length > 0 &&
      comparable.every((key) => candidate[key] === input[key])
    );
  };
  // Year/country agreement neither establishes self identity nor links two
  // providers. Keep their IDs separate unless a shared namespace identifies them.
  const byId = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    if (isSelf(candidate)) continue;
    const provider = providerIds.find(
      (key) => Number.isSafeInteger(candidate[key]) && candidate[key]! > 0
    );
    if (!provider) continue;
    const key = `${provider}:${candidate[provider]}`;
    const group = byId.get(key) ?? [];
    group.push(candidate);
    byId.set(key, group);
  }
  return [...byId.values()]
    .map((group) => {
      const years = new Set(
        group.flatMap((candidate) =>
          candidate.year === undefined ? [] : [candidate.year]
        )
      );
      const countries = new Set(
        group.flatMap((candidate) =>
          candidate.country === undefined ? [] : [candidate.country]
        )
      );
      return {
        ...group[0],
        year: years.size === 1 ? [...years][0] : undefined,
        country: countries.size === 1 ? [...countries][0] : undefined,
      };
    })
    .sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
}
