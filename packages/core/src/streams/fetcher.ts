import { Addon, ParsedStream, UserData } from '../db/schemas.js';
import {
  AnimeDatabase,
  constants,
  createLogger,
  getAddonName,
  getTimeTakenSincePoint,
} from '../utils/index.js';
import { Wrapper } from '../wrapper.js';
import {
  ExitConditionEvaluator,
  GroupConditionEvaluator,
} from '../parser/streamExpression.js';
import StreamFilter from './filterer.js';
import StreamPrecompute from './precomputer.js';
import StreamDeduplicator from './deduplicator.js';

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
    type: string,
    id: string
  ): Promise<{
    streams: ParsedStream[];
    errors: {
      title: string;
      description: string;
    }[];
    statistics: {
      title: string;
      description: string;
    }[];
  }> {
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
    let queryType = type;
    if (AnimeDatabase.getInstance().isAnime(id)) {
      queryType = `anime.${type}`;
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
            `Skipping ${getAddonName(addon)} because its specified media types do not include ${mappedType}`
          );
        }
        return result;
      }
      return true;
    });

    // Helper function to fetch streams from an addon and log summary
    const fetchFromAddon = async (addon: Addon) => {
      let summaryMsg = '';
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

        if (errorStreams.length > 0) {
          logger.error(
            `Found ${errorStreams.length} error streams from ${getAddonName(addon)}`,
            {
              errorStreams: errorStreams.map((s) => s.error?.title),
            }
          );
        }

        summaryMsg = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ${errorStreams.length > 0 ? '🟠' : '🟢'} [${getAddonName(addon)}] Scrape Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✔ Status      : ${errorStreams.length > 0 ? 'PARTIAL SUCCESS' : 'SUCCESS'}
  📦 Streams    : ${streams.length}
  📋 Details    : ${
    errorStreams.length > 0
      ? `Fetched streams with errors:\n${errorStreams.map((s) => `    • ${s.error?.title || 'Unknown error'}: ${s.error?.description || 'No description'}`).join('\n')}`
      : 'Successfully fetched streams.'
  }
  ⏱️ Time       : ${getTimeTakenSincePoint(start)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        let statisticStream = {
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

        return {
          success: true as const,
          streams: streams.filter(
            (s) => s.type !== constants.ERROR_STREAM_TYPE
          ),
          errors: addonErrors,
          statistic: statisticStream,
          timeTaken: Date.now() - start,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const addonErrors = {
          title: `[❌] ${getAddonName(addon)}`,
          description: errMsg,
        };
        summaryMsg = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔴 [${getAddonName(addon)}] Scrape Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✖ Status      : FAILED
  🚫 Error      : ${errMsg}
  ⏱️ Time       : ${getTimeTakenSincePoint(start)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        return {
          success: false as const,
          errors: [addonErrors],
          timeTaken: 0,
          streams: [],
        };
      } finally {
        logger.info(summaryMsg);
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
      await this.precompute.precomputeSeaDexOnly(groupStreams, id);

      const filteredStreams = await this.deduplicate.deduplicate(
        await this.filter.filter(groupStreams, type, id)
      );

      // Run preferred matching AFTER filter
      await this.precompute.precomputePreferred(filteredStreams, type, id);

      logger.info(
        `Finished fetching from group in ${getTimeTakenSincePoint(groupStart)}`
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
        logger.debug(`Extracted checkpoints to check exit condition at`, {
          checkpoints: checkpointTimes,
          count: checkpointTimes.length,
        });
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
        const timeouts: NodeJS.Timeout[] = [];
        if (activePromises === 0) {
          resolve();
          return;
        }

        const checkExit = async () => {
          if (resolved) return;
          const timeTaken = Date.now() - start;
          const evaluator = new ExitConditionEvaluator(
            allStreams,
            timeTaken,
            queryType,
            queriedAddons,
            allAddons
          );

          const shouldExit = await evaluator.evaluate(condition);
          logger.debug(`Evaluated exit condition`, {
            shouldExit,
            queriedAddons,
          });
          if (shouldExit) {
            logger.info(
              // subtract 1 because this function is awaited before activePromises is decremented
              `Exit condition met with results from ${queriedAddons.length} addons. (${activePromises - 1} addons still fetching) Returning results.`
            );
            resolved = true;
            resolve();
          }
        };

        checkpointTimes.forEach((checkpointTime) => {
          const timeout = setTimeout(() => {
            if (!resolved) {
              logger.debug(`Performing scheduled exit condition checkpoint`, {
                checkpoint: checkpointTime,
                time: (performance.now() - addonFetchStartTime).toFixed(0),
              });
              checkExit();
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
                  `All addons from preset ${progress.name} (${addon.preset.id}) have been queried. Pushing addon name to queriedAddons.`
                );
                queriedAddons.push(addon.name);
              }

              allStreams.push(...result.streams);
              allErrors.push(...result.errors);
              if (result.statistics) {
                allStatisticStreams.push(...result.statistics);
              }
              await checkExit();
            })
            .catch((error) => {
              logger.error(
                `Unhandled error from fetchAndProcessAddons for ${getAddonName(addon)}:`,
                error
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
        const groupPromises = this.userData.groups.groupings.map((group) => {
          const groupAddons = addons.filter(
            (addon) => addon.preset.id && group.addons.includes(addon.preset.id)
          );
          if (groupAddons.length === 0) return Promise.resolve(null);
          logger.info(
            `Queueing parallel fetch for group with ${groupAddons.length} addons.`
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
            logger.info(
              `Condition met for parallel group ${i + 1}, awaiting its streams and continuing.`
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
            logger.info(
              `Condition not met for parallel group ${i + 1}, skipping remaining groups.`
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
              logger.info(
                `Condition not met for sequential group ${i + 1}, stopping.`
              );
              break;
            }
          }

          const groupAddons = addons.filter(
            (addon) => addon.preset.id && group.addons.includes(addon.preset.id)
          );
          logger.info(
            `Fetching from sequential group ${i + 1} with ${groupAddons.length} addons.`
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

    logger.info(
      `Fetched ${allStreams.length} streams from ${addons.length} addons in ${getTimeTakenSincePoint(start)}`
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
    };
  }
}

export default StreamFetcher;
