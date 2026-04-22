import { constants, formatMilliseconds } from '../utils/index.js';
import type { ParsedStream } from '../db/schemas.js';
import type { AIOStreamsContext, StatEntry, PipelineTimings } from './types.js';

/** Split a flat filter-details array into per-📌-header groups. */
export function splitByPin(details: string[]): string[][] {
  const groups: string[][] = [];
  let currentGroup: string[] = [];
  for (const line of details) {
    if (line.trim().startsWith('📌')) {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [line];
    } else {
      currentGroup.push(line);
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);
  return groups;
}

/**
 * Push filter statistic entries (removal reasons + included reasons) into `statistics`.
 * Groups whose header matches an entry in `excludeHeaders` are silently skipped.
 */
export function pushFilterStats(
  statistics: StatEntry[],
  filterDetails: string[],
  includedDetails: string[],
  forced: boolean,
  excludeHeaders: string[] = []
): void {
  const push = (details: string[], title: string) => {
    for (const group of splitByPin(details)) {
      const header = group[0]?.trim() ?? '';
      if (excludeHeaders.some((ex) => header.startsWith(`📌 ${ex}`))) continue;
      const entry: StatEntry = { title, description: group.join('\n').trim() };
      if (forced) entry.forced = true;
      statistics.push(entry);
    }
  };
  if (filterDetails.length > 0) push(filterDetails, '🔍 Removal Reasons');
  if (includedDetails.length > 0) push(includedDetails, '🔍 Included Reasons');
}

export function buildStatistics(
  ctx: Pick<AIOStreamsContext, 'userData' | 'filterer' | 'precomputer'>,
  finalStreams: ParsedStream[],
  fetchMs: number,
  pipelineTimings: PipelineTimings
): StatEntry[] {
  const { userData, filterer, precomputer } = ctx;
  const statistics: StatEntry[] = [];
  const fmtMs = (ms: number) => formatMilliseconds(ms);

  const filterStats = filterer.getFilterStatistics();
  const { filterDetails, includedDetails } =
    filterer.getFormattedFilterDetails();

  // exclude digital release filter from normal filter status
  // if that info was already displayed.
  const excludeFromStats: string[] =
    (userData.digitalReleaseFilter?.showInfoOnFilter ?? true) &&
    filterStats.removed.noDigitalRelease.total > 0
      ? ['No Digital Release']
      : [];

  if (
    userData.statistics?.enabled &&
    userData.statistics?.statsToShow?.includes('filter')
  ) {
    pushFilterStats(
      statistics,
      filterDetails,
      includedDetails,
      false,
      excludeFromStats
    );
  }

  // Forced digital release filter info stream - shown regardless of statistics settings
  if (
    (userData.digitalReleaseFilter?.showInfoOnFilter ?? true) &&
    filterStats.removed.noDigitalRelease.total > 0
  ) {
    statistics.push({
      title: '📅 Digital Release Filter',
      description: [
        `⚠️ There is no digital release available for this media yet.`,
        finalStreams.length > 0
          ? '🔎 There are still streams present, this may be\ndue to any passthrough that is configured (addon level, SEL etc.)'
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      forced: true,
    });
  }

  // Forced filter stats when 0 streams remain - only if not already shown above
  const alreadyShowingFilterStats =
    userData.statistics?.enabled &&
    userData.statistics?.statsToShow?.includes('filter');
  if (
    userData.statistics?.showFilterStatsOnNoStreams !== false &&
    finalStreams.length === 0 &&
    !alreadyShowingFilterStats
  ) {
    pushFilterStats(
      statistics,
      filterDetails,
      includedDetails,
      true,
      excludeFromStats
    );
  }

  if (
    userData.statistics?.enabled &&
    userData.statistics?.statsToShow?.includes('timing')
  ) {
    const filterTimings = filterer.getFilterTimings();
    const accumulatedPrecompute = precomputer.getPrecomputeTimings();
    // totalMs uses pipeline-phase timings only (fetchMs already contains the fetcher filter/precompute)
    const totalMs =
      fetchMs +
      pipelineTimings.serviceWrapMs +
      pipelineTimings.filterMs +
      pipelineTimings.deduplicationMs +
      pipelineTimings.precomputeMs +
      pipelineTimings.sortMs +
      pipelineTimings.limitMs +
      pipelineTimings.selMs;

    {
      const lines: string[] = [
        `📥 Fetch: ${fmtMs(fetchMs)}`,
        `🔗 Service Wrap: ${fmtMs(pipelineTimings.serviceWrapMs)}`,
      ];
      // Show accumulated filter total (fetcher + optional re-filter pass)
      if (filterTimings.totalMs > 0) {
        lines.push(`🔍 Filter: ${fmtMs(filterTimings.totalMs)}`);
      }
      lines.push(
        `🔄 Dedup: ${fmtMs(pipelineTimings.deduplicationMs)}`,
        // Show accumulated precompute total (fetcher + optional pipeline pass)
        `⚙️ Precompute: ${fmtMs(accumulatedPrecompute.totalMs)}`,
        `📊 Sort: ${fmtMs(pipelineTimings.sortMs)}`,
        `✂️ Limit: ${fmtMs(pipelineTimings.limitMs)}`,
        `🎯 SEL: ${fmtMs(pipelineTimings.selMs)}`,
        `${'─'.repeat(20)}`,
        `⏱️ Total: ~${fmtMs(totalMs)}`
      );
      statistics.push({
        title: '⏱️ Pipeline Timing',
        description: lines.join('\n'),
      });
    }

    if (filterTimings.calls > 0) {
      const lines: string[] = [
        `⏱️ Total: ${fmtMs(filterTimings.totalMs)} (${filterTimings.calls} call${filterTimings.calls > 1 ? 's' : ''})`,
        `${'─'.repeat(20)}`,
        `📝 Metadata: ${fmtMs(filterTimings.metadataMs)}`,
        `⚡ Expressions: ${fmtMs(filterTimings.expressionMs)}`,
        `🔨 Regex compile: ${fmtMs(filterTimings.regexCompileMs)}`,
        `🧪 Regex test: ${fmtMs(filterTimings.regexTestMs)}`,
        `🌪️ Filter pass: ${fmtMs(filterTimings.filterPassMs)}`,
      ];
      const { phases } = filterTimings;
      const phaseRows: Array<[string, typeof phases.titleMatch, string]> = [
        ['Title match', phases.titleMatch, '🔤'],
        ['Year match', phases.yearMatch, '📅'],
        ['Season/Ep', phases.seasonEpisodeMatch, '📺'],
      ];
      const activePhases = phaseRows.filter(
        ([, p]) => (p as typeof phases.titleMatch).count > 0
      );
      if (activePhases.length > 0) {
        lines.push(``, `🔍 Per-stream phases:`);
        for (const [label, p, emoji] of activePhases) {
          const phase = p as typeof phases.titleMatch;
          lines.push(`  ${emoji} ${label}: ${fmtMs(phase.totalMs)}`);
        }
      }
      statistics.push({
        title: '🔍 Filter Breakdown',
        description: lines.join('\n'),
      });
    }

    if (accumulatedPrecompute.totalMs > 0) {
      const sub = accumulatedPrecompute;
      const fetcherPrecomputeMs =
        accumulatedPrecompute.totalMs - pipelineTimings.precomputeMs;
      const rows: Array<[string, number, string]> = [
        ['Preferred regex', sub.preferredRegexMs, '⭐'],
        ['Ranked regex', sub.rankedRegexMs, '📈'],
        ['Ranked SEL', sub.rankedSELMs, '🎯'],
        ['Preferred SEL', sub.preferredSELMs, '✨'],
      ];
      const activeRows = rows.filter(([, ms]) => (ms as number) > 0);
      if (activeRows.length > 0) {
        const lines: string[] = [
          `⏱️ Total: ${fmtMs(accumulatedPrecompute.totalMs)}`,
        ];
        if (fetcherPrecomputeMs > 0 && pipelineTimings.precomputeMs > 0) {
          lines.push(
            `    • Fetcher: ${fmtMs(fetcherPrecomputeMs)}`,
            `    • Pipeline: ${fmtMs(pipelineTimings.precomputeMs)}`
          );
        }
        lines.push(`${'─'.repeat(20)}`);
        for (const [label, ms, emoji] of activeRows) {
          lines.push(`${emoji} ${label}: ${fmtMs(ms as number)}`);
        }
        statistics.push({
          title: '⚙️ Precompute Breakdown',
          description: lines.join('\n'),
        });
      }
    }

    if (
      pipelineTimings.serviceWrapMs > 0 &&
      pipelineTimings.serviceWrapTimings
    ) {
      const entries = Object.entries(pipelineTimings.serviceWrapTimings);
      if (entries.length > 0) {
        const lines: string[] = [
          `⏱️ Total: ${fmtMs(pipelineTimings.serviceWrapMs)} (${entries.length} service${entries.length > 1 ? 's' : ''})`,
          `${'─'.repeat(20)}`,
        ];
        for (let i = 0; i < entries.length; i++) {
          const [serviceId, t] = entries[i];
          const shortName =
            (
              constants.SERVICE_DETAILS as Record<
                string,
                { shortName?: string }
              >
            )[serviceId]?.shortName ?? serviceId;
          let statusStr = '';
          if (t.hasError) {
            statusStr = ' | ❌ Error';
          } else {
            const cachedStr =
              t.cachedCount > 0 ? ` | ✅ ${t.cachedCount} cached` : '';
            const uncachedStr =
              t.uncachedCount > 0 ? ` | ⏳ ${t.uncachedCount} uncached` : '';
            statusStr = `${cachedStr}${uncachedStr}`;
          }

          lines.push(
            `☁️ ${shortName} (${t.torrentsIn} torrents${statusStr})`,
            `    • Magnet check: ${fmtMs(t.magnetCheckMs)}`,
            `    • Processing: ${fmtMs(t.processingMs)}`,
            `    • Total: ${fmtMs(t.totalMs)}`
          );
          if (i < entries.length - 1) {
            lines.push(``);
          }
        }
        statistics.push({
          title: '🔗 Service Wrap Breakdown',
          description: lines.join('\n'),
        });
      }
    }
  }

  return statistics;
}
