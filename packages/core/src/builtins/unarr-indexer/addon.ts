import { z } from 'zod';
import { ParsedId } from '../../utils/id-parser.js';
import {
  appConfig,
  constants,
  createLogger,
  getSimpleTextHash,
  makeRequest,
} from '../../utils/index.js';
import { NZB, Torrent, hashNzbUrl } from '../../debrid/index.js';
import {
  BaseDebridAddon,
  BaseDebridConfigSchema,
  SearchMetadata,
} from '../base/debrid.js';
import { BuiltinProxy, createProxy } from '../../proxy/index.js';
import { toUnixSeconds, usenetKey } from '../../release-blocklist/index.js';
import {
  getTorrentClawNzbQuotaStatus,
  TORRENTCLAW_NZB_MONTHLY_LIMIT_BYTES,
} from '../../db/index.js';

const logger = createLogger('unarr-indexer');

const UnarrNzbSearchResultSchema = z.object({
  title: z.string().min(1),
  nzbId: z.string().min(1),
  category: z.string().optional().default(''),
  size: z.number().int().nonnegative().optional().default(0),
  publishedAt: z.string().optional().default(''),
  grabs: z.number().int().nonnegative().optional().default(0),
  group: z.string().optional().default(''),
  poster: z.string().optional().default(''),
  attributes: z.record(z.string(), z.string()).optional().default({}),
});

const UnarrNzbSearchResponseSchema = z.object({
  results: z.array(UnarrNzbSearchResultSchema),
  total: z.number().int().nonnegative().optional().default(0),
  offset: z.number().int().nonnegative().optional().default(0),
});

const UnarrUsenetUsageSchema = z.object({
  usedBytes: z.number().nonnegative().optional().default(0),
  quotaBytes: z.number().nonnegative().optional().default(0),
  percentUsed: z.number().nonnegative().optional().default(0),
  remainingBytes: z.number().optional().default(0),
  quotaResetDate: z.string().optional().default(''),
});

export const UnarrIndexerAddonConfigSchema = BaseDebridConfigSchema.extend({
  apiUrl: z.url().default('https://unarr.app'),
  apiKey: z.string().min(1),
  proxyAuth: z.string().min(1),
  maxResults: z.number().int().min(1).max(100).default(50),
  timeout: z.number().int().min(1_000).max(120_000).default(30_000),
  enforceUnarrQuota: z.boolean().default(true),
});
export type UnarrIndexerAddonConfig = z.infer<
  typeof UnarrIndexerAddonConfigSchema
>;

export interface UnarrSearchParams {
  query?: string;
  imdbId?: string;
  tvdbId?: string;
  season?: number;
  episode?: number;
  limit: number;
}

export function buildUnarrSearchParams(
  parsedId: ParsedId,
  metadata: SearchMetadata,
  limit: number
): UnarrSearchParams {
  const queryTitle = metadata.primaryTitle ?? metadata.titles?.[0];
  const query = queryTitle
    ? `${queryTitle}${metadata.year ? ` ${metadata.year}` : ''}`
    : undefined;
  const imdbId =
    metadata.imdbId ??
    (parsedId.type === 'imdbId' ? String(parsedId.value) : undefined);
  const tvdbId =
    metadata.tvdbId ??
    (parsedId.type === 'thetvdbId' ? String(parsedId.value) : undefined);

  return {
    ...(query ? { query } : {}),
    ...(imdbId ? { imdbId } : {}),
    ...(tvdbId ? { tvdbId: String(tvdbId) } : {}),
    ...(parsedId.season ? { season: Number(parsedId.season) } : {}),
    ...(parsedId.episode ? { episode: Number(parsedId.episode) } : {}),
    limit,
  };
}

