import { z } from 'zod';
import {
  UsenetStreamService,
  UsenetStreamServiceConfig,
} from './usenet-stream-base.js';
import { DebridServiceConfig, PlaybackInfo } from './base.js';
import { ServiceId, createLogger, fromUrlSafeBase64 } from '../utils/index.js';
import { basename } from 'path';

const logger = createLogger('altmount');

export const AltmountConfig = z.object({
  altmountUrl: z
    .string()
    .transform((s) => s.trim().replace(/^\/+/, '').replace(/\/+$/, '')),
  publicAltmountUrl: z
    .string()
    .optional()
    .transform((s) => s?.trim().replace(/^\/+/, '').replace(/\/+$/, '')),
  altmountApiKey: z.string(),
  webdavUser: z.string(),
  webdavPassword: z.string(),
  aiostreamsAuth: z.string().optional(),
});

export class AltmountService extends UsenetStreamService {
  readonly serviceName: ServiceId = 'altmount';
  readonly serviceLogger = logger;

  constructor(config: DebridServiceConfig) {
    const parsedConfig = AltmountConfig.parse(
      JSON.parse(fromUrlSafeBase64(config.token))
    );

    const auth: UsenetStreamServiceConfig = {
      webdavUrl: `${parsedConfig.altmountUrl}/webdav/`,
      publicWebdavUrl: `${parsedConfig.publicAltmountUrl ?? parsedConfig.altmountUrl}/webdav/`,
      webdavUser: parsedConfig.webdavUser,
      webdavPassword: parsedConfig.webdavPassword,
      apiUrl: `${parsedConfig.altmountUrl}/sabnzbd/api`,
      apiKey: parsedConfig.altmountApiKey,
      aiostreamsAuth: parsedConfig.aiostreamsAuth,
    };

    super(config, auth, 'altmount');
  }

  protected getContentPathPrefix(): string {
    return '/complete';
  }

  protected getExpectedFolderName(
    nzb: PlaybackInfo & { type: 'usenet' }
  ): string {
    const nzbUrl = nzb.nzb;
    // Altmount uses basename of the NZB URL
    return nzbUrl.endsWith('.nzb')
      ? basename(nzbUrl, '.nzb')
      : basename(nzbUrl);
  }
}
