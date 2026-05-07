import { isMatch } from 'super-regex';
import { ParsedStream, UserData } from '../db/schemas.js';
import {
  createLogger,
  RegexAccess,
  getTimeTakenSincePoint,
  formRegexFromKeywords,
  compileRegex,
  parseRegex,
} from '../utils/index.js';
import {
  StreamSelector,
  extractNamesFromExpression,
} from '../parser/streamExpression.js';
import { StreamContext } from './context.js';

const logger = createLogger('precomputer');

export interface PrecomputeSubTimings {
  /** Time spent computing preferred regex/keyword matches (per-stream). */
  preferredRegexMs: number;
  /** Time spent computing ranked regex pattern scores (per-stream). */
  rankedRegexMs: number;
  /** Time spent evaluating ranked stream expressions (SEL). */
  rankedSELMs: number;
  /** Time spent evaluating preferred stream expressions (SEL). */
  preferredSELMs: number;
  /** Combined wall-clock time for all four stages. */
  totalMs: number;
}

class StreamPrecomputer {
  private userData: UserData;
  private accumulatedTimings: PrecomputeSubTimings;

  constructor(userData: UserData) {
    this.userData = userData;
    this.accumulatedTimings = {
      preferredRegexMs: 0,
      rankedRegexMs: 0,
      rankedSELMs: 0,
      preferredSELMs: 0,
      totalMs: 0,
    };
  }

  /** Returns accumulated precompute timings for this request (fetcher + pipeline runs combined). */
  public getPrecomputeTimings(): PrecomputeSubTimings {
    return { ...this.accumulatedTimings };
  }

  /** Resets accumulated timings for a new request (call once per getStreams invocation). */
  public resetPrecomputeTimings(): void {
    this.accumulatedTimings = {
      preferredRegexMs: 0,
      rankedRegexMs: 0,
      rankedSELMs: 0,
      preferredSELMs: 0,
      totalMs: 0,
    };
  }

  /**
   * Precompute SeaDex only - runs BEFORE filtering so seadex() works in Included SEL
   * Uses StreamContext's cached SeaDex data when available.
   */
  public async precomputeSeaDexOnly(
    streams: ParsedStream[],
    context: StreamContext
  ): Promise<number> {
    const start = Date.now();
    if (!context.isAnime || this.userData.enableSeadex === false) {
      return 0;
    }

    // Wait for SeaDex data if it's being fetched
    const seadexResult = await context.getSeaDex();
    if (!seadexResult) {
      return Date.now() - start;
    }

    this.precomputeSeaDexFromResult(
      streams,
      seadexResult,
      context.animeEntry?.mappings?.anilistId
    );
    return Date.now() - start;
  }

  /**
   * Precompute preferred matches - runs AFTER filtering on fewer streams.
   * When `skipPerStreamIds` is provided, per-stream operations (regex/keyword matching)
   * skip streams that were already precomputed (e.g. in the fetcher).
   * SEL-based operations always re-evaluate against the full stream list since
   * selections can depend on the composition of the entire set.
   */
  public async precomputePreferred(
    streams: ParsedStream[],
    context: StreamContext,
    skipPerStreamIds?: Set<string>
  ): Promise<PrecomputeSubTimings> {
    const start = Date.now();
    // preferred regex / keywords --> ranked regex patterns --> ranked stream expressions --> preferred stream expressions
    // this is the optimal order so that regexMatched can be used in RSE/PSE and streamExpressionScore and regexScore can be used in PSE
    const preferredRegexMs = await this.precomputePreferredRegexMatches(
      streams,
      skipPerStreamIds
    );
    const rankedRegexMs = await this.precomputeRankedRegexPatterns(
      streams,
      skipPerStreamIds
    );
    const rankedSELMs = await this.precomputeRankedStreamExpressions(
      streams,
      context
    );
    const preferredSELMs = await this.precomputePreferredExpressionMatches(
      streams,
      context
    );
    const totalMs = Date.now() - start;
    const skippedInfo = skipPerStreamIds
      ? ` (skipped ${skipPerStreamIds.size} pre-computed)`
      : '';
    const subParts: string[] = [];
    if (preferredRegexMs > 0) subParts.push(`prefRegex=${preferredRegexMs}ms`);
    if (rankedRegexMs > 0) subParts.push(`rankedRegex=${rankedRegexMs}ms`);
    if (rankedSELMs > 0) subParts.push(`rankedSEL=${rankedSELMs}ms`);
    if (preferredSELMs > 0) subParts.push(`prefSEL=${preferredSELMs}ms`);
    logger.info(
      `Precompute: ${getTimeTakenSincePoint(start)}${skippedInfo}` +
        (subParts.length > 0 ? `  [${subParts.join('  ')}]` : '')
    );
    // Accumulate into per-request totals (mirrors how filterer accumulates filterTimings)
    this.accumulatedTimings.preferredRegexMs += preferredRegexMs;
    this.accumulatedTimings.rankedRegexMs += rankedRegexMs;
    this.accumulatedTimings.rankedSELMs += rankedSELMs;
    this.accumulatedTimings.preferredSELMs += preferredSELMs;
    this.accumulatedTimings.totalMs += totalMs;
    return {
      preferredRegexMs,
      rankedRegexMs,
      rankedSELMs,
      preferredSELMs,
      totalMs,
    };
  }

