import { isMatch } from 'super-regex';
import { ParsedStream, UserData } from '../db/schemas.js';
import {
  createLogger,
  FeatureControl,
  getTimeTakenSincePoint,
  formRegexFromKeywords,
  compileRegex,
  parseRegex,
} from '../utils/index.js';
import { StreamSelector } from '../parser/streamExpression.js';
import { StreamContext } from './context.js';

const logger = createLogger('precomputer');

class StreamPrecomputer {
  private userData: UserData;

  constructor(userData: UserData) {
    this.userData = userData;
  }

  /**
   * Precompute SeaDex only - runs BEFORE filtering so seadex() works in Included SEL
   * Uses StreamContext's cached SeaDex data when available.
   */
  public async precomputeSeaDexOnly(
    streams: ParsedStream[],
    context: StreamContext
  ) {
    if (!context.isAnime || this.userData.enableSeadex === false) {
      return;
    }

    // Wait for SeaDex data if it's being fetched
    const seadexResult = await context.getSeaDex();
    if (!seadexResult) {
      return;
    }

    this.precomputeSeaDexFromResult(
      streams,
      seadexResult,
      context.animeEntry?.mappings?.anilistId
    );
  }

  /**
   * Precompute preferred matches - runs AFTER filtering on fewer streams
   */
  public async precomputePreferred(
    streams: ParsedStream[],
    context: StreamContext
  ) {
    const start = Date.now();
    await this.precomputePreferredMatches(streams, context);
    // carry out before ranked stream expressions so regex matches can be used in the expressions
    await this.precomputeRankedRegexPatterns(streams);
    await this.precomputeRankedStreamExpressions(streams, context);
    logger.info(
      `Precomputed preferred filters in ${getTimeTakenSincePoint(start)}`
    );
  }

  /**
   * Precompute ranked stream expression scores.
   * Each stream accumulates scores from all matching expressions.
   */
  private async precomputeRankedStreamExpressions(
    streams: ParsedStream[],
    context: StreamContext
  ) {
    if (
      !this.userData.rankedStreamExpressions?.length ||
      streams.length === 0
    ) {
      return;
    }

    const selector = new StreamSelector(context.toExpressionContext());

    // Initialize all streams with a score of 0
    const streamScores = new Map<string, number>();
    for (const stream of streams) {
      streamScores.set(stream.id, 0);
    }

    // Evaluate each ranked expression and accumulate scores
    for (const { expression, score } of this.userData.rankedStreamExpressions) {
      try {
        const selectedStreams = await selector.select(streams, expression);

        // Add the score to each matched stream
        for (const stream of selectedStreams) {
          const currentScore = streamScores.get(stream.id) ?? 0;
          streamScores.set(stream.id, currentScore + score);
        }

        logger.debug(
          `Ranked expression "${expression.length > 50 ? expression.substring(0, 50) + '...' : expression}" matched ${selectedStreams.length} streams with score ${score}`
        );
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
      `Computed ranked expression scores for ${streams.length} streams (${nonZeroScores} with non-zero scores)`
    );
  }

  private async precomputeRankedRegexPatterns(streams: ParsedStream[]) {
    if (!this.userData.rankedRegexPatterns?.length || streams.length === 0) {
      return;
    }

    const regexes = await Promise.all(
      this.userData.rankedRegexPatterns.map(async (entry) => ({
        ...entry,
        regex: await compileRegex(entry.pattern),
      }))
    );

    for (const stream of streams) {
      if (!stream.filename) {
        continue;
      }
      const matched: { pattern: string; name?: string; score: number }[] = [];
      let totalScore = 0;
      for (const { regex, pattern, name, score } of regexes) {
        if (regex.test(stream.filename)) {
          matched.push({ pattern, name, score });
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
      } streams`
    );
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
   * Precompute preferred regex, keyword, and stream expression matches
   */
  private async precomputePreferredMatches(
    streams: ParsedStream[],
    context: StreamContext
  ) {
    const preferredRegexPatterns =
      (await FeatureControl.isRegexAllowed(
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
      return;
    }

    if (preferredKeywordsPatterns) {
      streams.forEach((stream) => {
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
      streams.forEach((stream) => {
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

    if (this.userData.preferredStreamExpressions?.length) {
      const selector = new StreamSelector(context.toExpressionContext());
      const streamToConditionIndex = new Map<string, number>();

      // Go through each preferred filter condition, from highest to lowest priority.
      for (
        let i = 0;
        i < this.userData.preferredStreamExpressions.length;
        i++
      ) {
        const expression = this.userData.preferredStreamExpressions[i];

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
        stream.streamExpressionMatched = streamToConditionIndex.get(stream.id);
      }
    }
  }
}

export default StreamPrecomputer;
