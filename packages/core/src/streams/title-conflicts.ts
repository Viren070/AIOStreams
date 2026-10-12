import pLimit, { type LimitFunction } from 'p-limit';
import { untilAborted } from '../utils/abort.js';
import {
  conflictEpisodeBound,
  type ConflictNumberingBounds,
} from './title-conflict-episodes.js';
import { SkyhookMetadata, type SkyhookShow } from '../metadata/skyhook.js';
import {
  detectTitleConflicts,
  stripTitleDisambiguators,
  type DetectConflictsInput,
} from '../metadata/conflicts.js';
import type { Metadata, TitleConflict } from '../metadata/utils.js';
import { normaliseTitle, titleMatch } from '../parser/utils.js';
import { normaliseCountryCode } from '../utils/countries.js';
import type { ParsedFile, ReleaseIds } from '../db/schemas.js';
import {
  matchesReleaseYear,
  type ReleaseYearOptions,
} from './year-matching.js';
import { languageToCode, normaliseLanguage } from '../utils/languages.js';
import {
  isEpisodeTitleLanguageTag,
  stripEpisodeTitleLabel,
} from '../parser/episode-title.js';

/** Language variants cannot distinguish country versions of the same language. */
const identityLanguage = (value: string | undefined): string | undefined => {
  const language = normaliseLanguage(value);
  return language
    ? languageToCode(language)?.toLowerCase().split('-')[0]
    : undefined;
};

/** Compare item IDs for contradictions; agreement alone cannot resolve a shared title. */
export function matchesReleaseIds(
  requested: ReleaseIds,
  release: ReleaseIds | undefined
): boolean | undefined {
  let matched = false;
  for (const key of ['imdbId', 'tvdbId'] as const) {
    if (requested[key] === undefined || release?.[key] === undefined) continue;
    if (requested[key] !== release[key]) return false;
    matched = true;
  }
  return matched ? true : undefined;
}

/** Only independently identified original dialogue tracks provide identity evidence. */
export function getOriginalAudioLanguage(
  file: ParsedFile | undefined
): string | undefined {
  if (!file || !['probe', 'indexer'].includes(file.mediaInfoQuality ?? ''))
    return undefined;
  const originals = file.audioTracks?.filter(
    (track) => track.original === true
  );
  if (
    !originals?.length ||
    originals.some(
      (track) =>
        track.dub ||
        track.commentary ||
        track.visualImpaired ||
        !identityLanguage(track.lang)
    )
  )
    return undefined;
  const languages = new Set(
    originals.map((track) => identityLanguage(track.lang)!)
  );
  return languages.size === 1 ? [...languages][0] : undefined;
}

/** Deduplicate validated provider reads within one evidence path. */
function conflictTraitReader<Input, Output>(
  normalise: (value: Input) => Output | undefined,
  limit = pLimit(3),
  pending = new Map<string, Promise<Output | undefined>>()
) {
  return (
    source: string,
    id: number | undefined,
    fetcher: ((id: number) => Promise<Input>) | undefined
  ) => {
    if (!fetcher || !Number.isSafeInteger(id) || id! <= 0)
      return Promise.resolve(undefined);
    const key = `${source}:${id}`;
    if (!pending.has(key))
      pending.set(
        key,
        limit(() => fetcher(id!))
          .then(normalise)
          .catch(() => undefined)
      );
    return pending.get(key)!;
  };
}

/** Provider disagreement, including conflicting duplicate mappings, remains unknown. */
async function collectConflictTraits<Input, Output>(
  conflicts: TitleConflict[],
  normalise: (value: Input) => Output | undefined,
  resolve: (
    conflict: TitleConflict,
    read: ReturnType<typeof conflictTraitReader<Input, Output>>
  ) => Promise<Output | undefined>,
  limit?: LimitFunction,
  pending?: Map<string, Promise<Output | undefined>>
) {
  const read = conflictTraitReader(normalise, limit, pending);
  const readings = new Map<number | string, Set<Output | undefined>>();
  await Promise.all(
    conflicts.map(async (conflict) => {
      const value = await resolve(conflict, read);
      const key = conflict.tvdbId ?? `tmdb:${conflict.tmdbId}`;
      const values = readings.get(key) ?? new Set<Output | undefined>();
      values.add(value);
      readings.set(key, values);
    })
  );
  const result = new Map<number | string, Output>();
  for (const [key, values] of readings)
    if (values.size === 1 && !values.has(undefined))
      result.set(key, [...values][0]!);
  return result;
}