export function validateUnarrApiUrl(value: string): string {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') {
    throw new Error('Unarr API URL must use HTTPS');
  }
  if (hostname !== 'unarr.app' && !hostname.endsWith('.unarr.app')) {
    throw new Error('Unarr index-only mode only accepts unarr.app API hosts');
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export class UnarrIndexerAddon extends BaseDebridAddon<UnarrIndexerAddonConfig> {
  readonly name = 'TorrentClaw Unarr';
  readonly version = '1.0.0';
  readonly id = 'unarr-indexer';
  readonly logger = logger;
  private readonly apiUrl: string;

  constructor(userData: UnarrIndexerAddonConfig, clientIp?: string) {
    super(userData, UnarrIndexerAddonConfigSchema, clientIp);
    this.apiUrl = validateUnarrApiUrl(this.userData.apiUrl);
    BuiltinProxy.validateAuth(this.userData.proxyAuth);

    const supported = new Set([
      constants.TORBOX_SERVICE,
      constants.NZBDAV_SERVICE,
      constants.ALTMOUNT_SERVICE,
      constants.STREMIO_NNTP_SERVICE,
      constants.STREMTHRU_NEWZ_SERVICE,
      constants.AIOSTREAMS_SERVICE,
    ]);
    if (this.userData.services.some((service) => !supported.has(service.id))) {
      throw new Error('Unarr index-only mode only supports Usenet services');
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.userData.apiKey}`,
      'User-Agent': 'AIOStreams TorrentClaw Unarr index-only mode',
    };
  }

  private async requestJson(
    path: string,
    init?: { method?: string; body?: unknown }
  ) {
    const response = await makeRequest(`${this.apiUrl}${path}`, {
      method: init?.method ?? 'GET',
      timeout: this.userData.timeout,
      headers: {
        ...this.headers(),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Unarr API key was rejected');
      }
      if (response.status === 429) {
        throw new Error('Unarr rate limit reached; try again later');
      }
      throw new Error(`Unarr API request failed (${response.status})`);
    }
    return response.json();
  }

  private async effectiveRemainingBytes(): Promise<number> {
    const local = await getTorrentClawNzbQuotaStatus();
    let remaining = local.remainingBytes;
    if (!this.userData.enforceUnarrQuota) return remaining;

    try {
      const usage = UnarrUsenetUsageSchema.parse(
        await this.requestJson('/api/internal/agent/usenet-usage')
      );
      if (usage.quotaBytes > 0) {
        remaining = Math.min(remaining, Math.max(0, usage.remainingBytes));
      }
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : 'unknown error',
        },
        'Unarr usage lookup failed; enforcing the local 200 GiB ceiling'
      );
    }
    return remaining;
  }

  protected async _searchNzbs(parsedId: ParsedId): Promise<NZB[]> {
    const [metadata, remainingBytes] = await Promise.all([
      this.getSearchMetadata(),
      this.effectiveRemainingBytes(),
    ]);
    if (remainingBytes <= 0) {
      throw new Error('TorrentClaw Unarr monthly NZB quota is exhausted');
    }

    const params = buildUnarrSearchParams(
      parsedId,
      metadata,
      this.userData.maxResults
    );
    const search = UnarrNzbSearchResponseSchema.parse(
      await this.requestJson('/api/internal/agent/nzb-search', {
        method: 'POST',
        body: params,
      })
    );

    const results = search.results
      .filter((result) => result.size > 0 && result.size <= remainingBytes)
      .slice(0, this.userData.maxResults);
    if (!results.length) return [];

    const proxy = createProxy({
      id: constants.BUILTIN_SERVICE,
      url: appConfig.bootstrap.baseUrl,
      credentials: this.userData.proxyAuth,
    });
    const proxiedUrls = await proxy.generateUrls(
      results.map((result) => {
        const downloadUrl = new URL(
          '/api/internal/agent/nzb-download',
          `${this.apiUrl}/`
        );
        downloadUrl.searchParams.set('nzbId', result.nzbId);
        return {
          url: downloadUrl.toString(),
          filename: `${result.title}.nzb`,
          type: 'nzb' as const,
          headers: { request: this.headers() },
        };
      }),
      true
    );
    if (!proxiedUrls || 'error' in proxiedUrls) {
      throw new Error('Failed to create secure Unarr NZB proxy URLs');
    }

    return results.map((result, index) => {
      const published = Date.parse(result.publishedAt);
      const age = Number.isFinite(published)
        ? Math.ceil(Math.abs(Date.now() - published) / 3_600_000)
        : 0;
      const stableId = getSimpleTextHash(`unarr:${result.nzbId}`);
      const nzb: NZB = {
        type: 'usenet',
        confirmed: Boolean(params.imdbId || params.tvdbId),
        title: result.title,
        hash: hashNzbUrl(`unarr:${stableId}`),
        nzb: proxiedUrls[index],
        size: result.size,
        age,
        indexer: 'TorrentClaw / Unarr',
        quotaReservationKey: stableId,
        quotaBytes: result.size,
      };
      const releaseKey = usenetKey(
        result.size,
        result.poster || null,
        toUnixSeconds(result.publishedAt)
      );
      if (releaseKey) nzb.releaseKey = releaseKey;
      return nzb;
    });
  }

  protected async _searchTorrents(_parsedId: ParsedId): Promise<Torrent[]> {
    return [];
  }
}

export const UNARR_MONTHLY_LIMIT_BYTES = TORRENTCLAW_NZB_MONTHLY_LIMIT_BYTES;
