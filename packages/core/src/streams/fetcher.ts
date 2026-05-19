import { Addon, ParsedStream, UserData } from '../db/schemas.js';
import {
  constants,
  createLogger,
  getAddonName,
  getTimeTakenSincePoint,
} from '../utils/index.js';
import { Wrapper } from '../main/wrapper.js';
import {
  ExitConditionEvaluator,
  GroupConditionEvaluator,
} from '../parser/streamExpression.js';
import StreamFilter from './filterer.js';
import StreamPrecompute from './precomputer.js';
import StreamDeduplicator from './deduplicator.js';
import { StreamContext } from './context.js';
import {
  classifyAddonError,
  type AnalyticsDisposition,
  type AnalyticsErrorKind,
  type AnalyticsStatus,
} from '../analytics/index.js';

/**
 * Per-addon outcome tracked through {@link StreamFetcher.fetch} and surfaced
 * to `resources.ts` so the per-user `addon_contribution` event can attribute
 * post-pipeline results back to the right addon.
 *
 * Keyed by `manifestUrl` because (a) the wrapper already hashes that for
 * `addon_instance_hash`, giving a consistent identity for joins, and
 * (b) `ParsedStream.addon.manifestUrl` survives all pipeline steps so the
 * caller can recover the addon from any surviving stream without a separate
 * lookup.
 */
export interface AddonDispositionInfo {
  addon: Addon;
  disposition: AnalyticsDisposition;
  rawCount: number;
  latencyMs: number;
  status: AnalyticsStatus;
  errorKind?: AnalyticsErrorKind;
}

export type AddonDispositionMap = Map<string, AddonDispositionInfo>;

const logger = createLogger('fetcher');

class StreamFetcher {
  private userData: UserData;
  private filter: StreamFilter;
  private precompute: StreamPrecompute;
  private deduplicate: StreamDeduplicator;
  constructor(
    userData: UserData,
    filter: StreamFilter,
    precompute: StreamPrecompute
  ) {
    this.userData = userData;
    this.filter = filter;
    this.precompute = precompute;
    this.deduplicate = new StreamDeduplicator(userData);
  }

