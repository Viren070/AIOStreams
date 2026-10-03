import pLimit from 'p-limit';
import type { ParsedStream } from '../db/schemas.js';
import type { Metadata, TitleConflict } from '../metadata/utils.js';
import { SkyhookMetadata } from '../metadata/skyhook.js';
import { TMDBMetadata } from '../metadata/tmdb.js';
import { TVDBMetadata } from '../metadata/tvdb.js';
import { untilAborted } from '../utils/abort.js';
import { appConfig } from '../utils/index.js';
import {
  getConflictNumberingBounds,
  type ConflictNumberingBounds,
  type ConflictNumberingLookup,
} from './title-conflict-episodes.js';
import {
  animationFromGenres,
  confirmsTitleIdentity,
  getConflictAnimationTypes,
  getConflictOriginalLanguages,
  getOriginalAudioLanguage,
  getShowIdentityEpisodeTitles,
  isGenericEpisodeTitle,
  releaseUploadYear,
} from './title-conflicts.js';

/** Construct each configured metadata client once for this evidence resolution. */
function createConflictClients(auth: {
  tvdbApiKey?: string;
  tmdbApiKey?: string;
  tmdbAccessToken?: string;
}) {
  const tvdbKey = auth.tvdbApiKey || appConfig.metadata.tvdb.apiKey;
  const tmdbAvailable =
    auth.tmdbApiKey ||
    auth.tmdbAccessToken ||
    appConfig.metadata.tmdb.apiKey ||
    appConfig.metadata.tmdb.accessToken;
  return {
    skyhook: new SkyhookMetadata(),
    tvdb: tvdbKey ? new TVDBMetadata({ apiKey: tvdbKey }) : undefined,
    tmdb: tmdbAvailable
      ? new TMDBMetadata({
          apiKey: auth.tmdbApiKey,
          accessToken: auth.tmdbAccessToken,
        })
      : undefined,
  };
}

/** Alias discovery and detail enrichment share the same cancellation deadline. */
export function createConflictLookupBudget(
  budgetMs = 5000,
  parent?: AbortSignal
) {
  const controller = new AbortController();
  const signal = parent
    ? AbortSignal.any([parent, controller.signal])
    : controller.signal;
  const timer = parent
    ? undefined
    : setTimeout(
        () => controller.abort(),
        Math.max(0, Math.min(budgetMs, 5000))
      );
  return {
    signal,
    finish() {
      controller.abort();
      clearTimeout(timer);
    },
  };
}

/**
 * Resolve only useful competitor details, independently of sibling releases.
 * Alias discovery and details share a five-second budget; failed data stays
 * unknown. Requests are aborted and queued page/season work cannot continue.
 */
