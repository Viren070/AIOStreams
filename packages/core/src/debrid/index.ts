export * from './base.js';
export * from './utils.js';
export * from './stremthru.js';
export * from './torbox.js';
export * from './nzbdav.js';
export * from './altmount.js';

import { ServiceId } from '../utils/index.js';
import { DebridService, DebridServiceConfig } from './base.js';
import { StremThruInterface } from './stremthru.js';
import { TorboxDebridService } from './torbox.js';
import { StremThruPreset } from '../presets/stremthru.js';
import { NzbDAVService } from './nzbdav.js';
import { AltmountService } from './altmount.js';
import { StremioNNTPService } from './stremio-nntp.js';
import { EasynewsService } from './easynews.js';

export function getDebridService(
  serviceName: ServiceId,
  token: string,
  clientIp?: string,
  cleanupAfterResolve?: boolean
): DebridService {
  const config: DebridServiceConfig = {
    token,
    clientIp,
    cleanupAfterResolve,
  };

  switch (serviceName) {
    case 'torbox':
      return new TorboxDebridService(config);
    case 'nzbdav':
      return new NzbDAVService(config);
    case 'altmount':
      return new AltmountService(config);
    case 'stremio_nntp':
      return new StremioNNTPService(config);
    case 'easynews':
      return new EasynewsService(config);
    default:
      if (StremThruPreset.supportedServices.includes(serviceName)) {
        return new StremThruInterface({ ...config, serviceName });
      }
      throw new Error(`Unknown debrid service: ${serviceName}`);
  }
}
