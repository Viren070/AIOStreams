import { Router, Request, Response } from 'express';
import { createResponse } from '../../utils/responses.js';
import {
  createLogger,
  UserDataSchema,
  formatZodError,
  createFormatter,
  ParsedStreamSchema,
  APIError,
  constants,
  FormatterContext,
  config as appConfig,
} from '@aiostreams/core';
import { formatApiRateLimiter } from '../../middlewares/ratelimit.js';
import z from 'zod';

const router: Router = Router();

router.use(formatApiRateLimiter);

const logger = createLogger('server');

// Schema for the formatter context that can be sent from the client.
// Every field is nullish: an omitted key takes the dummy default below, while an
// explicit null clears it, which is the only way to preview an absent field.
const FormatterContextSchema = z.object({
  userData: UserDataSchema,
  type: z.string().nullish(),
  isAnime: z.boolean().nullish(),
  queryType: z.string().nullish(),
  season: z.number().nullish(),
  episode: z.number().nullish(),
  title: z.string().nullish(),
  titles: z.array(z.string()).nullish(),
  year: z.number().nullish(),
  yearEnd: z.number().nullish(),
  genres: z.array(z.string()).nullish(),
  runtime: z.number().nullish(),
  absoluteEpisode: z.number().nullish(),
  relativeAbsoluteEpisode: z.number().nullish(),
  originalLanguage: z.string().nullish(),
  country: z.string().nullish(),
  episodeTitles: z.array(z.string()).nullish(),
  daysSinceRelease: z.number().nullish(),
  hasNextEpisode: z.boolean().nullish(),
  daysUntilNextEpisode: z.number().nullish(),
  daysSinceFirstAired: z.number().nullish(),
  daysSinceLastAired: z.number().nullish(),
  latestSeason: z.number().nullish(),
  anilistId: z.number().nullish(),
  malId: z.number().nullish(),
  hasSeaDex: z.boolean().nullish(),
  maxSeScore: z.number().nullish(),
  maxRegexScore: z.number().nullish(),
  episodeRuntime: z.number().nullish(),
});

/**
 * null to undefined, keeping the key present so it still overrides a dummy
 * default when spread.
 */
function clearNulls(
  context: z.infer<typeof FormatterContextSchema>
): Partial<FormatterContext> {
  const { userData, ...rest } = context;
  return Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [key, value ?? undefined])
  ) as Partial<FormatterContext>;
}

function createDummyFormatterContext(
  userData: any,
  overrides: Partial<FormatterContext> = {}
): FormatterContext {
  return {
    userData,
    addonName: appConfig.branding.addonName,
    type: 'movie',
    isAnime: false,
    queryType: 'movie',
    season: undefined,
    episode: undefined,
    title: 'Sample Movie',
    titles: ['Sample Movie', 'Sample Movie Alt Title'],
    year: 2024,
    yearEnd: undefined,
    genres: ['Action', 'Thriller'],
    runtime: 120,
    episodeRuntime: undefined,
    absoluteEpisode: undefined,
    relativeAbsoluteEpisode: undefined,
    originalLanguage: 'English',
    country: 'US',
    episodeTitles: undefined,
    daysSinceRelease: 30,
    hasNextEpisode: false,
    daysUntilNextEpisode: undefined,
    daysSinceFirstAired: undefined,
    daysSinceLastAired: undefined,
    latestSeason: undefined,
    anilistId: undefined,
    malId: undefined,
    hasSeaDex: false,
    maxSeScore: 100,
    maxRegexScore: 50,
    ...overrides,
  };
}

router.post('/', async (req: Request, res: Response) => {
  const { stream, context } = req.body;

  const {
    success: userDataSuccess,
    error: userDataError,
    data: userDataData,
  } = UserDataSchema.safeParse(context.userData);
  if (!userDataSuccess) {
    logger.error('Invalid user data', { error: userDataError });
    throw new APIError(
      constants.ErrorCode.FORMAT_INVALID_FORMATTER,
      400,
      formatZodError(userDataError)
    );
  }

  // Parse optional formatter context
  let contextOverrides: Partial<FormatterContext> = {};
  if (context) {
    const {
      success: contextSuccess,
      error: contextError,
      data: contextData,
    } = FormatterContextSchema.safeParse(context);
    if (!contextSuccess) {
      logger.error('Invalid formatter context', { error: contextError });
      throw new APIError(
        constants.ErrorCode.FORMAT_INVALID_FORMATTER,
        400,
        formatZodError(contextError)
      );
    }
    contextOverrides = clearNulls(contextData);
  }

  const formatterContext = createDummyFormatterContext(
    userDataData,
    contextOverrides
  );

  let formatter;
  try {
    formatter = createFormatter(formatterContext);
  } catch (error) {
    throw new APIError(
      constants.ErrorCode.FORMAT_INVALID_FORMATTER,
      400,
      error instanceof Error ? error.message : 'Invalid formatter'
    );
  }

  const {
    success: streamSuccess,
    error: streamError,
    data: streamData,
  } = ParsedStreamSchema.safeParse(stream);
  if (!streamSuccess) {
    logger.error('Invalid stream', { error: streamError });
    throw new APIError(
      constants.ErrorCode.FORMAT_INVALID_STREAM,
      400,
      formatZodError(streamError)
    );
  }
  const formattedStream = await formatter.format(streamData);

  res.status(200).json(
    createResponse({
      success: true,
      data: formattedStream,
    })
  );
});

export default router;
