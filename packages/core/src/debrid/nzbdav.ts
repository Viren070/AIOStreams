// Credit goes to Sanket9225 for the idea and inspiration
// https://github.com/Sanket9225/UsenetStreamer/blob/master/server.js

import { z } from 'zod';
import {
  UsenetStreamService,
  UsenetStreamServiceConfig,
} from './usenet-stream-base.js';
import { DebridServiceConfig, PlaybackInfo } from './base.js';
import { ServiceId, createLogger, fromUrlSafeBase64 } from '../utils/index.js';

const logger = createLogger('nzbdav');

export const NzbDavConfig = z.object({
  nzbdavUrl: z
    .string()
    .transform((s) => s.trim().replace(/^\/+/, '').replace(/\/+$/, '')),
  publicNzbdavUrl: z
    .string()
    .optional()
    .transform((s) => s?.trim().replace(/^\/+/, '').replace(/\/+$/, '')),
  nzbdavApiKey: z.string(),
  webdavUser: z.string().optional(),
  webdavPassword: z.string().optional(),
  aiostreamsAuth: z.string().optional(),
});

export class NzbDAVService extends UsenetStreamService {
  readonly serviceName: ServiceId = 'nzbdav';
  readonly serviceLogger = logger;

  constructor(config: DebridServiceConfig) {
    const parsedConfig = NzbDavConfig.parse(
      JSON.parse(fromUrlSafeBase64(config.token))
    );

    const auth: UsenetStreamServiceConfig = {
      webdavUrl: `${parsedConfig.nzbdavUrl}/`,
      publicWebdavUrl: `${parsedConfig.publicNzbdavUrl ?? parsedConfig.nzbdavUrl}/`,
      webdavUser: parsedConfig.webdavUser,
      webdavPassword: parsedConfig.webdavPassword,
      apiUrl: `${parsedConfig.nzbdavUrl}/api`,
      apiKey: parsedConfig.nzbdavApiKey,
      aiostreamsAuth: parsedConfig.aiostreamsAuth,
    };

    super(config, auth, 'nzbdav');
  }

  protected getContentPathPrefix(): string {
    return '/content';
  }

  protected getExpectedFolderName(
    nzb: PlaybackInfo & { type: 'usenet' }
  ): string {
    return nzb.filename ?? 'unknown_nzb';
  }
}
