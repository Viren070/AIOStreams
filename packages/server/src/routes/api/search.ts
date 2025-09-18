import { Router, Request, Response } from 'express';
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
  ApiSearchResponseData,
} from '@aiostreams/core';
import { streamApiRateLimiter } from '../../middlewares/ratelimit.js';
import { ApiResponse, createResponse } from '../../utils/responses.js';
import { z, ZodError } from 'zod';
const router: Router = Router();

const logger = createLogger('server');

router.use(streamApiRateLimiter);

router.get(
  '/',
  async (
    req: Request,
    res: Response<ApiResponse<ApiSearchResponseData>>,
    next
  ) => {
    try {
      const { type, id } = z
        .object({
          type: z.string(),
          id: z.string(),
        })
        .parse(req.query);
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
          constants.ErrorCode.BAD_REQUEST,
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

      res.status(200).json(
        createResponse<ApiSearchResponseData>({
          success: true,
          data: await transformer.transformStreams(
            await (
              await new AIOStreams(userData).initialise()
            ).getStreams(id, type)
          ),
        })
      );
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          new APIError(
            constants.ErrorCode.BAD_REQUEST,
            undefined,
            formatZodError(error)
          )
        );
      }
      next(error);
    }
  }
);

export default router;
