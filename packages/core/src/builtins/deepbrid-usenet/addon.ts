import pLimit from 'p-limit';
import { z } from 'zod';
import { ParsedId } from '../../utils/id-parser.js';
import {
  constants,
  createLogger,
  decodeSignedPayload,
  decryptString,
  encodeSignedPayload,
  encryptString,
} from '../../utils/index.js';
import { IdParser } from '../../utils/id-parser.js';
import { config as appConfig } from '../../config/index.js';
import { Stream } from '../../db/index.js';
import {
  BaseDebridAddon,
  BaseDebridConfigSchema,
  SearchMetadata,
} from '../base/debrid.js';
import { Torrent, NZB } from '../../debrid/index.js';
import { buildNewshostingQueries } from '../newshosting-indexer/addon.js';
import {
  NewshostingMediaMetadata,
  NewshostingMediaRequest,
  parseNewshostingRelease,
  scoreNewshostingReleaseMatch,
} from '../newshosting-indexer/release.js';
import {
  DeepbridApiError,
  DeepbridFinderClient,
  DeepbridFinderFile,
  DeepbridFinderResult,
  isDeepbridArchiveName,
  isDeepbridHost,
  isDeepbridVideoName,
  validateDeepbridDownloadUrl,
} from './client.js';

const logger = createLogger('deepbrid-usenet');

export const DeepbridUsenetConfigSchema = BaseDebridConfigSchema.extend({
  apiKey: z.string().trim().min(16).max(512),
  maxResults: z.number().int().min(1).max(50).default(20),
  maxContentResolves: z.number().int().min(1).max(30).default(15),
  resolveConcurrency: z.number().int().min(1).max(5).default(3),
  timeout: z.number().int().min(1_000).max(120_000).default(30_000),
});
export type DeepbridUsenetConfig = z.infer<typeof DeepbridUsenetConfigSchema>;

const CapabilityEnvelopeSchema = z.object({
  v: z.literal(1),
  e: z.string().min(32).max(16_384),
  exp: z.number().int().positive(),
});
const PlaybackPayloadSchema = z.object({
  apiKey: z.string().min(16).max(512),
  url: z.url(),
  filename: z.string().min(1).max(512),
  size: z.number().nonnegative().optional(),
});
export type DeepbridPlaybackPayload = z.infer<typeof PlaybackPayloadSchema>;

export function createDeepbridPlaybackToken(
  payload: DeepbridPlaybackPayload
): string {
  const validated = PlaybackPayloadSchema.parse(payload);
  validateDeepbridDownloadUrl(validated.url);
  const encrypted = encryptString(JSON.stringify(validated));
  if (!encrypted.success || !encrypted.data) {
    throw new Error('Failed to encrypt Deepbrid playback capability.');
  }
  return encodeSignedPayload({
    v: 1,
    e: encrypted.data,
    exp: Math.floor(Date.now() / 1_000) + 12 * 60 * 60,
  });
}

export function decodeDeepbridPlaybackToken(
  token: string
): DeepbridPlaybackPayload {
  const envelope = CapabilityEnvelopeSchema.parse(decodeSignedPayload(token));
  if (envelope.exp < Math.floor(Date.now() / 1_000)) {
    throw new Error('Deepbrid playback capability expired.');
  }
  const decrypted = decryptString(envelope.e);
  if (!decrypted.success || !decrypted.data)
    throw new Error('Invalid Deepbrid playback capability.');
  const payload = PlaybackPayloadSchema.parse(JSON.parse(decrypted.data));
  validateDeepbridDownloadUrl(payload.url);
  return payload;
}

function metadataForSearch(metadata: SearchMetadata): NewshostingMediaMetadata {
  const aliases = [metadata.primaryTitle, ...(metadata.titles || [])].filter(
    (value): value is string => Boolean(value)
  );
  return {
    title: metadata.primaryTitle || aliases[0],
    aliases: [...new Set(aliases)],
    year: metadata.year,
    countries: metadata.country ? [metadata.country] : [],
    isAnime: metadata.isAnime,
  };
}

function mediaForSearch(parsedId: ParsedId): NewshostingMediaRequest {
  const series =
    parsedId.mediaType !== 'movie' ||
    Boolean(parsedId.season || parsedId.episode);
  return {
    type: series ? 'series' : 'movie',
    season: parsedId.season ? Number(parsedId.season) : undefined,
    episode: parsedId.episode ? Number(parsedId.episode) : undefined,
  };
}

function categoryFor(
  media: NewshostingMediaRequest,
  anime: boolean | undefined
): string {
  if (anime) return 'c36';
  return media.type === 'movie' ? 'c11' : 'c30';
}

function ageHours(value: string): number | undefined {
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric)
    ? numeric > 10_000_000_000
      ? numeric
      : numeric * 1_000
    : Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.max(0, Math.ceil((Date.now() - timestamp) / 3_600_000))
    : undefined;
}

