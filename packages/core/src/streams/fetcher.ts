import { Addon, ParsedStream, UserData } from '../db/schemas.js';
import {
  AnimeDatabase,
  constants,
  createLogger,
  getAddonName,
  getTimeTakenSincePoint,
} from '../utils/index.js';
import { Wrapper } from '../wrapper.js';
import { GroupConditionEvaluator } from '../parser/streamExpression.js';
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
      queryType = 'anime';
    }

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
          statistics: statisticStream,
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
          statistics: [],
          timeTaken: 0,
          streams: [],
        };
      } finally {
        logger.info(summaryMsg);
      }
    };

    // Helper function to fetch from a group of addons and track time
    const fetchFromGroup = async (addons: Addon[]) => {
      const groupStart = Date.now();
      const results = await Promise.all(addons.map(fetchFromAddon));

      const groupStreams = results.flatMap((r) => r.streams);
      const groupErrors = results.flatMap((r) => r.errors);
      const groupStatistics = results.flatMap((r) => r.statistics);

      const filteredStreams = await this.deduplicate.deduplicate(
        await this.filter.filter(groupStreams, type, id)
      );
      await this.precompute.precompute(filteredStreams, type, id);

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
    if (
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
          logger.info(
            `Queueing parallel fetch for group with ${groupAddons.length} addons.`
          );
          return fetchFromGroup(groupAddons);
        });

        for (let i = 0; i < this.userData.groups.groupings.length; i++) {
          const groupResult = await groupPromises[i];
          const group = this.userData.groups.groupings[i];

          if (i === 0) {
            allStreams.push(...groupResult.streams);
            allErrors.push(...groupResult.errors);
            allStatisticStreams.push(...groupResult.statistics);
            totalTimeTaken = groupResult.totalTime;
            previousGroupStreams = groupResult.streams;
            previousGroupTimeTaken = groupResult.totalTime;
          } else {
            // For groups other than the first, check their condition
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
                `Condition met for parallel group ${i + 1}, including streams and continuing.`
              );
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

          const groupResult = await fetchFromGroup(groupAddons);

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
      const result = await fetchFromGroup(addons);
      allStreams.push(...result.streams);
      allErrors.push(...result.errors);
      allStatisticStreams.push(...result.statistics);
    }

    logger.info(
      `Fetched ${allStreams.length} streams from ${addons.length} addons in ${getTimeTakenSincePoint(start)}`
    );
    return {
      streams: allStreams,
      errors: allErrors,
      statistics: allStatisticStreams,
    };
  }
}

export default StreamFetcher;
