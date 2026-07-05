export * from './base.js';
export * from './utils.js';
export * from './stremthru.js';
export * from './torbox.js';
export * from './nzbdav.js';
export * from './altmount.js';
export * from './aiostreams.js';
export * from './realdebrid.js';

import {
  appConfig,
  constants,
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
import { NativeUsenetService } from './aiostreams.js';
import { RealDebridService } from './realdebrid.js';

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
    appConfig.builtins.debrid.downloadPollInterval,
    serviceName
  );
  const maxWaitTime = resolveServiceTime(
    appConfig.builtins.debrid.downloadMaxWaitTime,
    serviceName
  );

  switch (serviceName) {
    case 'torbox':
      if (appConfig.builtins.stremthru.torboxUsenetViaStremthru) {
        return new StremThruService({
          serviceName: 'torbox',
          clientIp: config.clientIp,
          stremthru: {
            baseUrl: appConfig.builtins.stremthru.url,
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
    case constants.CUSTOM_REALDEBRID_SERVICE:
      return createCustomRealDebridService(config, pollInterval, maxWaitTime);
    case constants.AIOSTREAMS_SERVICE:
      return new NativeUsenetService(config);
    default:
      if (StremThruPreset.supportedServices.includes(serviceName)) {
        return new StremThruService({
          serviceName,
          clientIp: config.clientIp,
          stremthru: {
            baseUrl: appConfig.builtins.stremthru.url,
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

function createCustomRealDebridService(
  config: DebridServiceConfig,
  pollInterval: number,
  maxWaitTime: number
): RealDebridService {
  // The credential is JSON `{url, apiKey}` (assembled by getServiceCredential);
  // also accept the base64-encoded form for parity with other custom services.
  let url: string | undefined;
  let apiKey: string | undefined;
  try {
    const parsed = JSON.parse(config.token);
    url = parsed.url;
    apiKey = parsed.apiKey;
  } catch {
    try {
      const parsed = JSON.parse(fromUrlSafeBase64(config.token));
      url = parsed.url;
      apiKey = parsed.apiKey;
    } catch {
      // fall through to the validation error below
    }
  }

  if (!url || !apiKey) {
    throw new DebridError(
      'Invalid Custom RealDebrid credentials. Expected a url and an apiKey.',
      {
        statusCode: 400,
        statusText: 'Bad Request',
        code: 'BAD_REQUEST',
        headers: {},
        body: {},
      }
    );
  }

  // Fail fast on a malformed base URL rather than surfacing confusing fetch
  // errors later.
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('protocol must be http or https');
    }
  } catch {
    throw new DebridError(`Invalid Custom RealDebrid base URL: ${url}`, {
      statusCode: 400,
      statusText: 'Bad Request',
      code: 'BAD_REQUEST',
      headers: {},
      body: {},
    });
  }

  return new RealDebridService(
    { baseUrl: url, token: apiKey, clientIp: config.clientIp },
    { pollInterval, maxWaitTime }
  );
}