/** Look up only competitors of releases with usable original-audio evidence. */
export async function getConflictOriginalLanguages(
  conflicts: TitleConflict[],
  getTvdbLanguage = async (id: number): Promise<string | undefined> => {
    const show = await new SkyhookMetadata().getShow(id);
    return show?.tvdbId === id
      ? (show.originalLanguage ?? undefined)
      : undefined;
  },
  getTvdbFallback?: (id: number) => Promise<string | undefined>,
  getTmdbLanguage?: (id: number) => Promise<string | undefined>,
  limit?: LimitFunction,
  pending?: Map<string, Promise<string | undefined>>
): Promise<Map<number | string, string>> {
  return collectConflictTraits(
    conflicts,
    identityLanguage,
    async (conflict, read) => {
      const tvdb =
        (await read('skyhook', conflict.tvdbId, getTvdbLanguage)) ??
        (await read('tvdb', conflict.tvdbId, getTvdbFallback));
      const tmdb = await read('tmdb', conflict.tmdbId, getTmdbLanguage);
      return !tvdb || !tmdb || tvdb === tmdb ? (tvdb ?? tmdb) : undefined;
    },
    limit,
    pending
  );
}

/** Missing or malformed genres cannot classify a competitor's medium. */
export function animationFromGenres(genres: unknown): boolean | undefined {
  if (
    !Array.isArray(genres) ||
    !genres.length ||
    !genres.every((genre) => typeof genre === 'string' && genre.trim())
  )
    return undefined;
  return genres.some((genre) =>
    ['animation', 'anime'].includes(genre.trim().toLowerCase())
  );
}

/** Read ID-validated show genres only for items explicitly indexed as animation. */
export async function getConflictAnimationTypes(
  conflicts: TitleConflict[],
  getTvdbGenres = async (id: number): Promise<string[] | undefined> => {
    const show = await new SkyhookMetadata().getShow(id);
    return show?.tvdbId === id ? (show.genres ?? undefined) : undefined;
  },
  getTmdbGenres?: (id: number) => Promise<string[] | undefined>,
  limit?: LimitFunction,
  pending?: Map<string, Promise<boolean | undefined>>
): Promise<Map<number | string, boolean>> {
  return collectConflictTraits(
    conflicts,
    animationFromGenres,
    async (conflict, read) => {
      const [tvdb, tmdb] = await Promise.all([
        read('skyhook', conflict.tvdbId, getTvdbGenres),
        read('tmdb', conflict.tmdbId, getTmdbGenres),
      ]);
      return tvdb === undefined || tmdb === undefined || tvdb === tmdb
        ? (tvdb ?? tmdb)
        : undefined;
    },
    limit,
    pending
  );
}

/** Use one normalized, disambiguator-free alias key throughout matching. */
export function titleConflictKey(title: string): string {
  return normaliseTitle(stripTitleDisambiguators(title));
}

/** Bare canonical names identify the unqualified country edition, not a same-country remake. */
export function titleCountryEvidence(
  metadata: Metadata,
  matchedTitle: string,
  country?: string
): string | undefined {
  if (country) return country;
  // Unqualified reality franchises use the canonical name for their home edition.
  // Fictional adaptations must retain remake checks even across countries.
  if (
    !Array.isArray(metadata.genres) ||
    !metadata.genres.some(
      (genre) =>
        typeof genre === 'string' && /^reality(?:[ -]?tv)?$/i.test(genre.trim())
    )
  )
    return undefined;
  // Strip only a display year: an explicit country qualifier must remain.
  const canonical = normaliseTitle(
    (metadata.title ?? '').replace(/\s*\(\d{4}\)\s*$/, '')
  );
  return titleConflictKey(matchedTitle) === canonical
    ? metadata.country
    : undefined;
}

