import { z } from 'zod';
import { config as appConfig, subscribeToConfig } from '../config/index.js';
import { createLogger } from '../logging/logger.js';
import { TaskManager } from '../tasks/index.js';
import { hmac } from '../analytics/index.js';
import { fetchRemoteCapped } from '../utils/safe-fetch.js';
import type { Template } from '../db/schemas.js';
import { validateCommunityPayload } from './validators/index.js';
import type { CommunityItemPublic, CommunityKind } from './types.js';

const logger = createLogger('community');

const TASK_ID = 'community-remote-refresh';
// Items are only bounded by maxJsonBodySize (1 MiB each), so leave room for a few dozen large templates.
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const EXPORT_PATH = '/community/export.json';

const RemoteItemSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(['formatter', 'template']),
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  author: z.string().min(1).max(20),
  version: z.string().max(20).default('1.0.0'),
  tags: z.array(z.string().min(1).max(20)).max(5).default([]),
  payload: z.unknown(),
  likes: z.number().int().nonnegative().default(0),
  createdAt: z.number().default(0),
  updatedAt: z.number().default(0),
});

const RemoteExportSchema = z.object({
  version: z.literal(1),
  items: z.array(RemoteItemSchema).max(2000),
});

export interface RemoteSourceState {
  url: string;
  lastFetchedAt?: number;
  count: number;
  error?: string;
  etag?: string;
}

/** A bare instance URL resolves to its export; anything else is used as given. */
function exportUrl(source: string): string {
  try {
    const parsed = new URL(source);
    if (parsed.pathname === '/' || parsed.pathname === '') {
      parsed.pathname = EXPORT_PATH;
      parsed.search = '';
      return parsed.toString();
    }
  } catch {
    // left to the fetch guard to refuse
  }
  return source;
}

/**
 * Read-only mirror of other instances' approved community items. Everything
 * is re-validated on arrival; nothing federated can be liked or trusted here.
 */
export class CommunityFederation {
  private static itemsBySource = new Map<string, CommunityItemPublic[]>();
  private static states = new Map<string, RemoteSourceState>();
  private static revision = 0;
  private static configSubscribed = false;

  static get remoteItems(): CommunityItemPublic[] {
    return [...this.itemsBySource.values()].flat();
  }

  static itemsOfKind(kind: CommunityKind): CommunityItemPublic[] {
    return this.remoteItems.filter((item) => item.kind === kind);
  }

  /** Bumps whenever the mirrored set changes, so list ETags can include it. */
  static get exportRevision(): string {
    return String(this.revision);
  }

  static sourceStates(): RemoteSourceState[] {
    return [...this.states.values()];
  }

  static initialise(): void {
    this.registerTask();
    if (!this.configSubscribed) {
      this.configSubscribed = true;
      subscribeToConfig(async ({ changed }) => {
        if (
          !changed.has('community.remoteSources') &&
          !changed.has('community.remoteRefreshInterval')
        ) {
          return;
        }
        this.registerTask();
        if ((appConfig.community.remoteSources ?? []).length > 0) {
          const res = await TaskManager.runNow(TASK_ID);
          if (!res.ok) {
            logger.error(
              { err: res.message },
              'community remote refresh failed'
            );
          }
        }
      });
    }
    if ((appConfig.community.remoteSources ?? []).length > 0) {
      void TaskManager.runNow(TASK_ID);
    }
  }

  private static registerTask(): void {
    const intervalSec = appConfig.community.remoteRefreshInterval;
    const sources = appConfig.community.remoteSources ?? [];
    const scheduled = intervalSec > 0 && sources.length > 0;
    TaskManager.register({
      id: TASK_ID,
      label: 'Community remote refresh',
      description:
        'Re-fetch shared formatters and templates from the configured remote instances.',
      category: 'community',
      kind: scheduled ? 'scheduled' : 'manual',
      intervalMs: scheduled ? intervalSec * 1000 : undefined,
      enabled: true,
      destructive: false,
      multiReplica: 'all',
      run: async () => {
        if ((appConfig.community.remoteSources ?? []).length === 0) {
          return {
            ok: true,
            message: 'no remote community sources configured',
          };
        }
        const { count } = await this.refresh();
        return { ok: true, message: `${count} remote items` };
      },
    });
  }

  static async refresh(): Promise<{ count: number }> {
    const sources = (appConfig.community.remoteSources ?? []).map(exportUrl);
    const seen = new Set(sources);
    for (const url of [...this.itemsBySource.keys()]) {
      if (!seen.has(url)) {
        this.itemsBySource.delete(url);
        this.states.delete(url);
      }
    }
    await Promise.all(sources.map((url) => this.refreshSource(url)));
    this.revision++;
    const count = this.remoteItems.length;
    logger.info(
      { sources: sources.length, count },
      'community remote refresh complete'
    );
    return { count };
  }

  private static async refreshSource(url: string): Promise<void> {
    const previous = this.states.get(url);
    const state: RemoteSourceState = {
      url,
      count: previous?.count ?? 0,
      lastFetchedAt: previous?.lastFetchedAt,
      etag: previous?.etag,
    };
    try {
      const res = await fetchRemoteCapped(url, {
        etag: previous?.etag ?? null,
        maxBytes: MAX_EXPORT_BYTES,
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      state.lastFetchedAt = Date.now();
      if (!res.notModified) {
        const parsed = RemoteExportSchema.parse(
          JSON.parse(res.body.toString('utf8'))
        );
        const items = this.adopt(url, parsed.items);
        this.itemsBySource.set(url, items);
        state.count = items.length;
        state.etag = res.etag ?? undefined;
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      logger.warn({ url, err: state.error }, 'community remote source failed');
    }
    this.states.set(url, state);
  }

  /** Re-validates every remote item and stamps it as federated. Invalid items are dropped. */
  private static adopt(
    url: string,
    items: z.infer<typeof RemoteItemSchema>[]
  ): CommunityItemPublic[] {
    const origin = new URL(url).host;
    const prefix = `remote:${hmac(url).slice(0, 8)}:`;
    const adopted: CommunityItemPublic[] = [];
    for (const item of items) {
      try {
        const id = prefix + item.id;
        let payload = validateCommunityPayload(item.kind, item.payload).payload;
        if (item.kind === 'template') {
          const template = payload as Template;
          payload = {
            ...template,
            metadata: {
              ...template.metadata,
              id,
              version: item.version,
              tags: item.tags,
              source: 'community',
            },
          };
        }
        adopted.push({
          id,
          kind: item.kind,
          name: item.name,
          description: item.description,
          author: item.author,
          version: item.version,
          tags: item.tags,
          payload,
          likes: item.likes,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          federated: true,
          origin,
        });
      } catch (err) {
        logger.warn(
          {
            url,
            id: item.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'dropped invalid remote community item'
        );
      }
    }
    return adopted;
  }
}