function rankResult(
  result: DeepbridFinderResult,
  media: NewshostingMediaRequest,
  metadata: NewshostingMediaMetadata
): { score: number; confirmed: boolean } {
  const match = scoreNewshostingReleaseMatch(
    result.title,
    media,
    parseNewshostingRelease(result.title),
    metadata
  );
  let score = match.score + Math.min(200, result.sources * 10);
  if (
    /\b(?:2160p|1080p|720p|4k|uhd|web-?dl|webrip|blu-?ray|remux|hdtv)\b/i.test(
      result.title
    )
  )
    score += 120;
  if (
    /\b(?:sample|trailer|cam|telesync|screener|password|encrypted)\b/i.test(
      result.title
    )
  )
    score -= 1000;
  return {
    score,
    confirmed: match.score >= (media.type === 'series' ? 650 : 600),
  };
}

export function chooseDeepbridVideoFiles(
  files: DeepbridFinderFile[],
  media: NewshostingMediaRequest
): DeepbridFinderFile[] {
  const videos = files.filter(
    (file) =>
      isDeepbridVideoName(file.name) &&
      !/(?:^|[._ -])(?:sample|trailer|proof)(?:[._ -]|$)/i.test(file.name)
  );
  if (media.type !== 'series' || !media.season || !media.episode) return videos;
  const code = new RegExp(
    `(?:s0*${media.season}[._ -]*e0*${media.episode}|${media.season}x0*${media.episode})(?:\\D|$)`,
    'i'
  );
  const exact = videos.filter((file) => code.test(file.name));
  return exact.length ? exact : videos.length === 1 ? videos : [];
}

export class DeepbridUsenetAddon extends BaseDebridAddon<DeepbridUsenetConfig> {
  readonly id = 'deepbrid-usenet';
  readonly name = 'Deepbrid Usenet';
  readonly version = '1.0.0';
  readonly logger = logger;

  constructor(config: DeepbridUsenetConfig, clientIp?: string) {
    super(config, DeepbridUsenetConfigSchema, clientIp);
  }

  override async getStreams(type: string, id: string): Promise<Stream[]> {
    const parsedId = IdParser.parse(id, type);
    if (!parsedId || !this.supportedIdTypes.includes(parsedId.type))
      throw new Error(`Unsupported ID: ${id}`);
    this._searchMetadataPromise = this._getSearchMetadata(parsedId, type);
    const metadata = metadataForSearch(await this.getSearchMetadata());
    const media = mediaForSearch(parsedId);
    const queries = buildNewshostingQueries(metadata, media).slice(0, 2);
    if (!queries.length) return [];

    const client = new DeepbridFinderClient(
      this.userData.apiKey,
      this.userData.timeout
    );
    const searched = await Promise.allSettled(
      queries.map((query) =>
        client.search(query, {
          category: categoryFor(media, metadata.isAnime),
          limit: 50,
        })
      )
    );
    const seen = new Set<string>();
    const ranked = searched
      .flatMap((entry) => (entry.status === 'fulfilled' ? entry.value : []))
      .filter((item) => !seen.has(item.token) && seen.add(item.token))
      .map((result) => ({ result, ...rankResult(result, media, metadata) }))
      .filter((item) => item.confirmed && item.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.result.sources - a.result.sources ||
          b.result.size - a.result.size
      )
      .slice(0, this.userData.maxContentResolves);

    const limit = pLimit(this.userData.resolveConcurrency);
    const resolved = await Promise.all(
      ranked.map((item) =>
        limit(async () => {
          try {
            let content = await client.getContent(item.result.token, false);
            if (content.hasPassword) return [];
            if (
              content.files.some((file) => isDeepbridArchiveName(file.name))
            ) {
              content = await client.getContent(item.result.token, true);
            }
            return chooseDeepbridVideoFiles(content.files, media).map(
              (file) => ({ ...item, file })
            );
          } catch (error) {
            if (error instanceof DeepbridApiError && error.code === 'api_12')
              return [];
            logger.debug(
              { error: error instanceof Error ? error.message : String(error) },
              'Deepbrid content resolution failed'
            );
            return [];
          }
        })
      )
    );

    const base = appConfig.bootstrap.baseUrl.replace(/\/+$/, '');
    return resolved
      .flat()
      .slice(0, this.userData.maxResults)
      .map(({ result, file }) => {
        const target = validateDeepbridDownloadUrl(file.link);
        const playbackUrl = isDeepbridHost(target.hostname)
          ? `${base}/builtins/deepbrid-usenet/play/${createDeepbridPlaybackToken(
              {
                apiKey: this.userData.apiKey,
                url: target.toString(),
                filename: file.name,
                size: file.size || undefined,
              }
            )}/${encodeURIComponent(file.name)}`
          : target.toString();
        return {
          name: '[DB⚡] Deepbrid Usenet',
          title: result.title,
          description: `${result.title}\n${file.name}\n🔍 Deepbrid Usenet${result.sources ? ` · ${result.sources} sources` : ''}`,
          url: playbackUrl,
          type: 'usenet',
          idMatched: true,
          age: ageHours(result.date),
          behaviorHints: {
            notWebReady: false,
            filename: file.name,
            videoSize: file.size || result.size || undefined,
            bingeGroup: `deepbrid-usenet|${file.name.toLowerCase()}`,
          },
        } satisfies Stream;
      });
  }

  protected async _searchTorrents(_parsedId: ParsedId): Promise<Torrent[]> {
    return [];
  }
  protected async _searchNzbs(_parsedId: ParsedId): Promise<NZB[]> {
    return [];
  }
}
