import { createLogger } from '../../logging/logger.js';
import { config as appConfig, subscribeToConfig } from '../../config/index.js';
import { TaskManager } from '../../tasks/index.js';
import { SyncFetcher } from './fetcher.js';
import { UrlAllowlist } from './allowlist.js';
import { assertFetchable, partitionUrls } from './policy.js';
import type {
  AllowlistSource,
  FetchResult,
  SyncFetcherConfig,
  SyncKind,
  UrlPartition,
} from './types.js';

const logger = createLogger('sync');

const DAY_SECONDS = 86400;

export interface SyncServiceConfig<T> extends SyncFetcherConfig {
  kind: SyncKind;
  taskId: string;
  taskLabel: string;
  taskDescription: string;
  /** Read live; snapshotting it breaks runtime edits to the settings list. */
  settingsUrls: () => string[];
  /**
   * One complete snapshot of every vouched URL's items. Consumers must derive
   * their state from it rather than accumulate, or nothing is ever revocable.
   */
  onVouchedItems?: (items: Map<string, T[]>) => void;
}

/**
 * Owns the sync lifecycle for one item type.
 *
 * The allowlist is the single definition of the URLs this instance vouches for:
 * it gates access and it is the set the refresh task keeps warm. Anything
 * outside it is fetched on demand and never contributes to instance-wide state.
 */
export class SyncService<T extends Record<string, any>> {
  public readonly allowlist: UrlAllowlist;
  public readonly fetcher: SyncFetcher<T>;

  private readonly config: SyncServiceConfig<T>;
  private initialisation: Promise<void> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(config: SyncServiceConfig<T>) {
    this.config = config;
    this.allowlist = new UrlAllowlist(config.cacheKey);
    this.fetcher = new SyncFetcher<T>(config);
  }

  /** Only has to outlive a failed refresh run, hence the floor. */
  private get vouchedTtl(): number {
    const interval = this.refreshInterval;
    return interval > 0 ? Math.max(interval * 3, DAY_SECONDS) : DAY_SECONDS;
  }

  /** No refresh task behind these, so the TTL is the whole freshness policy. */
  private get userTtl(): number {
    const interval = this.refreshInterval;
    return interval > 0 ? interval : DAY_SECONDS;
  }

  private get refreshInterval(): number {
    return appConfig.userLimits.sync.refreshInterval;
  }

  public initialise(): Promise<void> {
    if (!this.initialisation) {
      this.initialisation = this.bootstrap();
    }
    return this.initialisation;
  }

  public cleanup(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    TaskManager.unregister(this.config.taskId);
  }

  /** Warms added URLs at once rather than waiting for the next scheduled run. */
  public setSource(source: AllowlistSource, urls: string[]): void {
    const { added, removed } = this.allowlist.setSource(source, urls);
    if (added.length === 0 && removed.length === 0) return;
    if (!this.initialisation) return;
    void this.refresh(added).catch((error) =>
      logger.warn(
        { type: this.config.cacheKey, error: error.message },
        'failed to refresh after allowlist change'
      )
    );
  }

  public partition(
    urls: string[],
    userData?: { trusted?: boolean }
  ): UrlPartition {
    return partitionUrls(this.config.kind, urls, this.allowlist, userData);
  }

  public async fetch(url: string, vouched: boolean): Promise<T[]> {
    if (!vouched) await assertFetchable(url);
    return this.fetcher.fetch(url, {
      ttl: vouched ? this.vouchedTtl : this.userTtl,
    });
  }

  public async fetchSettled(
    url: string,
    vouched: boolean
  ): Promise<FetchResult<T>> {
    try {
      return { url, items: await this.fetch(url, vouched) };
    } catch (error: any) {
      return { url, items: [], error: error.message };
    }
  }

