import {
  UserData,
  RegexAccess,
  SelAccess,
  createLogger,
} from '@aiostreams/core';

const logger = createLogger('server');

/**
 * Resolves all synced URLs in the user's config (regex patterns and stream
 * expressions) and merges the results into the userData object in-place.
 *
 * Errors from individual sync operations are logged as warnings and swallowed
 * so that a failure to fetch one URL does not block the entire request.
 */
export async function syncUserDataUrls(userData: UserData): Promise<UserData> {
  try {
    userData.preferredRegexPatterns = await RegexAccess.syncRegexPatterns(
      userData.syncedPreferredRegexUrls,
      userData.preferredRegexPatterns || [],
      userData,
      (regex) => regex,
      (regex) => regex.pattern
    );
  } catch (error: any) {
    logger.warn(`Failed to sync preferred regex patterns: ${error.message}`);
  }

  try {
    userData.excludedRegexPatterns = await RegexAccess.syncRegexPatterns(
      userData.syncedExcludedRegexUrls,
      userData.excludedRegexPatterns || [],
      userData,
      (regex) => regex.pattern,
      (pattern) => pattern
    );
  } catch (error: any) {
    logger.warn(`Failed to sync excluded regex patterns: ${error.message}`);
  }

  try {
    userData.requiredRegexPatterns = await RegexAccess.syncRegexPatterns(
      userData.syncedRequiredRegexUrls,
      userData.requiredRegexPatterns || [],
      userData,
      (regex) => regex.pattern,
      (pattern) => pattern
    );
  } catch (error: any) {
    logger.warn(`Failed to sync required regex patterns: ${error.message}`);
  }

  try {
    userData.includedRegexPatterns = await RegexAccess.syncRegexPatterns(
      userData.syncedIncludedRegexUrls,
      userData.includedRegexPatterns || [],
      userData,
      (regex) => regex.pattern,
      (pattern) => pattern
    );
  } catch (error: any) {
    logger.warn(`Failed to sync included regex patterns: ${error.message}`);
  }

  try {
    userData.rankedRegexPatterns = await RegexAccess.syncRegexPatterns(
      userData.syncedRankedRegexUrls,
      userData.rankedRegexPatterns || [],
      userData,
      (regex) => ({
        pattern: regex.pattern,
        name: regex.name,
        score: regex.score || 0,
      }),
      (item) => item.pattern
    );
  } catch (error: any) {
    logger.warn(`Failed to sync ranked regex patterns: ${error.message}`);
  }

  try {
    userData.preferredStreamExpressions = await SelAccess.syncStreamExpressions(
      userData.syncedPreferredStreamExpressionUrls,
      userData.preferredStreamExpressions || [],
      userData,
      (item) => ({
        expression: item.expression,
        enabled: item.enabled ?? true,
      }),
      (item) => item.expression
    );
  } catch (error: any) {
    logger.warn(
      `Failed to sync preferred stream expressions: ${error.message}`
    );
  }

  try {
    userData.excludedStreamExpressions = await SelAccess.syncStreamExpressions(
      userData.syncedExcludedStreamExpressionUrls,
      userData.excludedStreamExpressions || [],
      userData,
      (item) => ({
        expression: item.expression,
        enabled: item.enabled ?? true,
      }),
      (item) => item.expression
    );
  } catch (error: any) {
    logger.warn(`Failed to sync excluded stream expressions: ${error.message}`);
  }

  try {
    userData.requiredStreamExpressions = await SelAccess.syncStreamExpressions(
      userData.syncedRequiredStreamExpressionUrls,
      userData.requiredStreamExpressions || [],
      userData,
      (item) => ({
        expression: item.expression,
        enabled: item.enabled ?? true,
      }),
      (item) => item.expression
    );
  } catch (error: any) {
    logger.warn(`Failed to sync required stream expressions: ${error.message}`);
  }

  try {
    userData.includedStreamExpressions = await SelAccess.syncStreamExpressions(
      userData.syncedIncludedStreamExpressionUrls,
      userData.includedStreamExpressions || [],
      userData,
      (item) => ({
        expression: item.expression,
        enabled: item.enabled ?? true,
      }),
      (item) => item.expression
    );
  } catch (error: any) {
    logger.warn(`Failed to sync included stream expressions: ${error.message}`);
  }

  try {
    userData.rankedStreamExpressions = await SelAccess.syncStreamExpressions(
      userData.syncedRankedStreamExpressionUrls,
      userData.rankedStreamExpressions || [],
      userData,
      (item) => ({
        expression: item.expression,
        score: item.score || 0,
        enabled: item.enabled ?? true,
      }),
      (item) => item.expression
    );
  } catch (error: any) {
    logger.warn(`Failed to sync ranked stream expressions: ${error.message}`);
  }

  return userData;
}
