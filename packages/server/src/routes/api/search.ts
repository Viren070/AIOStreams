import { Router, Request, Response, NextFunction } from 'express';
import {
  AIOStreams,
  AIOStreamResponse,
  Env,
  UserData,
  UserRepository,
  APIError,
  constants,
  formatZodError,
  validateConfig,
  isEncrypted,
  decryptString,
  createLogger,
  ApiTransformer,
  SearchApiResponseData,
  SearchApiResultField,
  StremioTransformer,
} from '@aiostreams/core';
import { streamApiRateLimiter } from '../../middlewares/ratelimit.js';
import { ApiResponse, createResponse } from '../../utils/responses.js';
import { z, ZodError } from 'zod';
const router: Router = Router();

const logger = createLogger('server');

router.use(streamApiRateLimiter);

const SearchApiRequestSchema = z.object({
  type: z.string(),
  id: z.string(),
  format: z.coerce.boolean().optional().default(false),
  requiredFields: z
    .union([z.array(SearchApiResultField), SearchApiResultField])
    .optional()
    .default([])
    .transform((val) => {
      if (Array.isArray(val)) {
        return val;
      }
      return [val];
    }),
});

router.get(
  '/',
  async (
    req: Request,
    res: Response<ApiResponse<SearchApiResponseData>>,
    next: NextFunction
  ) => {
    try {
      const { type, id, requiredFields, format } = SearchApiRequestSchema.parse(
        req.query
      );
      let encodedUserData: string | undefined = z
        .string()
        .optional()
        .parse(req.headers['x-aiostreams-user-data']);
      let auth: string | undefined = z
        .string()
        .optional()
        .parse(req.headers['authorization']);

      if (!encodedUserData && !auth) {
        throw new APIError(
          constants.ErrorCode.UNAUTHORIZED,
          undefined,
          `At least one of AIOStreams-User-Data or Authorization headers must be present`
        );
      }

      let userData: UserData | null = null;

      if (encodedUserData) {
        try {
          userData = JSON.parse(
            Buffer.from(encodedUserData, 'base64').toString('utf-8')
          );
          if (userData) {
            userData.trusted = false;
            logger.debug(`Using encodedUserData for Search API request`);
          }
        } catch (error: any) {
          throw new APIError(
            constants.ErrorCode.BAD_REQUEST,
            undefined,
            `Invalid encodedUserData: ${error.message}`
          );
        }
      } else if (auth) {
        let uuid: string;
        let password: string;
        try {
          if (!auth.startsWith('Basic ')) {
            throw new APIError(
              constants.ErrorCode.BAD_REQUEST,
              undefined,
              `Invalid auth: ${auth}. Must start with 'Basic '`
            );
          }
          const base64Credentials = auth.slice('Basic '.length).trim();
          const credentials = Buffer.from(base64Credentials, 'base64').toString(
            'utf-8'
          );
          const sepIndex = credentials.indexOf(':');
          if (sepIndex === -1) {
            throw new APIError(
              constants.ErrorCode.BAD_REQUEST,
              undefined,
              `Invalid basic auth format`
            );
          }
          uuid = credentials.slice(0, sepIndex);
          password = credentials.slice(sepIndex + 1);
          if (!uuid || !password) {
            throw new APIError(
              constants.ErrorCode.BAD_REQUEST,
              undefined,
              `Missing username or password in basic auth`
            );
          }
          if (isEncrypted(password)) {
            const {
              success: successfulDecryption,
              data: decryptedPassword,
              error,
            } = decryptString(password);
            if (!successfulDecryption) {
              next(
                new APIError(
                  constants.ErrorCode.ENCRYPTION_ERROR,
                  undefined,
                  error
                )
              );
              return;
            }
            password = decryptedPassword;
          }
          logger.debug(`Using basic auth for Search API request: ${uuid}`);
        } catch (error: any) {
          throw new APIError(
            constants.ErrorCode.BAD_REQUEST,
            undefined,
            `Invalid auth: ${error.message}`
          );
        }
        const userExists = await UserRepository.checkUserExists(uuid);
        if (!userExists) {
          throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
        }

        userData = await UserRepository.getUser(uuid, password);

        if (!userData) {
          throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
        }
      }
      if (!userData) {
        throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
      }
      userData.ip = req.userIp;
      try {
        userData = await validateConfig(userData, {
          skipErrorsFromAddonsOrProxies: true,
          decryptValues: true,
        });
      } catch (error: any) {
        throw new APIError(
          constants.ErrorCode.USER_INVALID_CONFIG,
          undefined,
          error.message
        );
      }
      const transformer = new ApiTransformer(userData);
      const stremioTransformer = format
        ? new StremioTransformer(userData)
        : null;

      const aiostreams = new AIOStreams(userData);
      await aiostreams.initialise();
      const response = await aiostreams.getStreams(id, type);
      const ctx = aiostreams.getStreamContext();

      if (!ctx) {
        throw new Error('Stream context not available');
      }
      const formatterContext = ctx.toFormatterContext(response.data.streams);

      const stremioData = await stremioTransformer?.transformStreams(
        response,
        formatterContext
      );
      const stremioStreams = stremioData?.streams.filter(
        (stream) =>
          !['statistic', 'error'].includes(stream.streamData?.type || '')
      );

      const apiData = await transformer.transformStreams(
        response,
        requiredFields
      );
      if (stremioStreams && format) {
        apiData.results = apiData.results.map((result, index) => {
          const stream = stremioStreams[index];
          return {
            ...result,
            name: stream?.name,
            description: stream?.description,
          };
        });
      }

      res.status(200).json(
        createResponse<SearchApiResponseData>({
          success: true,
          data: apiData,
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

export default router;
