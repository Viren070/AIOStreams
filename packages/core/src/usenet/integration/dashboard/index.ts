/**
 * Usenet dashboard surface:
 *   - `providers.ts` provider CRUD (secret masking) + connection/speed tests
 *   - `stats.ts`     metrics drain/pruning + live stats + windowed overview
 */
export { PERFORMANCE_PROFILES } from '../../../config/schema/usenet.js';
export * from './providers.js';
export * from './stats.js';
