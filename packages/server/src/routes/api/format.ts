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
} from '@aiostreams/core';
import { formatApiRateLimiter } from '../../middlewares/ratelimit.js';
import z from 'zod';

const router: Router = Router();

router.use(formatApiRateLimiter);

const logger = createLogger('server');

// Schema for the formatter context that can be sent from the client
const FormatterContextSchema = z.object({
  userData: UserDataSchema,
  type: z.string().optional(),
  isAnime: z.boolean().optional(),
  queryType: z.string().optional(),
  season: z.number().optional(),
  episode: z.number().optional(),
  title: z.string().optional(),
  titles: z.array(z.string()).optional(),
  year: z.number().optional(),
  yearEnd: z.number().optional(),
  genres: z.array(z.string()).optional(),
  runtime: z.number().optional(),
  absoluteEpisode: z.number().optional(),
  relativeAbsoluteEpisode: z.number().optional(),
  originalLanguage: z.string().optional(),
  daysSinceRelease: z.number().optional(),
  hasNextEpisode: z.boolean().optional(),
  daysUntilNextEpisode: z.number().optional(),
  daysSinceFirstAired: z.number().optional(),
  daysSinceLastAired: z.number().optional(),
  latestSeason: z.number().optional(),
  anilistId: z.number().optional(),
  malId: z.number().optional(),
  hasSeaDex: z.boolean().optional(),
  maxRseScore: z.number().optional(),
  maxRegexScore: z.number().optional(),
});

function createDummyFormatterContext(
  userData: any,
  overrides: Partial<FormatterContext> = {}
): FormatterContext {
  return {
    userData,
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
    absoluteEpisode: undefined,
    relativeAbsoluteEpisode: undefined,
    originalLanguage: 'English',
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
    contextOverrides = contextData;
  }

  const formatterContext = createDummyFormatterContext(
    userDataData,
    contextOverrides
  );

  const formatter = createFormatter(formatterContext);
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
  res
    .status(200)
    .json(createResponse({ success: true, data: formattedStream }));
});

export default router;
