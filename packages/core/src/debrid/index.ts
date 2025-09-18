export * from './base.js';
export * from './utils.js';
export * from './stremthru.js';
export * from './torbox.js';

import { ServiceId } from '../utils/index.js';
import { DebridService, DebridServiceConfig } from './base.js';
import { StremThruInterface } from './stremthru.js';
import { TorboxDebridService } from './torbox.js';
import { StremThruPreset } from '../presets/stremthru.js';

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
      return new TorboxDebridService(config);
    default:
      if (StremThruPreset.supportedServices.includes(serviceName)) {
        return new StremThruInterface({ ...config, serviceName });
      }
      throw new Error(`Unknown debrid service: ${serviceName}`);
  }
}