/** Only look up known aliases actually used by returned releases. */
export async function getStreamTitleConflicts(
  metadata: Metadata,
  streamTitles: string[],
  auth: Pick<DetectConflictsInput, 'tmdbAuth' | 'tvdbApiKey'>,
  detect = detectTitleConflicts,
  options: {
    signal?: AbortSignal;
    unresolvedAliases?: Set<string>;
    onResolved?: (title: string, conflicts: TitleConflict[]) => void;
  } = {}
): Promise<Map<string, TitleConflict[]>> {
  const primary = titleConflictKey(metadata.title ?? '');
  const conflicts = new Map<string, TitleConflict[]>([
    [primary, metadata.titleConflicts ?? []],
  ]);
  const aliases = new Map(
    (metadata.titles ?? []).map(({ title }) => [titleConflictKey(title), title])
  );
  const aliasesToRead = [...new Set(streamTitles.map(titleConflictKey))].filter(
    (title) => title && title !== primary && aliases.has(title)
  );
  for (const title of aliasesToRead) options.unresolvedAliases?.add(title);
  if (metadata.titleConflictsUnavailable)
    options.unresolvedAliases?.add(primary);
  const limit = pLimit(3);
  await Promise.all(
    aliasesToRead.map((title) =>
      limit(async () => {
        if (options.signal?.aborted) return;
        const found = await untilAborted(
          detect({
            ...auth,
            title: aliases.get(title)!,
            year: metadata.year,
            country: metadata.country,
            tmdbId: metadata.tmdbId,
            tvdbId: metadata.tvdbId,
            signal: options.signal,
            onProgress: (partial) => {
              if (!options.signal?.aborted) conflicts.set(title, partial);
            },
          }).catch(() => undefined),
          options.signal
        );
        if (found !== undefined) {
          conflicts.set(title, found);
          if (!options.signal?.aborted) {
            options.unresolvedAliases?.delete(title);
            options.onResolved?.(title, found);
          }
        }
      })
    )
  );
  return conflicts;
}

/** Use the same finite upload age and request timestamp in both decision stages. */
export function releaseUploadYear(
  age: unknown,
  now: number
): number | undefined {
  if (typeof age !== 'number' || !Number.isFinite(age) || age < 0)
    return undefined;
  const year = new Date(now - age * 60 * 60 * 1000).getUTCFullYear();
  return Number.isSafeInteger(year) ? year : undefined;
}

