import { isMatch } from 'super-regex';
import { ParsedStream, UserData } from '../db/schemas.js';
import {
  createLogger,
  FeatureControl,
  getTimeTakenSincePoint,
  formRegexFromKeywords,
  compileRegex,
  parseRegex,
  AnimeDatabase,
} from '../utils/index.js';
import { StreamSelector } from '../parser/streamExpression.js';

const logger = createLogger('precomputer');

class StreamPrecomputer {
  private userData: UserData;

  constructor(userData: UserData) {
    this.userData = userData;
  }

  public async precompute(streams: ParsedStream[], type: string, id: string) {
    let queryType = type;
    if (AnimeDatabase.getInstance().isAnime(id)) {
      queryType = 'anime';
    }
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
    if (!preferredRegexPatterns && !preferredKeywordsPatterns) {
      return;
    }
    const start = Date.now();
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
      const selector = new StreamSelector(queryType);
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
    logger.info(
      `Precomputed preferred filters in ${getTimeTakenSincePoint(start)}`
    );
  }
}

export default StreamPrecomputer;