  /**
   * Precompute ranked stream expression scores.
   * Each stream accumulates scores from all matching expressions.
   */
  private async precomputeRankedStreamExpressions(
    streams: ParsedStream[],
    context: StreamContext
  ): Promise<number> {
    if (
      !this.userData.rankedStreamExpressions?.length ||
      streams.length === 0
    ) {
      return 0;
    }
    const start = Date.now();

    const selector = new StreamSelector(context.toExpressionContext());

    // Initialize all streams with a score of 0
    const streamScores = new Map<string, number>();
    for (const stream of streams) {
      streamScores.set(stream.id, 0);
    }

    // Evaluate each ranked expression and accumulate scores.
    // Write rankedStreamExpressionsMatched onto each stream as we go so that
    // subsequent expressions can query prior matches via rseMatched().
    for (const { expression, score, enabled } of this.userData
      .rankedStreamExpressions) {
      if (enabled === false) {
        continue;
      }

      try {
        const selectedStreams = await selector.select(streams, expression);
        const exprNames = extractNamesFromExpression(expression);

        // Add the score to each matched stream
        for (const stream of selectedStreams) {
          const currentScore = streamScores.get(stream.id) ?? 0;
          streamScores.set(stream.id, currentScore + score);
          if (exprNames) {
            stream.rankedStreamExpressionsMatched = [
              ...(stream.rankedStreamExpressionsMatched ?? []),
              ...exprNames,
            ];
          }
        }
      } catch (error) {
        logger.error(
          `Failed to apply ranked stream expression "${expression}": ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // Apply the computed scores to the streams
    for (const stream of streams) {
      stream.streamExpressionScore = streamScores.get(stream.id) ?? 0;
    }

    const nonZeroScores = streams.filter(
      (s) => (s.streamExpressionScore ?? 0) !== 0
    ).length;

    logger.info(
      `Computed ranked expression scores for ${streams.length} streams (${nonZeroScores} with non-zero scores) in ${getTimeTakenSincePoint(start)}`
    );
    return Date.now() - start;
  }

  private async precomputeRankedRegexPatterns(
    streams: ParsedStream[],
    skipStreamIds?: Set<string>
  ): Promise<number> {
    if (!this.userData.rankedRegexPatterns?.length || streams.length === 0) {
      return 0;
    }
    const start = Date.now();

    const regexes = await Promise.all(
      this.userData.rankedRegexPatterns.map(async (entry) => ({
        ...entry,
        regex: await compileRegex(entry.pattern),
      }))
    );

    const streamsToProcess = skipStreamIds
      ? streams.filter((s) => !skipStreamIds.has(s.id))
      : streams;

    for (const stream of streamsToProcess) {
      if (!stream.filename) {
        continue;
      }
      const matched: string[] = [];
      let totalScore = 0;
      for (const { regex, pattern, name, score } of regexes) {
        if (
          regex.test(stream.filename) ||
          (stream.folderName && regex.test(stream.folderName))
        ) {
          if (name) matched.push(name);
          totalScore += score;
        }
      }
      if (matched.length > 0) {
        stream.rankedRegexesMatched = matched;
        stream.regexScore = totalScore;
      }
    }

    logger.info(
      `Computed ranked regex patterns for ${
        streams.filter((s) => s.rankedRegexesMatched?.length).length
      } streams in ${getTimeTakenSincePoint(start)}`
    );
    return Date.now() - start;
  }

  /**
   * Apply SeaDex tags to streams using pre-fetched SeaDex data
   */
  private precomputeSeaDexFromResult(
    streams: ParsedStream[],
    seadexResult: {
      bestHashes: Set<string>;
      allHashes: Set<string>;
      bestGroups: Set<string>;
      allGroups: Set<string>;
    },
    anilistId: string | number | undefined
  ) {
    if (
      seadexResult.bestHashes.size === 0 &&
      seadexResult.allHashes.size === 0 &&
      seadexResult.bestGroups.size === 0 &&
      seadexResult.allGroups.size === 0
    ) {
      logger.debug(`No SeaDex releases found for AniList ID ${anilistId}`);
      return;
    }

    logger.debug(`Applying SeaDex tags for anime`, {
      anilistId,
      bestHashes: Array.from(seadexResult.bestHashes),
      allHashes: Array.from(seadexResult.allHashes),
      bestGroups: Array.from(seadexResult.bestGroups),
      allGroups: Array.from(seadexResult.allGroups),
    });
    let seadexBestCount = 0;
    let seadexCount = 0;
    let seadexGroupFallbackCount = 0;
    let anyHashMatched = false;

    // First pass: try hash matching for all streams
    for (const stream of streams) {
      const infoHash = stream.torrent?.infoHash?.toLowerCase();

      if (infoHash) {
        const isBest = seadexResult.bestHashes.has(infoHash);
        const isSeadex = seadexResult.allHashes.has(infoHash);

        if (isSeadex) {
          stream.seadex = {
            isBest,
            isSeadex: true,
          };

          if (isBest) {
            seadexBestCount++;
          }
          seadexCount++;
          anyHashMatched = true;
        }
      }
    }

    // Second pass: fallback to release group matching ONLY if no hash matched
    if (!anyHashMatched) {
      for (const stream of streams) {
        // Skip streams already tagged
        if (stream.seadex) {
          continue;
        }

        const releaseGroup = stream.parsedFile?.releaseGroup?.toLowerCase();
        if (releaseGroup) {
          const isBestGroup = seadexResult.bestGroups.has(releaseGroup);
          const isSeadexGroup = seadexResult.allGroups.has(releaseGroup);

          if (isBestGroup || isSeadexGroup) {
            stream.seadex = {
              isBest: isBestGroup,
              isSeadex: true,
            };
            if (isBestGroup) {
              seadexBestCount++;
            }
            seadexCount++;
            seadexGroupFallbackCount++;
          }
        }
      }
    }

    if (seadexCount > 0) {
      logger.info(
        `Tagged ${seadexCount} streams as SeaDex releases (${seadexBestCount} best, ${seadexGroupFallbackCount} via group fallback) for AniList ID ${anilistId}`
      );
    }
  }

  /**
   * Precompute preferred regex, keyword, and stream expression matches.
   * When `skipStreamIds` is provided, per-stream keyword and regex matching
   * is skipped for those streams (they were already computed in the fetcher).
   */
  private async precomputePreferredRegexMatches(
    streams: ParsedStream[],
    skipStreamIds?: Set<string>
  ): Promise<number> {
    const start = Date.now();
    const preferredRegexPatterns =
      (await RegexAccess.isRegexAllowed(
        this.userData,
        this.userData.preferredRegexPatterns?.map(
          (pattern) => pattern.pattern
        ) ?? []
      )) && this.userData.preferredRegexPatterns
        ? await Promise.all(
            this.userData.preferredRegexPatterns.map(async (pattern) => {
              return {
                name: pattern.name,
                negate: parseRegex(pattern.pattern).flags.includes('n'),
                pattern: await compileRegex(pattern.pattern),
              };
            })
          )
        : undefined;
    const preferredKeywordsPatterns = this.userData.preferredKeywords
      ? await formRegexFromKeywords(this.userData.preferredKeywords)
      : undefined;

    if (
      !preferredRegexPatterns &&
      !preferredKeywordsPatterns &&
      !this.userData.preferredStreamExpressions?.length
    ) {
      return 0;
    }

    const streamsToProcess = skipStreamIds
      ? streams.filter((s) => !skipStreamIds.has(s.id))
      : streams;

    if (preferredKeywordsPatterns) {
      streamsToProcess.forEach((stream) => {
        stream.keywordMatched =
          isMatch(preferredKeywordsPatterns, stream.filename || '') ||
          isMatch(preferredKeywordsPatterns, stream.folderName || '') ||
          isMatch(
            preferredKeywordsPatterns,
            stream.parsedFile?.releaseGroup || ''
          ) ||
          isMatch(preferredKeywordsPatterns, stream.indexer || '');
      });
    }
    const determineMatch = (
      stream: ParsedStream,
      regexPattern: { pattern: RegExp; negate: boolean },
      attribute?: string
    ) => {
      return attribute ? isMatch(regexPattern.pattern, attribute) : false;
    };
    if (preferredRegexPatterns) {
      streamsToProcess.forEach((stream) => {
        for (let i = 0; i < preferredRegexPatterns.length; i++) {
          // if negate, then the pattern must not match any of the attributes
          // and if the attribute is undefined, then we can consider that as a non-match so true
          const regexPattern = preferredRegexPatterns[i];
          const filenameMatch = determineMatch(
            stream,
            regexPattern,
            stream.filename
          );
          const folderNameMatch = determineMatch(
            stream,
            regexPattern,
            stream.folderName
          );
          const releaseGroupMatch = determineMatch(
            stream,
            regexPattern,
            stream.parsedFile?.releaseGroup
          );
          const indexerMatch = determineMatch(
            stream,
            regexPattern,
            stream.indexer
          );
          let match =
            filenameMatch ||
            folderNameMatch ||
            releaseGroupMatch ||
            indexerMatch;
          match = regexPattern.negate ? !match : match;
          if (match) {
            stream.regexMatched = {
              name: regexPattern.name,
              pattern: regexPattern.pattern.source,
              index: i,
            };
            break;
          }
        }
      });
    }
    return Date.now() - start;
  }

  private async precomputePreferredExpressionMatches(
    streams: ParsedStream[],
    context: StreamContext
  ): Promise<number> {
    const start = Date.now();
    if (this.userData.preferredStreamExpressions?.length) {
      const selector = new StreamSelector(context.toExpressionContext());
      const streamToConditionIndex = new Map<string, number>();

      // Go through each preferred filter condition, from highest to lowest priority.
      for (
        let i = 0;
        i < this.userData.preferredStreamExpressions.length;
        i++
      ) {
        const item = this.userData.preferredStreamExpressions[i];
        const { expression, enabled } = item;
        if (!enabled) continue;

        // From the streams that haven't been matched to a higher-priority condition yet...
        const availableStreams = streams.filter(
          (stream) => !streamToConditionIndex.has(stream.id)
        );

        // ...select the ones that match the current condition.
        try {
          const selectedStreams = await selector.select(
            availableStreams,
            expression
          );

          // And for each of those, record that this is the best condition they've matched so far.
          for (const stream of selectedStreams) {
            streamToConditionIndex.set(stream.id, i);
          }
        } catch (error) {
          logger.error(
            `Failed to apply preferred stream expression "${expression}": ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      // Now, apply the results to the original streams list.
      for (const stream of streams) {
        const conditionIndex = streamToConditionIndex.get(stream.id);
        if (conditionIndex !== undefined) {
          const expression =
            this.userData.preferredStreamExpressions[conditionIndex].expression;
          stream.streamExpressionMatched = {
            index: conditionIndex,
            name: extractNamesFromExpression(expression)?.[0],
          };
        }
      }
    }
    return Date.now() - start;
  }
}

export default StreamPrecomputer;