/** Resolve shared titles using release evidence, retaining explicit contradictions. */
export function confirmsTitleIdentity(
  metadata: Metadata,
  conflicts: TitleConflict[],
  evidence: {
    /** Positive identity evidence only; Year Matching owns mismatch rejection. */
    year?: string | number;
    yearOptions?: ReleaseYearOptions;
    country?: string;
    episodeTitleMatches?: boolean;
    episodeTitle?: string;
    matchedEpisodeTitle?: string;
    episodeTitleThreshold?: number;
    /** Known competitor names can contradict an otherwise matching episode name. */
    conflictEpisodeTitles?: ReadonlyMap<number | string, string[]>;
    /** UTC year derived from a finite, nonnegative upload age. */
    uploadYear?: number;
    /** Lowest number in a request-matching episode batch. */
    episode?: number;
    season?: number;
    conflictNumberingBounds?: ReadonlyMap<
      number | string,
      ConflictNumberingBounds
    >;
    /** Independently reported original audio, never the inferred "Original" display label. */
    originalAudioLanguage?: string;
    conflictOriginalLanguages?: ReadonlyMap<number | string, string>;
    releaseMedium?: 'animation';
    conflictAnimationTypes?: ReadonlyMap<number | string, boolean>;
  }
): boolean {
  if (!conflicts.length) return true;

  const country = normaliseCountryCode(evidence.country);
  const requestedCountry = normaliseCountryCode(metadata.country);
  const countryMatches = !!country && country === requestedCountry;

  // A bounded range can identify an older box set, but not if it spans a
  // competing show's year. Reject malformed, open and reversed ranges.
  const years = /^(\d{4})(?:-(\d{4}))?$/.exec(String(evidence.year ?? ''));
  const startYear = years ? Number(years[1]) : undefined;
  const endYear = years ? Number(years[2] ?? years[1]) : undefined;
  const yearMatches =
    startYear !== undefined &&
    endYear !== undefined &&
    startYear <= endYear &&
    (metadata.year !== undefined || !!metadata.releaseYears?.length) &&
    matchesReleaseYear(metadata, evidence.year!, evidence.yearOptions);
  const tolerance = evidence.yearOptions?.tolerance ?? 1;
  const compatibleTags = !evidence.country || countryMatches;
  const episodeNames = [evidence.episodeTitle, evidence.matchedEpisodeTitle]
    .filter((name): name is string => !!name)
    .map(showIdentityEpisodeTitleKey);

  // Different evidence may exclude different competitors: CN + 2025 can
  // rule out both a CN series from 2020 and a TR series from 2025.
  return conflicts.every((conflict) => {
    const otherCountry = normaliseCountryCode(conflict.country);
    const conflictKey = conflict.tvdbId ?? `tmdb:${conflict.tmdbId}`;
    const competitorNames = evidence.conflictEpisodeTitles?.get(conflictKey);
    const episodeTitleDistinguishes =
      evidence.episodeTitleMatches === true &&
      !(
        competitorNames?.length &&
        episodeNames.some((name) =>
          titleMatch(name, competitorNames, {
            threshold: evidence.episodeTitleThreshold ?? 0.8,
          })
        )
      );
    const bounds = evidence.conflictNumberingBounds?.get(conflictKey);
    const originalLanguage = identityLanguage(evidence.originalAudioLanguage);
    const requestedLanguage = identityLanguage(metadata.originalLanguage);
    const otherLanguage = identityLanguage(
      evidence.conflictOriginalLanguages?.get(
        conflict.tvdbId ?? `tmdb:${conflict.tmdbId}`
      )
    );
    const originalAudioDistinguishes =
      !!originalLanguage &&
      originalLanguage === requestedLanguage &&
      !!otherLanguage &&
      otherLanguage !== originalLanguage &&
      compatibleTags;
    const animationDistinguishes =
      evidence.releaseMedium === 'animation' &&
      animationFromGenres(metadata.genres) === true &&
      evidence.conflictAnimationTypes?.get(
        conflict.tvdbId ?? `tmdb:${conflict.tmdbId}`
      ) === false &&
      compatibleTags;
    // Uploads from before a remake existed can identify the older series.
    // Leave a full calendar-year margin and require the requested show to exist.
    // Country contradictions remain title evidence; Year Matching owns year rejection.
    const predatesCompetitor =
      compatibleTags &&
      Number.isSafeInteger(evidence.uploadYear) &&
      Number.isSafeInteger(metadata.year) &&
      metadata.year! >= 1800 &&
      Number.isSafeInteger(conflict.year) &&
      evidence.uploadYear! >= metadata.year! &&
      evidence.uploadYear! < conflict.year! - 1;
    return (
      episodeTitleDistinguishes ||
      originalAudioDistinguishes ||
      animationDistinguishes ||
      predatesCompetitor ||
      (compatibleTags &&
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
        (conflict.year < startYear! - tolerance ||
          conflict.year > endYear! + tolerance))
    );
  });
}

/** Remove numbered presentation labels, never a bare label or the episode name. */
export function showIdentityEpisodeTitleKey(title: string): string {
  return normaliseTitle(stripEpisodeTitleLabel(title));
}

/** Presentation and language labels do not identify an episode's show. */
export function isGenericEpisodeTitle(title: string | undefined): boolean {
  if (!title || isEpisodeTitleLanguageTag(title)) return true;
  const normalized = showIdentityEpisodeTitleKey(title);
  return (
    !normalized ||
    /^(?:episode|ep|chapter|part|day|week|session|season|special|ova|oad|pilot|finale|premiere|tba|tbd|untitled)(?:[0-9ivxlcdm]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)$/.test(
      normalized
    )
  );
}

/** Catalog-wide name recovery needs a substantial name, beyond a generic label. */
export function isDistinctiveEpisodeTitle(title: string | undefined): boolean {
  return (
    !isGenericEpisodeTitle(title) &&
    showIdentityEpisodeTitleKey(title!).length >= 8
  );
}

