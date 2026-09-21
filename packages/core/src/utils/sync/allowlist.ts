import { createLogger } from '../../logging/logger.js';
import { isHttpUrl, type AllowlistSource } from './types.js';

const logger = createLogger('sync');

/** The URLs an instance vouches for, assembled from several contributors. */
export class UrlAllowlist {
  private readonly sources = new Map<AllowlistSource, Set<string>>();
  private union = new Set<string>();

  constructor(private readonly label: string) {}

  /**
   * Replace one source's URLs wholesale. Anything appended instead of replaced
   * can never be revoked without a restart.
   */
  public setSource(
    source: AllowlistSource,
    urls: string[]
  ): { added: string[]; removed: string[] } {
    const next = new Set<string>();
    for (const url of urls) {
      if (!isHttpUrl(url)) {
        logger.warn({ url, source, type: this.label }, 'skipping invalid URL');
        continue;
      }
      next.add(url);
    }

    const previous = this.sources.get(source) ?? new Set<string>();
    if (
      previous.size === next.size &&
      [...next].every((u) => previous.has(u))
    ) {
      return { added: [], removed: [] };
    }

    this.sources.set(source, next);
    const rebuilt = new Set<string>();
    for (const set of this.sources.values()) {
      for (const url of set) rebuilt.add(url);
    }

    const added = [...rebuilt].filter((url) => !this.union.has(url));
    const removed = [...this.union].filter((url) => !rebuilt.has(url));
    this.union = rebuilt;

    if (added.length > 0 || removed.length > 0) {
      logger.info(
        {
          source,
          added: added.length,
          removed: removed.length,
          total: this.union.size,
          type: this.label,
        },
        'rebuilt vouched URL list'
      );
    }

    return { added, removed };
  }

  public get urls(): string[] {
    return [...this.union];
  }

  public has(url: string): boolean {
    return this.union.has(url);
  }
}