  public async fetch(
    addons: Addon[],
    context: StreamContext
  ): Promise<{
    streams: ParsedStream[];
    errors: {
      title?: string;
      description?: string;
    }[];
    statistics: {
      title: string;
      description: string;
    }[];
    /** Per-addon outcome map used by per-user analytics. */
    dispositions: AddonDispositionMap;
  }> {
    const { type, id, queryType } = context;

    context.startAllFetches();

    const allErrors: {
      title: string;
      description: string;
    }[] = [];
    const allStatisticStreams: {
      title: string;
      description: string;
    }[] = [];
    let allStreams: ParsedStream[] = [];
    const start = Date.now();

    // Seed every input addon with `not_started` so anything filtered out (or
    // never reached on the dynamic path) is attributable to a disposition.
    const dispositions: AddonDispositionMap = new Map();
    for (const a of addons) {
      dispositions.set(a.manifestUrl, {
        addon: a,
        disposition: 'not_started',
        rawCount: 0,
        latencyMs: 0,
        status: 'ok',
      });
    }

    addons = addons.filter((addon) => {
      if (
        addon.mediaTypes &&
        addon.mediaTypes.length > 0 &&
        ['movie', 'series', 'anime.series', 'anime.movie'].includes(queryType)
      ) {
        let mappedType = queryType;
        if (queryType === 'anime.series' || queryType === 'anime.movie') {
          mappedType = 'anime';
        }
        const result = addon.mediaTypes.includes(
          mappedType as 'movie' | 'series' | 'anime'
        );
        if (!result) {
          logger.debug(
            { addon: getAddonName(addon), type: mappedType },
            'skipping addon due to media type restriction'
          );
        }
        return result;
      }
      return true;
    });

    // Helper function to fetch streams from an addon and log summary
    const fetchFromAddon = async (addon: Addon) => {
      const start = Date.now();

      try {
        const streams = await new Wrapper(addon).getStreams(type, id);
        const errorStreams = streams.filter(
          (s) => s.type === constants.ERROR_STREAM_TYPE
        );
        const addonErrors = errorStreams.map((s) => ({
          title: `[❌] ${s.error?.title || getAddonName(addon)}`,
          description: s.error?.description || 'Unknown error',
        }));
        const usableStreams = streams.filter(
          (s) => s.type !== constants.ERROR_STREAM_TYPE
        );
        const latencyMs = Date.now() - start;
        const status: AnalyticsStatus =
          errorStreams.length > 0 && usableStreams.length === 0
            ? 'error'
            : usableStreams.length === 0
              ? 'empty'
              : 'ok';
        // Mark as merged optimistically — the dynamic path will downgrade to
        // `cut_off` for addons that completed after the exit condition fired
        // (their results are discarded from `finalStreams`).
        dispositions.set(addon.manifestUrl, {
          addon,
          disposition: 'merged',
          rawCount: usableStreams.length,
          latencyMs,
          status,
        });

        if (errorStreams.length > 0) {
          logger.warn(
            {
              addon: getAddonName(addon),
              errors: errorStreams.length,
              titles: errorStreams.map((s) => s.error?.title),
            },
            'addon returned error streams'
          );
        }

        const statisticStream = {
          title: `${errorStreams.length > 0 ? '🟠' : '🟢'} [${getAddonName(addon)}] Scrape Summary`,
          description: `✔ Status      : ${errorStreams.length > 0 ? 'PARTIAL SUCCESS' : 'SUCCESS'}
📦 Streams    : ${streams.length}
📋 Details    : ${
            errorStreams.length > 0
              ? `Fetched streams with errors:\n${errorStreams.map((s) => `    • ${s.error?.title || 'Unknown error'}: ${s.error?.description || 'No description'}`).join('\n')}`
              : 'Successfully fetched streams.'
          }
⏱️ Time       : ${getTimeTakenSincePoint(start)}
`,
        };

        logger.debug(
          {
            addon: getAddonName(addon),
            streams: usableStreams.length,
            errors: errorStreams.length,
            took: latencyMs,
          },
          'addon fetch complete'
        );
        return {
          success: true as const,
          streams: usableStreams,
          errors: addonErrors,
          statistic: statisticStream,
          timeTaken: latencyMs,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const addonErrors = {
          title: `[❌] ${getAddonName(addon)}`,
          description: errMsg,
        };
        const { error_kind } = classifyAddonError('stream', error);
        const took = Date.now() - start;
        dispositions.set(addon.manifestUrl, {
          addon,
          disposition: 'error',
          rawCount: 0,
          latencyMs: took,
          status: 'error',
          errorKind: error_kind,
        });
        logger.warn(
          { addon: getAddonName(addon), err: errMsg, took },
          'addon fetch failed'
        );
        return {
          success: false as const,
          errors: [addonErrors],
          timeTaken: 0,
          streams: [],
        };
      }
    };

    // Helper function to fetch from a group of addons and track time
    const fetchAndProcessAddons = async (addons: Addon[]) => {
      const groupStart = Date.now();
      const results = await Promise.all(addons.map(fetchFromAddon));

      const groupStreams = results.flatMap((r) => r.streams);
      const groupErrors = results.flatMap((r) => r.errors);
      const groupStatistics = results
        .flatMap((r) => r.statistic)
        .filter((s) => s !== undefined);

      // Run SeaDex precompute BEFORE filter so seadex() works in Included SEL
      // Now uses context's cached SeaDex data when available
      await this.precompute.precomputeSeaDexOnly(groupStreams, context);

      const filteredStreams = await this.deduplicate.deduplicate(
        await this.filter.filter(groupStreams, context)
      );

      // Run preferred matching AFTER filter
      await this.precompute.precomputePreferred(filteredStreams, context);

      logger.debug(
        { count: filteredStreams.length, took: Date.now() - groupStart },
        'group fetch complete'
      );
      return {
        totalTime: Date.now() - groupStart,
        streams: filteredStreams,
        statistics: groupStatistics,
        errors: groupErrors,
      };
    };

    // If groups are configured, handle group-based fetching
    if (this.userData.dynamicAddonFetching?.enabled) {
      const condition = this.userData.dynamicAddonFetching.condition;
      if (!condition) {
        throw new Error('Dynamic addon fetching condition is not set');
      }
      // parse a condition and look for totalTimeTaken\s?((>|<|=)(=)?)\d
      // and return the times
      const extractTimes = (condition: string): number[] => {
        const times = new Set<number>();
        // Match patterns like: totalTimeTaken > 5000, totalTimeTaken >= 1000, totalTimeTaken < 3000, etc.
        const regex = /totalTimeTaken\s*(?:>|<|=|>=|<=|==|!=)\s*(\d+)/g;
        let match;

        while ((match = regex.exec(condition)) !== null) {
          const timeValue = parseInt(match[1], 10);
          times.add(timeValue);
        }

        // Also check for reverse patterns: 5000 > totalTimeTaken, etc.
        const reverseRegex = /(\d+)\s*(?:>|<|=|>=|<=|==|!=)\s*totalTimeTaken/g;
        while ((match = reverseRegex.exec(condition)) !== null) {
          const timeValue = parseInt(match[1], 10);
          times.add(timeValue);
        }

        return Array.from(times).sort((a, b) => a - b);
      };

      const checkpointTimes = extractTimes(condition);
      if (checkpointTimes.length > 0) {
        logger.debug(
          { checkpoints: checkpointTimes, count: checkpointTimes.length },
          'extracted exit condition checkpoints'
        );
      }

      await new Promise<void>((resolve) => {
        let addonFetchStartTime: number = 0;
        const queriedAddons: string[] = [];
        const allAddons: string[] = Array.from(
          new Set(addons.map((addon) => addon.name))
        );
        const presetProgress = addons.reduce(
          (acc, addon) => {
            const id = addon.preset.id;
            const name = addon.name;
            if (!acc[id]) {
              acc[id] = { name, remaining: 0 };
            }
            acc[id].remaining++;
            return acc;
          },
          {} as Record<string, { name: string; remaining: number }>
        );

        let activePromises = addons.length;
        let resolved: boolean = false;
        let checkingPromise: Promise<void> | null = null;
        const timeouts: NodeJS.Timeout[] = [];
        if (activePromises === 0) {
          resolve();
          return;
        }

        const doResolve = (stillFetching: number) => {
          if (resolved) return;
          resolved = true;
          timeouts.forEach(clearTimeout);
          // Any addon whose disposition is still `not_started` at this point
          // never returned a result before we tripped the exit condition;
          // tag it as cut_off. (Addons that did complete before exit are
          // already `merged`/`error` in the map; we leave those alone.)
          for (const [key, info] of dispositions) {
            if (info.disposition === 'not_started') {
              dispositions.set(key, { ...info, disposition: 'cut_off' });
            }
          }
          logger.debug(
            { queried: queriedAddons.length, stillFetching },
            'exit condition met, returning results'
          );
          resolve();
        };

        const checkExit = async (fromAddonCompletion: boolean) => {
          if (resolved) return;
          // If already checking, wait for that check to complete instead of skipping
          if (checkingPromise) {
            await checkingPromise;
            return;
          }

          checkingPromise = (async () => {
            try {
              if (resolved) return;
              const timeTaken = Date.now() - start;
              // Take a snapshot of current streams for evaluation
              const streamsSnapshot = [...allStreams];
              const evaluator = new ExitConditionEvaluator(
                await this.deduplicate.deduplicate(streamsSnapshot),
                timeTaken,
                queryType,
                [...queriedAddons],
                allAddons
              );

              const shouldExit = await evaluator.evaluate(condition);
              logger.debug(
                { shouldExit, queried: queriedAddons.length },
                'evaluated exit condition'
              );
              if (shouldExit && !resolved) {
                // If triggered by addon completion, that addon hasn't decremented activePromises yet
                const stillFetching = fromAddonCompletion
                  ? activePromises - 1
                  : activePromises;
                doResolve(stillFetching);
              }
            } finally {
              checkingPromise = null;
            }
          })();

          await checkingPromise;
        };

        checkpointTimes.forEach((checkpointTime) => {
          const timeout = setTimeout(() => {
            if (!resolved) {
              logger.debug(
                {
                  checkpoint: checkpointTime,
                  timeTaken: Math.round(
                    performance.now() - addonFetchStartTime
                  ),
                },
                'scheduled exit condition checkpoint reached'
              );
              checkExit(false);
            }
          }, checkpointTime + 50);
          timeouts.push(timeout);
        });

        addonFetchStartTime = performance.now();
        addons.forEach((addon) => {
          fetchAndProcessAddons([addon])
            .then(async (result) => {
              if (resolved) return;
              const progress = presetProgress[addon.preset.id];
              progress.remaining--;
              if (progress.remaining === 0) {
                logger.debug(
                  { preset: progress.name, presetId: addon.preset.id },
                  'all addons from preset completed, marking as queried'
                );
                queriedAddons.push(addon.name);
              }

              allStreams.push(...result.streams);
              allErrors.push(...result.errors);
              if (result.statistics) {
                allStatisticStreams.push(...result.statistics);
              }
              await checkExit(true);
            })
            .catch((error) => {
              if (resolved) return;
              logger.error(
                {
                  addon: getAddonName(addon),
                  err: error instanceof Error ? error.message : String(error),
                },
                'unhandled error fetching from addon'
              );
              allErrors.push({
                title: `[❌] ${getAddonName(addon)}`,
                description:
                  error instanceof Error ? error.message : String(error),
              });
            })
            .finally(() => {
              activePromises--;
              if (activePromises === 0 && !resolved) {
                logger.debug(
                  { count: addons.length },
                  'all addons finished fetching'
                );
                resolved = true;
                timeouts.forEach(clearTimeout);
                resolve();
              }
            });
        });
      });
    } else if (
      this.userData.groups?.groupings &&
      this.userData.groups.groupings.length > 0 &&
      this.userData.groups.enabled !== false
    ) {
      // add addons that are not assigned to any group to the first group
      const unassignedAddons = addons.filter(
        (addon) =>
          !this.userData.groups?.groupings?.some((group) =>
            group.addons.includes(addon.preset.id)
          )
      );
      if (unassignedAddons.length > 0 && this.userData.groups.groupings[0]) {
        this.userData.groups.groupings[0].addons.push(
          ...unassignedAddons.map((addon) => addon.preset.id)
        );
      }

      const behaviour = this.userData.groups.behaviour || 'parallel';
      let totalTimeTaken = 0;
      let previousGroupStreams: ParsedStream[] = [];
      let previousGroupTimeTaken = 0;

      if (behaviour === 'parallel') {
        // Fetch all groups in parallel but still evaluate conditions
        const groupPromises = this.userData.groups.groupings.map((group, i) => {
          const groupAddons = addons.filter(
            (addon) => addon.preset.id && group.addons.includes(addon.preset.id)
          );
          if (groupAddons.length === 0) return Promise.resolve(null);
          logger.debug(
            { group: i + 1, addons: groupAddons.length },
            'queuing parallel group fetch'
          );
          return fetchAndProcessAddons(groupAddons);
        });

        for (let i = 0; i < this.userData.groups.groupings.length; i++) {
          const groupPromise = groupPromises[i];

          if (i === 0) {
            const groupResult = await groupPromise;
            if (!groupResult) continue;
            allStreams.push(...groupResult.streams);
            allErrors.push(...groupResult.errors);
            allStatisticStreams.push(...groupResult.statistics);
            totalTimeTaken = groupResult.totalTime;
            previousGroupStreams = groupResult.streams;
            previousGroupTimeTaken = groupResult.totalTime;
            continue;
          }
          // For groups other than the first, check their condition
          const group = this.userData.groups.groupings[i];
          if (!group.condition || !group.addons.length) continue;

          const evaluator = new GroupConditionEvaluator(
            previousGroupStreams,
            allStreams,
            previousGroupTimeTaken,
            totalTimeTaken,
            queryType
          );
          const shouldIncludeAndContinue = await evaluator.evaluate(
            group.condition
          );

          if (shouldIncludeAndContinue) {
            logger.debug(
              { group: i + 1 },
              'condition met for parallel group, awaiting results'
            );
            const groupResult = await groupPromise;
            if (!groupResult) continue;
            allStreams.push(...groupResult.streams);
            allErrors.push(...groupResult.errors);
            allStatisticStreams.push(...groupResult.statistics);
            totalTimeTaken = Math.max(totalTimeTaken, groupResult.totalTime);
            previousGroupStreams = groupResult.streams;
            previousGroupTimeTaken = groupResult.totalTime;
          } else {
            logger.debug(
              { group: i + 1 },
              'condition not met for parallel group, skipping remaining groups'
            );
            // exit early.
            break;
          }
        }
      } else {
        // Sequential behavior - fetch and evaluate one group at a time
        for (let i = 0; i < this.userData.groups.groupings.length; i++) {
          const group = this.userData.groups.groupings[i];

          // For groups after the first, check condition before fetching
          if (i > 0 && group.condition) {
            const evaluator = new GroupConditionEvaluator(
              previousGroupStreams,
              allStreams,
              previousGroupTimeTaken,
              totalTimeTaken,
              queryType
            );
            const shouldFetch = await evaluator.evaluate(group.condition);

            if (!shouldFetch) {
              logger.debug(
                { group: i + 1 },
                'condition not met for sequential group, stopping'
              );
              break;
            }
          }

          const groupAddons = addons.filter(
            (addon) => addon.preset.id && group.addons.includes(addon.preset.id)
          );
          logger.debug(
            { group: i + 1, addons: groupAddons.length },
            'fetching sequential group'
          );

          const groupResult = await fetchAndProcessAddons(groupAddons);

          allStreams.push(...groupResult.streams);
          allErrors.push(...groupResult.errors);
          allStatisticStreams.push(...groupResult.statistics);
          totalTimeTaken += groupResult.totalTime;
          previousGroupStreams = groupResult.streams;
          previousGroupTimeTaken = groupResult.totalTime;
        }
      }
    } else {
      // If no groups configured, fetch from all addons in parallel
      const result = await fetchAndProcessAddons(addons);
      allStreams.push(...result.streams);
      allErrors.push(...result.errors);
      allStatisticStreams.push(...result.statistics);
    }

    logger.debug(
      {
        streams: allStreams.length,
        addons: addons.length,
        took: Date.now() - start,
      },
      'fetch complete'
    );

    // Sort statistic streams by time ascending
    const statStreamsWithTime = allStatisticStreams.map((stat) => {
      const match = stat.description.match(
        /⏱️ Time\s*:\s*(\d+(?:\.\d+)?)(ms|s)/
      );
      let time = Number.POSITIVE_INFINITY;
      if (match) {
        const value = parseFloat(match[1]);
        const unit = match[2];
        time =
          unit === 's'
            ? value * 1000
            : unit === 'ms'
              ? value
              : Number.POSITIVE_INFINITY;
      }
      return { stat, time };
    });

    statStreamsWithTime.sort((a, b) => a.time - b.time);

    // Reassign sorted statistics back to allStatisticStreams
    for (let i = 0; i < allStatisticStreams.length; i++) {
      allStatisticStreams[i] = statStreamsWithTime[i].stat;
    }
    return {
      streams: allStreams,
      errors: allErrors,
      statistics: allStatisticStreams,
      dispositions,
    };
  }
}

export default StreamFetcher;