/**
 * A distinctive episode name can identify the SHOW even when providers disagree
 * on episode ordering. This does not establish which episode was requested and
 * never supplies titles to the separate episode-title/numbering filters.
 * Missing or incomplete catalogs cannot prove absence. Known competitor names
 * can still prevent an episode-name match from proving identity by itself.
 * Evaluation uses completed catalogues and cannot start provider reads.
 */
export function analyseShowIdentityEpisodeTitles(
  metadata: Metadata,
  conflicts: ReadonlyMap<string, TitleConflict[]>,
  catalogues: ReadonlyMap<number, SkyhookShow | null>,
  canProveAbsence?: (show: SkyhookShow, conflict: TitleConflict) => boolean
) {
  const episodeTitles = new Map<string, Set<string>>();
  const conflictEpisodeTitles = new Map<number | string, string[]>();
  const result = { episodeTitles, conflictEpisodeTitles };
  const requested = metadata.tvdbId ? catalogues.get(metadata.tvdbId) : null;
  // Presence in any ID-validated catalog is useful negative evidence even
  // when the catalog is ongoing or incomplete. Absence needs a complete one.
  const aliases = [...conflicts].map(([alias, competitors]) => ({
    alias,
    competitors,
    shows: competitors.map((c) =>
      c.tvdbId ? (catalogues.get(c.tvdbId) ?? null) : null
    ),
  }));
  // Reuse explicit mappings from ID-validated catalogues, never year/country.
  // Multiple TVDB IDs claiming one TMDB ID cannot prove catalogue absence.
  const mappedShows = new Map<
    number,
    Map<number, NonNullable<typeof requested>>
  >();
  const observeMapping = (show: typeof requested, tvdbId?: number | null) => {
    if (!show || show.tvdbId !== tvdbId) return;
    if (show.tmdbId && Number.isSafeInteger(show.tmdbId) && show.tmdbId > 0) {
      const mapped = mappedShows.get(show.tmdbId) ?? new Map();
      mapped.set(show.tvdbId, show);
      mappedShows.set(show.tmdbId, mapped);
    }
  };
  observeMapping(requested, metadata.tvdbId);
  for (const { competitors, shows } of aliases) {
    shows.forEach((show, i) => observeMapping(show, competitors[i].tvdbId));
  }
  for (const group of aliases) {
    group.shows = group.competitors.map((competitor, i) => {
      const candidates = competitor.tvdbId
        ? [group.shows[i]].filter((show) => show?.tvdbId === competitor.tvdbId)
        : [...(mappedShows.get(competitor.tmdbId!)?.values() ?? [])];
      const key = competitor.tvdbId ?? `tmdb:${competitor.tmdbId}`;
      // Even incomplete/ambiguous catalogues retain useful negative evidence.
      if (candidates.length)
        conflictEpisodeTitles.set(key, [
          ...new Set(
            candidates.flatMap((show) =>
              (show?.episodes ?? [])
                .filter((e) => e.title?.trim())
                .map((e) => showIdentityEpisodeTitleKey(e.title!))
            )
          ),
        ]);
      const show = candidates.length === 1 ? candidates[0] : null;
      return show &&
        (!competitor.tmdbId ||
          (competitor.tvdbId && show.tmdbId == null) ||
          show.tmdbId === competitor.tmdbId)
        ? show
        : null;
    });
  }
  if (!requested || requested.tvdbId !== metadata.tvdbId) return result;
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
  for (const { alias, competitors, shows } of aliases) {
    if (
      !competitors.length ||
      shows.some(
        (show, i) =>
          !show ||
          conflictEpisodeBound(show!) === undefined ||
          show!.episodes!.some((e) => !e.title?.trim()) ||
          canProveAbsence?.(show!, competitors[i]) === false
      )
    )
      continue;
    const otherNames = new Set(
      shows.flatMap((show) =>
        show!.episodes!.map((e) => showIdentityEpisodeTitleKey(e.title!))
      )
    );
    episodeTitles.set(
      alias,
      new Set([...names].filter((name) => !otherNames.has(name)))
    );
  }
  return result;
}
