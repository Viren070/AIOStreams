export * from './base';
export * from './mediaflow';
export * from './stremthru';

import { constants } from '../utils';
import { BaseProxy } from './base';
import { MediaFlowProxy } from './mediaflow';
import { StremThruProxy } from './stremthru';
import { StreamProxyConfig } from '../db';

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
