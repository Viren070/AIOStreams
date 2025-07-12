import { Addon, ParsedStream, UserData } from '../db/schemas';
import { constants, createLogger, getTimeTakenSincePoint } from '../utils';
import { Wrapper } from '../wrapper';
import { GroupConditionEvaluator } from '../parser/streamExpression';
import { getAddonName } from '../utils/general';
import StreamFilter from './filterer';
import StreamPrecompute from './precomputer';
import StreamDeduplicator from './deduplicator';

const logger = createLogger('fetcher');

class StreamFetcher {
  private userData: UserData;
  private filter: StreamFilter;
  private precompute: StreamPrecompute;
  private deduplicate: StreamDeduplicator;
  constructor(userData: UserData) {
    this.userData = userData;
    this.filter = new StreamFilter(userData);
    this.precompute = new StreamPrecompute(userData);
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
    let totalTimeTaken = 0;
    let previousGroupStreams: ParsedStream[] = [];
    let previousGroupTimeTaken = 0;

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
        allStatisticStreams.push(statisticStream);

        return {
          success: true as const,
          streams: streams.filter(
            (s) => s.type !== constants.ERROR_STREAM_TYPE
          ),
          errors: addonErrors,
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
    const fetchFromGroup = async (addons: Addon[]) => {
      const groupStart = Date.now();
      const results = await Promise.all(addons.map(fetchFromAddon));

      const groupStreams = results.flatMap((r) => r.streams);
      const groupErrors = results.flatMap((r) => r.errors);
      allErrors.push(...groupErrors);

      const filteredStreams = await this.deduplicate.deduplicate(
        await this.filter.filter(groupStreams, type, id)
      );
      await this.precompute.precompute(filteredStreams);

      const groupTime = Date.now() - groupStart;
      logger.info(`Filtered to ${filteredStreams.length} streams`);
      return {
        totalTime: groupTime,
        streams: filteredStreams,
      };
    };

    // If groups are configured, handle group-based fetching
    if (this.userData.groups && this.userData.groups.length > 0) {
      // Always fetch from first group
      const firstGroupAddons = addons.filter(
        (addon) =>
          addon.presetInstanceId &&
          this.userData.groups![0].addons.includes(addon.presetInstanceId)
      );

      logger.info(
        `Fetching streams from first group with ${firstGroupAddons.length} addons`
      );

      // Fetch streams from first group
      const firstGroupResult = await fetchFromGroup(firstGroupAddons);
      allStreams.push(...firstGroupResult.streams);
      totalTimeTaken = firstGroupResult.totalTime;
      previousGroupStreams = firstGroupResult.streams;
      previousGroupTimeTaken = firstGroupResult.totalTime;

      // For each subsequent group, evaluate condition and fetch if true
      for (let i = 1; i < this.userData.groups.length; i++) {
        const group = this.userData.groups[i];

        // Skip if no condition or addons
        if (!group.condition || !group.addons.length) continue;

        try {
          const evaluator = new GroupConditionEvaluator(
            previousGroupStreams,
            allStreams,
            previousGroupTimeTaken,
            totalTimeTaken,
            type
          );
          const shouldFetch = await evaluator.evaluate(group.condition);
          if (shouldFetch) {
            logger.info(`Condition met for group ${i + 1}, fetching streams`);

            const groupAddons = addons.filter(
              (addon) =>
                addon.presetInstanceId &&
                group.addons.includes(addon.presetInstanceId)
            );

            const groupResult = await fetchFromGroup(groupAddons);
            allStreams.push(...groupResult.streams);
            totalTimeTaken += groupResult.totalTime;
            previousGroupStreams = groupResult.streams;
            previousGroupTimeTaken = groupResult.totalTime;
          } else {
            logger.info(
              `Condition not met for group ${i + 1}, skipping remaining groups`
            );
            // if we meet a group whose condition is not met, we do not need to fetch from any subsequent groups
            break;
          }
        } catch (error) {
          logger.error(`Error evaluating condition for group ${i}:`, error);
          continue;
        }
      }
    } else {
      // If no groups configured, fetch from all addons in parallel
      const result = await fetchFromGroup(addons);
      allStreams.push(...result.streams);
      totalTimeTaken = result.totalTime;
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
