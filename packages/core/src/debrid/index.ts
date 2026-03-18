export * from './base.js';
export * from './utils.js';
export * from './stremthru.js';
export * from './torbox.js';
export * from './nzbdav.js';
export * from './altmount.js';

import {
  Env,
  ServiceId,
  fromUrlSafeBase64,
  resolveServiceTime,
} from '../utils/index.js';
import { DebridService, DebridServiceConfig, DebridError } from './base.js';
import { StremThruService } from './stremthru.js';
import { TorboxDebridService } from './torbox.js';
import { StremThruPreset } from '../presets/stremthru.js';
import { NzbDAVService } from './nzbdav.js';
import { AltmountService } from './altmount.js';
import { StremioNNTPService } from './stremio-nntp.js';
import { EasynewsService } from './easynews.js';

export function getDebridService(
  serviceName: ServiceId,
  token: string,
  clientIp?: string
): DebridService {
  const config: DebridServiceConfig = {
    token,
    clientIp,
  };

  const pollInterval = resolveServiceTime(
    Env.BUILTIN_DOWNLOAD_POLL_INTERVAL,
    serviceName
  );
  const maxWaitTime = resolveServiceTime(
    Env.BUILTIN_DOWNLOAD_MAX_WAIT_TIME,
    serviceName
  );

  switch (serviceName) {
    case 'torbox':
      if (Env.TORBOX_USENET_VIA_STREMTHRU) {
        return new StremThruService({
          serviceName: 'torbox',
          clientIp: config.clientIp,
          stremthru: {
            baseUrl: Env.BUILTIN_STREMTHRU_URL,
            store: 'torbox',
            token: config.token,
          },
          capabilities: { torrents: true, usenet: true },
          cacheAndPlayOptions: {
            pollingInterval: pollInterval,
            maxWaitTime: maxWaitTime,
          },
        });
      }
      return new TorboxDebridService(config, {
        pollInterval,
        maxWaitTime,
      });
    case 'nzbdav':
      return new NzbDAVService(config, {
        pollingInterval: pollInterval,
        maxWaitTime: maxWaitTime,
      });
    case 'altmount':
      return new AltmountService(config, {
        pollingInterval: pollInterval,
        maxWaitTime: maxWaitTime,
      });
    case 'stremio_nntp':
      return new StremioNNTPService(config);
    case 'easynews':
      return new EasynewsService(config);
    case 'stremthru_newz':
      return createStremThruNewzService(config, pollInterval, maxWaitTime);
    default:
      if (StremThruPreset.supportedServices.includes(serviceName)) {
        return new StremThruService({
          serviceName,
          clientIp: config.clientIp,
          stremthru: {
            baseUrl: Env.BUILTIN_STREMTHRU_URL,
            store: serviceName,
            token: config.token,
          },
          capabilities: { torrents: true, usenet: false },
          cacheAndPlayOptions: {
            pollingInterval: pollInterval,
            maxWaitTime: maxWaitTime,
          },
        });
      }
      throw new Error(`Unknown debrid service: ${serviceName}`);
  }
}

function createStremThruNewzService(
  config: DebridServiceConfig,
  pollInterval: number,
  maxWaitTime: number
): StremThruService {
  let url: string;
  let authToken: string;

  try {
    const parsed = JSON.parse(fromUrlSafeBase64(config.token));
    url = parsed.url;
    authToken = parsed.authToken;
  } catch {
    throw new DebridError(
      'Invalid StremThru Newz credentials. Expected base64-encoded JSON with url and authToken.',
      {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'BAD_REQUEST',
        headers: {},
        body: {},
      }
    );
  }

  if (!url || !authToken) {
    throw new DebridError(
      'Missing url or authToken in StremThru Newz credentials.',
      {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'BAD_REQUEST',
        headers: {},
        body: {},
      }
    );
  }

  return new StremThruService({
    serviceName: 'stremthru_newz',
    clientIp: config.clientIp,
    stremthru: {
      baseUrl: url,
      store: 'stremthru',
      token: authToken,
    },
    capabilities: { torrents: false, usenet: true },
    usenetOptions: {
      alwaysCacheAndPlay: true,
      neverAutoRemove: true,
      treatUnknownAsCached: true,
    },
    cacheAndPlayOptions: {
      pollingInterval: pollInterval,
      maxWaitTime: maxWaitTime,
    },
  });
}
