import { config } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import { cleanHost } from './backbone-map.js';

const logger = createLogger('release-blocklist');

/**
 * The hosts of this instance's enabled native usenet providers,
 * deduplicated. Full hostnames rather than root domains or backbone ids:
 * subdomains can sit on different backbones, and consumers (ours included)
 * normalize at comparison time. These are recorded on exported verdicts.
 * Empty when no native providers are configured, which leaves backbone
 * gating inert.
 */
export function instanceBackbones(): string[] {
  try {
    const providers = (config.usenet.providers ?? []) as Array<{
      host?: string;
      enabled?: boolean;
    }>;
    const hosts = new Set<string>();
    for (const provider of providers) {
      if (provider.enabled === false) continue;
      const host = cleanHost(provider.host);
      if (host !== 'unknown') hosts.add(host);
    }
    return [...hosts];
  } catch (err) {
    logger.warn(`could not derive instance backbones: ${err}`);
    return [];
  }
}
