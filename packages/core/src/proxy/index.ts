export * from './base.js';
export * from './mediaflow.js';
export * from './stremthru.js';

import { constants } from '../utils/index.js';
import { BaseProxy } from './base.js';
import { MediaFlowProxy } from './mediaflow.js';
import { StremThruProxy } from './stremthru.js';
import { StreamProxyConfig } from '../db/schemas.js';

export function createProxy(config: StreamProxyConfig): BaseProxy {
  switch (config.id) {
    case constants.MEDIAFLOW_SERVICE:
      return new MediaFlowProxy(config);
    case constants.STREMTHRU_SERVICE:
      return new StremThruProxy(config);
    default:
      throw new Error(`Unknown proxy type: ${config.id}`);
  }
}
