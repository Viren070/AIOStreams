import { config as appConfig } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import { rootDomain } from './evaluate.js';

const logger = createLogger('screener');

/**
 * The backbones (provider root domains) this instance streams from, derived
 * from the enabled native Usenet providers. Used to scope shared dead-release
 * verdicts to backbones we actually use, and recorded on our own verdicts so
 * others can scope against them.
 *
 * Empty when no native providers are configured (e.g. debrid-only usenet),
 * which leaves backbone scoping inert.
 */
export function myBackbones(): string[] {
  try {
    const providers = (appConfig.usenet.providers ?? []) as Array<{
      host?: string;
      enabled?: boolean;
    }>;
    const set = new Set<string>();
    for (const p of providers) {
      if (p.enabled === false) continue;
      const root = rootDomain(p.host);
      if (root !== 'unknown') set.add(root);
    }
    return [...set];
  } catch (err) {
    // Fail safe (no scoping) but surface it: silently empty backbones would
    // quietly apply every remote verdict regardless of provider.
    logger.warn(`could not derive backbones; scoping disabled: ${err}`);
    return [];
  }
}
