export * from './base.js';
export * from './utils.js';
export * from './stremthru.js';
export * from './torbox.js';
export * from './nzbdav.js';
export * from './altmount.js';

import { Env, ServiceId, fromUrlSafeBase64 } from '../utils/index.js';
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
        });
      }
      return new TorboxDebridService(config);
    case 'nzbdav':
      return new NzbDAVService(config);
    case 'altmount':
      return new AltmountService(config);
    case 'stremio_nntp':
      return new StremioNNTPService(config);
    case 'easynews':
      return new EasynewsService(config);
    case 'stremthru_newz':
      return createStremThruNewzService(config);
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
        });
      }
      throw new Error(`Unknown debrid service: ${serviceName}`);
  }
}

function createStremThruNewzService(
  config: DebridServiceConfig
): StremThruService {
  let url: string;
  let authToken: string;
  let publicUrl: string | undefined;

  try {
    const parsed = JSON.parse(fromUrlSafeBase64(config.token));
    url = parsed.url;
    authToken = parsed.authToken;
    publicUrl = parsed.publicUrl;
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
    publicUrl,
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
  });
}
