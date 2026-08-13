export * from './base.js';
export * from './builtin.js';
export * from './mediaflow.js';
export * from './stremthru.js';
export * from './token.js';

import { constants } from '../utils/index.js';
import { BaseProxy } from './base.js';
import { MediaFlowProxy } from './mediaflow.js';
import { StremThruProxy } from './stremthru.js';
import { StreamProxyConfig } from '../db/schemas.js';
import { BuiltinProxy } from './builtin.js';

export function createProxy(config: StreamProxyConfig): BaseProxy {
  switch (config.id) {
    case constants.MEDIAFLOW_SERVICE:
      return new MediaFlowProxy(config);
    case constants.STREMTHRU_SERVICE:
      return new StremThruProxy(config);
    case constants.BUILTIN_SERVICE:
      return new BuiltinProxy(config);
    default:
      throw new Error(`Unknown proxy type: ${config.id}`);
  }
}
