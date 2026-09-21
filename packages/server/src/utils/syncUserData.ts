import {
  UserData,
  RegexAccess,
  SelAccess,
  createLogger,
} from '@aiostreams/core';

const logger = createLogger('server');

const PLAIN_REGEX_FIELDS = [
  ['syncedExcludedRegexUrls', 'excludedRegexPatterns'],
  ['syncedRequiredRegexUrls', 'requiredRegexPatterns'],
  ['syncedIncludedRegexUrls', 'includedRegexPatterns'],
] as const satisfies ReadonlyArray<readonly [keyof UserData, keyof UserData]>;

const PLAIN_SEL_FIELDS = [
  ['syncedPreferredStreamExpressionUrls', 'preferredStreamExpressions'],
  ['syncedExcludedStreamExpressionUrls', 'excludedStreamExpressions'],
  ['syncedRequiredStreamExpressionUrls', 'requiredStreamExpressions'],
  ['syncedIncludedStreamExpressionUrls', 'includedStreamExpressions'],
] as const satisfies ReadonlyArray<readonly [keyof UserData, keyof UserData]>;

/**
 * Resolves all synced URLs in the user's config (regex patterns and stream
 * expressions) and merges the results into the userData object in-place.
 *
 * Errors from individual sync operations are logged as warnings and swallowed
 * so that a failure to fetch one URL does not block the entire request.
 */
export async function syncUserDataUrls(userData: UserData): Promise<UserData> {
  const run = async (label: string, apply: () => Promise<void>) => {
    try {
      await apply();
    } catch (error: any) {
      logger.warn(`Failed to sync ${label}: ${error.message}`);
    }
  };

  for (const [urlField, target] of PLAIN_REGEX_FIELDS) {
    await run(`${target} patterns`, async () => {
      (userData as any)[target] = await RegexAccess.syncRegexPatterns(
        userData[urlField] as string[] | undefined,
        (userData[target] as string[]) || [],
        userData,
        (regex) => regex.pattern,
        (pattern) => pattern
      );
    });
  }

  await run('preferred regex patterns', async () => {
    userData.preferredRegexPatterns = await RegexAccess.syncRegexPatterns(
      userData.syncedPreferredRegexUrls,
      userData.preferredRegexPatterns || [],
      userData,
      (regex) => regex,
      (regex) => regex.pattern
    );
  });

  await run('ranked regex patterns', async () => {
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
  });

  for (const [urlField, target] of PLAIN_SEL_FIELDS) {
    await run(`${target}`, async () => {
      (userData as any)[target] = await SelAccess.syncStreamExpressions(
        userData[urlField] as string[] | undefined,
        (userData[target] as { expression: string; enabled: boolean }[]) || [],
        userData,
        (item) => ({
          expression: item.expression,
          enabled: item.enabled ?? true,
        }),
        (item) => item.expression
      );
    });
  }

  await run('ranked stream expressions', async () => {
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
  });

  return userData;
}