  /** Keyed by URL, in `allowed` order. Failures yield no items. */
  public async fetchAll(partition: UrlPartition): Promise<Map<string, T[]>> {
    const vouched = new Set(partition.vouched);
    const entries = await Promise.all(
      partition.allowed.map((url) => this.settle(url, vouched.has(url)))
    );
    return new Map(entries.filter((e): e is [string, T[]] => e !== null));
  }

  /**
   * Re-read every vouched URL, or just `only` and anything uncached. A failure
   * falls back to the cached copy so a transient outage does not revoke
   * permissions.
   */
  public async refresh(
    only?: string[]
  ): Promise<{ urls: number; items: number }> {
    this.allowlist.setSource('settings', this.config.settingsUrls());
    const urls = this.allowlist.urls;
    if (urls.length === 0) {
      this.config.onVouchedItems?.(new Map());
      return { urls: 0, items: 0 };
    }

    const cached = await this.fetcher.readCached(urls);
    const refetch = only ? new Set(only) : null;
    const snapshot = new Map<string, T[]>();

    await Promise.all(
      urls.map(async (url) => {
        const fallback = cached.get(url);
        if (fallback && refetch && !refetch.has(url)) {
          snapshot.set(url, fallback);
          return;
        }
        try {
          snapshot.set(url, await this.fetcher.refetch(url, this.vouchedTtl));
        } catch (error: any) {
          if (fallback) {
            snapshot.set(url, fallback);
            logger.warn(
              { url, type: this.config.cacheKey, error: error.message },
              'refresh failed, keeping cached copy'
            );
          } else {
            logger.error(
              { url, type: this.config.cacheKey, error: error.message },
              'refresh failed with nothing cached'
            );
          }
        }
      })
    );

    this.config.onVouchedItems?.(snapshot);
    const items = [...snapshot.values()].reduce((n, l) => n + l.length, 0);
    return { urls: snapshot.size, items };
  }

  private async settle(
    url: string,
    vouched: boolean
  ): Promise<[string, T[]] | null> {
    try {
      return [url, await this.fetch(url, vouched)];
    } catch (error: any) {
      logger.warn(
        { url, type: this.config.cacheKey, error: error.message },
        'failed to resolve synced URL'
      );
      return null;
    }
  }

  private async bootstrap(): Promise<void> {
    this.allowlist.setSource('settings', this.config.settingsUrls());

    // Before anything touches the network, so boot survives a dead upstream.
    const urls = this.allowlist.urls;
    if (urls.length > 0 && this.config.onVouchedItems) {
      const cached = await this.fetcher.readCached(urls);
      if (cached.size > 0) {
        this.config.onVouchedItems(cached);
        logger.info(
          { urls: cached.size, type: this.config.cacheKey },
          'seeded vouched items from cache'
        );
      }
    }

    this.registerRefreshTask();
    this.watchSettings();

    const { items } = await this.refresh();
    logger.info(
      {
        items,
        type: this.config.cacheKey,
        refreshInterval: this.refreshInterval,
      },
      'initialised sync service'
    );
  }

  private registerRefreshTask(): void {
    const intervalSec = this.refreshInterval;
    const scheduled = intervalSec > 0;
    TaskManager.register({
      id: this.config.taskId,
      label: this.config.taskLabel,
      description: this.config.taskDescription,
      category: 'data-sync',
      kind: scheduled ? 'scheduled' : 'manual',
      intervalMs: scheduled ? intervalSec * 1000 : undefined,
      enabled: true,
      destructive: false,
      multiReplica: 'all',
      run: async () => {
        const { urls, items } = await this.refresh();
        return { ok: true, message: `${items} items from ${urls} URL(s)` };
      },
    });
  }

  /** The URL settings are `requiresRestart: false`, so react to edits. */
  private watchSettings(): void {
    const keys =
      this.config.kind === 'regex'
        ? ['userLimits.regex.patternsUrls']
        : ['userLimits.sel.urls'];
    this.unsubscribe = subscribeToConfig(({ changed }) => {
      if (!keys.some((key) => changed.has(key))) return;
      this.setSource('settings', this.config.settingsUrls());
    });
  }
}
