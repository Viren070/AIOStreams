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
  IdParser,
  SeaDexApi,
} from '../utils/index.js';
import { StreamSelector } from '../parser/streamExpression.js';

const logger = createLogger('precomputer');

class StreamPrecomputer {
  private userData: UserData;

  constructor(userData: UserData) {
    this.userData = userData;
  }

  /**
   * Precompute SeaDex only - runs BEFORE filtering so seadex() works in Included SEL
   */
  public async precomputeSeaDexOnly(streams: ParsedStream[], id: string) {
    const isAnime = AnimeDatabase.getInstance().isAnime(id);
    await this.precomputeSeaDex(streams, id, isAnime);
  }

  /**
   * Precompute preferred matches - runs AFTER filtering on fewer streams
   */
  public async precomputePreferred(
    streams: ParsedStream[],
    type: string,
    id: string
  ) {
    const start = Date.now();
    const isAnime = AnimeDatabase.getInstance().isAnime(id);
    let queryType = type;
    if (isAnime) {
      queryType = `anime.${type}`;
    }
    await this.precomputePreferredMatches(streams, queryType);
    logger.info(
      `Precomputed preferred filters in ${getTimeTakenSincePoint(start)}`
    );
  }

  /**
   * Precompute SeaDex status for anime streams
   * Tags streams with seadex.isBest and seadex.isSeadex
   * First tries to match by infoHash, then falls back to release group matching
   */
  private async precomputeSeaDex(
    streams: ParsedStream[],
    id: string,
    isAnime: boolean
  ) {
    if (!isAnime || !this.userData.enableSeadex) {
      return;
    }

    const parsedId = IdParser.parse(id, 'unknown');
    if (!parsedId) {
      return;
    }
    const animeDb = AnimeDatabase.getInstance();
    const entry = animeDb.getEntryById(parsedId.type, parsedId.value);
    const anilistIdRaw = entry?.mappings?.anilistId;

    if (!anilistIdRaw) {
      logger.debug(
        `No AniList ID found for ${parsedId.type}:${parsedId.value}, skipping SeaDex lookup`
      );
      return;
    }

    const anilistId =
      typeof anilistIdRaw === 'string'
        ? parseInt(anilistIdRaw, 10)
        : anilistIdRaw;
    if (isNaN(anilistId)) {
      logger.debug(
        `Invalid AniList ID ${anilistIdRaw}, skipping SeaDex lookup`
      );
      return;
    }
    const seadexResult = await SeaDexApi.getInfoHashesForAnime(anilistId);

    if (
      seadexResult.bestHashes.size === 0 &&
      seadexResult.allHashes.size === 0 &&
      seadexResult.bestGroups.size === 0 &&
      seadexResult.allGroups.size === 0
    ) {
      logger.debug(`No SeaDex releases found for AniList ID ${anilistId}`);
      return;
    }
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
    queryType: string
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
  }
}

export default StreamPrecomputer;
