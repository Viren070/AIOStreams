import { config as appConfig } from '../../config/index.js';
import { Cache } from '../../utils/cache.js';
import { MemoryBackend } from './memory.js';
import { RedisBackend } from './redis.js';
import type { SharedBackend } from './types.js';

export * from './types.js';

let backend: SharedBackend | undefined;

/** In Redis when the server has it, so its replicas share parties. */
export function sharedBackend(): SharedBackend {
  return (backend ??= appConfig.bootstrap.redisUri
    ? new RedisBackend(() => Cache.getRedisClient())
    : new MemoryBackend());
}