export async function resolveConflictEvidence(args: {
  metadata?: Metadata;
  streams: ParsedStream[];
  titleConflicts: ReadonlyMap<string, TitleConflict[]>;
  titleKey: (stream: ParsedStream) => string;
  releaseEpisode: (stream: ParsedStream) => number | undefined;
  releaseSeason: (stream: ParsedStream) => number | undefined;
  /** ID-resolved releases retain ordinary matching without competitor lookups. */
  hasIdMatch?: (stream: ParsedStream) => boolean;
  addons?: string[];
  auth: {
    tvdbApiKey?: string;
    tmdbApiKey?: string;
    tmdbAccessToken?: string;
  };
  /** Override the budget for tests; production never exceeds five seconds. */
  budgetMs?: number;
  signal?: AbortSignal;
  /** Completed aliases can start detail work while other searches are pending. */
  discoverConflicts?: (
    onResolved: (title: string, conflicts: TitleConflict[]) => void,
    signal: AbortSignal
  ) => Promise<ReadonlyMap<string, TitleConflict[]>>;
  now?: number;
}) {
  const emptyEvidence = {
    numberingBounds: new Map<number | string, ConflictNumberingBounds>(),
    episodeTitles: new Map<string, Set<string>>(),
    conflictEpisodeTitles: new Map<number | string, string[]>(),
    originalLanguages: new Map<number | string, string>(),
    animationTypes: new Map<number | string, boolean>(),
  };
  const clients = createConflictClients(args.auth);
  const now = args.now ?? Date.now();
  const budget = createConflictLookupBudget(args.budgetMs, args.signal);
  const signal = budget.signal;
  const pending = new Map<string, Promise<unknown>>();
  // Keep each evidence path's existing limit across primary and alias batches.
  const numberingLimit = pLimit(3);
  const languageLimit = pLimit(3);
  const animationLimit = pLimit(3);
  const episodeTitleLimit = pLimit(3);
  const languageReads = new Map<string, Promise<string | undefined>>();
  const animationReads = new Map<string, Promise<boolean | undefined>>();
  const numberingJobs = new Map<
    string,
    {
      episodeSeason: number;
      promise: Promise<ConflictNumberingBounds | undefined>;
    }
  >();
  const lookupNumbering: ConflictNumberingLookup = async (
    conflict,
    season,
    fetch
  ) => {
    // Include both provider IDs: inconsistent mappings must not share a job.
    const key = `${conflict.tvdbId ?? ''}:${conflict.tmdbId ?? ''}`;
    const previous = numberingJobs.get(key);
    if (previous) {
      const bound = await previous.promise;
      if (
        previous.episodeSeason <= season ||
        bound?.episode !== undefined ||
        (bound && season > bound.season)
      )
        return bound;
      // Wait outside the limiter, then share any stronger job another alias
      // has already scheduled. A pack-only read must not block episode needs.
      if (numberingJobs.get(key) !== previous)
        return lookupNumbering(conflict, season, fetch);
    }
    const job = { episodeSeason: season, promise: numberingLimit(fetch) };
    numberingJobs.set(key, job);
    return job.promise;
  };
  const read = <T>(
    key: string,
    fetch: () => Promise<T>
  ): Promise<T | undefined> => {
    if (!pending.has(key) && signal.aborted) return Promise.resolve(undefined);
    if (!pending.has(key))
      pending.set(
        key,
        untilAborted(
          Promise.resolve()
            .then(() => (signal.aborted ? undefined : fetch()))
            .catch(() => undefined),
          signal
        )
      );
    return pending.get(key)! as Promise<T | undefined>;
  };
  const getShow = async (id: number) =>
    (await read(`skyhook:${id}`, () => clients.skyhook.getShow(id, signal))) ??
    null;
  const episodeTitleReads = new Map<number, ReturnType<typeof getShow>>();
  const resolveBatch = async (
    titleConflicts: ReadonlyMap<string, TitleConflict[]>
  ) => {
    if (![...titleConflicts.values()].some((conflicts) => conflicts.length))
      return emptyEvidence;

    const episodeConflicts: TitleConflict[] = [];
    const episodeSeasons = new Map<number | string, number>();
    const audioConflicts: TitleConflict[] = [];
    const animationConflicts: TitleConflict[] = [];
    const namedAliases = new Map<string, TitleConflict[]>();
    for (const stream of args.streams) {
      if (
        !stream.filename ||
        !stream.parsedFile?.title ||
        (args.addons?.length &&
          !args.addons.includes(stream.addon?.preset?.id ?? ''))
      )
        continue;
      const key = args.titleKey(stream);
      const conflicts = titleConflicts.get(key);
      if (!conflicts?.length) continue;
      if (args.hasIdMatch?.(stream)) continue;
      // Avoid extra lookups when release tags already distinguish every show.
      // Shared but consistent tags still leave the other evidence paths open.
      if (
        args.metadata &&
        confirmsTitleIdentity(args.metadata, conflicts, {
          year: stream.parsedFile.year,
          country: stream.parsedFile.country,
          releaseYear: stream.releaseYear,
          uploadYear: releaseUploadYear(stream.age, now),
        })
      )
        continue;
      if (
        (args.releaseEpisode(stream) ?? 0) > 1 ||
        (args.releaseSeason(stream) ?? 0) > 1
      )
        episodeConflicts.push(...conflicts);
      if ((args.releaseEpisode(stream) ?? 0) > 1)
        for (const conflict of conflicts) {
          const key = conflict.tvdbId ?? `tmdb:${conflict.tmdbId}`;
          // Every episode-bearing release must have a conclusive season before
          // its competitor's full episode catalog can be skipped.
          episodeSeasons.set(
            key,
            Math.min(
              episodeSeasons.get(key) ?? Infinity,
              args.releaseSeason(stream) ?? 0
            )
          );
        }
      if (!isGenericEpisodeTitle(stream.parsedFile.episodeTitle))
        namedAliases.set(key, conflicts);
      if (
        args.metadata?.originalLanguage &&
        getOriginalAudioLanguage(stream.parsedFile)
      )
        audioConflicts.push(...conflicts);
      if (
        stream.releaseMedium === 'animation' &&
        animationFromGenres(args.metadata?.genres) === true
      )
        animationConflicts.push(...conflicts);
    }

    if (
      !episodeConflicts.length &&
      !namedAliases.size &&
      !audioConflicts.length &&
      !animationConflicts.length
    )
      return emptyEvidence;
    const [numberingBounds, titleEvidence, originalLanguages, animationTypes] =
      await Promise.all([
        getConflictNumberingBounds(
          episodeConflicts,
          getShow,
          clients.tvdb
            ? (id, includeEpisodes) =>
                includeEpisodes
                  ? read(`tvdb:catalog:${id}`, () =>
                      clients.tvdb!.getEpisodeCatalog(id, signal)
                    )
                  : read(`tvdb:status:${id}`, async () => ({
                      tvdbId: id,
                      status: await clients.tvdb!.getSeriesStatus(id, signal),
                    }))
            : undefined,
          clients.tmdb
            ? (id) =>
                read(`tmdb:catalog:${id}`, () =>
                  clients.tmdb!.getEpisodeCatalog(id, signal)
                )
            : undefined,
          clients.tmdb
            ? (id) =>
                read(`tmdb:bound:${id}`, () =>
                  clients.tmdb!.getSeasonBound(id, signal)
                )
            : undefined,
          episodeSeasons,
          lookupNumbering
        ),
        args.metadata
          ? getShowIdentityEpisodeTitles(
              args.metadata,
              namedAliases,
              getShow,
              episodeTitleLimit,
              episodeTitleReads
            )
          : Promise.resolve({
              episodeTitles: emptyEvidence.episodeTitles,
              conflictEpisodeTitles: emptyEvidence.conflictEpisodeTitles,
            }),
        getConflictOriginalLanguages(
          audioConflicts,
          async (id) => {
            const show = await getShow(id);
            return show?.tvdbId === id
              ? (show.originalLanguage ?? undefined)
              : undefined;
          },
          clients.tvdb
            ? (id) =>
                read(`tvdb:language:${id}`, () =>
                  clients.tvdb!.getOriginalLanguage(id, signal)
                )
            : undefined,
          clients.tmdb
            ? (id) =>
                read(`tmdb:language:${id}`, () =>
                  clients.tmdb!.getOriginalLanguage(id, signal)
                )
            : undefined,
          languageLimit,
          languageReads
        ),
        getConflictAnimationTypes(
          animationConflicts,
          async (id) => {
            const show = await getShow(id);
            return show?.tvdbId === id ? (show.genres ?? undefined) : undefined;
          },
          clients.tmdb
            ? (id) =>
                read(`tmdb:genres:${id}`, () =>
                  clients.tmdb!.getGenres(id, signal)
                )
            : undefined,
          animationLimit,
          animationReads
        ),
      ]);
    return {
      numberingBounds,
      ...titleEvidence,
      originalLanguages,
      animationTypes,
    };
  };
  const reconcileNumbering = (
    evidence: typeof emptyEvidence,
    conflicts: ReadonlyMap<string, TitleConflict[]>
  ) => {
    for (const group of conflicts.values())
      for (const conflict of group)
        if (
          (conflict.tvdbId &&
            clients.tvdb?.hasObservedNumberingContradiction(conflict.tvdbId)) ||
          (conflict.tmdbId &&
            clients.tmdb?.hasObservedNumberingContradiction(conflict.tmdbId))
        )
          evidence.numberingBounds.delete(
            conflict.tvdbId ?? `tmdb:${conflict.tmdbId}`
          );
        else if (conflict.tmdbId) {
          const key = conflict.tvdbId ?? `tmdb:${conflict.tmdbId}`;
          const bound = evidence.numberingBounds.get(key);
          const observed = clients.tmdb?.getObservedNumberingBounds(
            conflict.tmdbId
          );
          if (bound && observed) {
            // Larger validated counts contradict a smaller memoized upper
            // bound. Never create episode proof from a show summary alone.
            if (
              observed.season > bound.season ||
              (bound.episode !== undefined &&
                observed.episode !== undefined &&
                observed.episode > bound.episode)
            )
              delete bound.episode;
            bound.season = Math.max(bound.season, observed.season);
          }
        }
    return evidence;
  };
  try {
    const jobs = [resolveBatch(args.titleConflicts)];
    if (!args.discoverConflicts)
      return reconcileNumbering(await jobs[0], args.titleConflicts);
    const conflicts = await args.discoverConflicts((title, found) => {
      jobs.push(resolveBatch(new Map([[title, found]])));
    }, signal);
    await Promise.all(jobs);
    // Reconcile all aliases together using the same completed reads, including
    // after expiry. This retains cross-provider contradictions and mixed needs.
    return reconcileNumbering(await resolveBatch(conflicts), conflicts);
  } finally {
    budget.finish();
  }
}
