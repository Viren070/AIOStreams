import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ParsedId } from '../../utils/id-parser.js';
import {
  appConfig,
  constants,
  createLogger,
  getSimpleTextHash,
  makeRequest,
} from '../../utils/index.js';
import {
  NZB,
  NZBWithSelectedFile,
  Torrent,
  TorrentWithSelectedFile,
  hashNzbUrl,
} from '../../debrid/index.js';
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
import type { Stream } from '../../db/index.js';
import type { BuiltinServiceId } from '../../utils/index.js';

const logger = createLogger('unarr-indexer');

const UnarrNzbSearchResultSchema = z.object({
  title: z.string().min(1).max(500),
  nzbId: z.string().min(1),
  category: z.string().optional().default(''),
  size: z.number().int().nonnegative().optional().default(0),
  publishedAt: z.string().optional().default(''),
  grabs: z.number().int().nonnegative().optional().default(0),
  group: z.string().optional().default(''),
  poster: z.string().optional().default(''),
  attributes: z
    .record(z.string().max(100), z.string().max(500))
    .optional()
    .default({}),
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

const UnarrAccountSchema = z.object({
  plan: z.string().optional().default(''),
  isPro: z.boolean().optional().default(false),
  trialActive: z.boolean().optional().default(false),
  trialDaysLeft: z.number().int().nonnegative().optional().default(0),
});

const UnarrAuthKeyExchangeSchema = z.object({
  apiKey: z.string().startsWith('tc_'),
  userId: z.string().optional(),
  apiUrl: z.string().optional(),
});

export const UnarrConnectInputSchema = z.object({
  apiUrl: z.string().default('https://unarr.app'),
  credential: z.string().trim().min(1).max(512),
});

export interface UnarrConnectResult {
  apiUrl: string;
  apiKey: string;
  account: {
    plan: string;
    isPro: boolean;
    trialActive: boolean;
    trialDaysLeft: number;
  };
  exchanged: boolean;
}

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

async function unarrJsonRequest(
  url: string,
  options: {
    method?: string;
    apiKey?: string;
    body?: unknown;
    timeout?: number;
  } = {}
): Promise<unknown> {
  const response = await makeRequest(url, {
    method: options.method ?? 'GET',
    timeout: options.timeout ?? 20_000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'AIOStreams TorrentClaw Unarr connection',
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Unarr rejected this credential');
    }
    if (response.status === 409) {
      throw new Error(
        'This Unarr one-time auth key is expired, used, or revoked. Generate a new one.'
      );
    }
    if (response.status === 429) {
      throw new Error('Unarr rate limit reached; try again later');
    }
    throw new Error(`Unarr connection failed (${response.status})`);
  }
  return response.json();
}

/**
 * Validate a durable tc_ key or exchange a single-use unarr-authkey- value.
 * The caller must persist only the returned apiKey, never the one-time input.
 */
export async function connectUnarr(
  input: z.input<typeof UnarrConnectInputSchema>
): Promise<UnarrConnectResult> {
  const parsed = UnarrConnectInputSchema.parse(input);
  let apiUrl = validateUnarrApiUrl(parsed.apiUrl);
  let apiKey = parsed.credential;
  let exchanged = false;

  if (apiKey.startsWith('unarr-authkey-')) {
    const exchange = UnarrAuthKeyExchangeSchema.parse(
      await unarrJsonRequest(`${apiUrl}/api/internal/agent/authkey/exchange`, {
        method: 'POST',
        body: {
          authKey: apiKey,
          agentId: randomUUID(),
          hostname: 'aiostreams-unarr-indexer',
          platform: 'aiostreams/index-only',
        },
      })
    );
    apiKey = exchange.apiKey;
    if (exchange.apiUrl) apiUrl = validateUnarrApiUrl(exchange.apiUrl);
    exchanged = true;
  } else if (!apiKey.startsWith('tc_')) {
    throw new Error(
      'Use an Unarr API key beginning with tc_ or a one-time key beginning with unarr-authkey-'
    );
  }

  const account = UnarrAccountSchema.parse(
    await unarrJsonRequest(`${apiUrl}/api/internal/agent/me`, { apiKey })
  );
  return {
    apiUrl,
    apiKey,
    account,
    exchanged,
  };
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
        group: result.group || undefined,
        indexer: 'TorrentClaw / Unarr',
        quotaReservationKey: stableId,
        quotaBytes: result.size,
        unarr: {
          grabs: result.grabs,
          category: result.category || undefined,
          group: result.group || undefined,
          publishedAt: result.publishedAt || undefined,
          attributes: result.attributes,
        },
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

  protected override _createStream(
    torrentOrNzb: TorrentWithSelectedFile | NZBWithSelectedFile,
    metadataId: string,
    encryptedStoreAuths: Record<BuiltinServiceId, string | string[]>
  ): Stream {
    const stream = super._createStream(
      torrentOrNzb,
      metadataId,
      encryptedStoreAuths
    );
    if (torrentOrNzb.type === 'usenet' && torrentOrNzb.unarr) {
      stream.unarr = torrentOrNzb.unarr;
      const badges = [
        'Unarr',
        typeof torrentOrNzb.unarr.grabs === 'number' &&
        torrentOrNzb.unarr.grabs > 0
          ? `${torrentOrNzb.unarr.grabs.toLocaleString('en-US')} grabs`
          : undefined,
        torrentOrNzb.unarr.category,
      ].filter((value): value is string => Boolean(value));
      stream.description = [stream.description, `🦞 ${badges.join(' · ')}`]
        .filter(Boolean)
        .join('\n');
    }
    return stream;
  }
}

export const UNARR_MONTHLY_LIMIT_BYTES = TORRENTCLAW_NZB_MONTHLY_LIMIT_BYTES;
