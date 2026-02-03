import { z } from 'zod';
import { constants, ServiceId } from '../utils/index.js';

type DebridErrorCode =
  | 'BAD_GATEWAY'
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'GONE'
  | 'INTERNAL_SERVER_ERROR'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED'
  | 'PAYMENT_REQUIRED'
  | 'PROXY_AUTHENTICATION_REQUIRED'
  | 'SERVICE_UNAVAILABLE'
  | 'STORE_LIMIT_EXCEEDED'
  | 'STORE_MAGNET_INVALID'
  | 'TOO_MANY_REQUESTS'
  | 'UNAUTHORIZED'
  | 'UNAVAILABLE_FOR_LEGAL_REASONS'
  | 'UNKNOWN'
  | 'UNPROCESSABLE_ENTITY'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'NO_MATCHING_FILE';
type DebridErrorType =
  | 'api_error'
  | 'store_error'
  | 'unknown_error'
  | 'upstream_error';

export class DebridError extends Error {
  body?: unknown;
  code?: DebridErrorCode = 'UNKNOWN';
  headers: Record<string, string>;
  statusCode: number;
  statusText: string;
  cause?: unknown;
  type?: DebridErrorType = 'unknown_error';
  constructor(
    message: string,
    options: Pick<
      DebridError,
      'body' | 'code' | 'headers' | 'statusCode' | 'statusText' | 'type'
    > & { cause?: unknown }
  ) {
    super(message);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    if (options?.cause) {
      this.cause = options.cause;
      delete options.cause;
    }

    if (options.body) {
      this.body = options.body;
    }

    this.headers = options.headers;
    this.statusCode = options.statusCode;
    this.statusText = options.statusText;

    if (options.type) {
      this.type = options.type;
    }
    if (options.code) {
      this.code = options.code;
    }
  }
}

const DebridFileSchema = z.object({
  id: z.number().optional(),
  name: z.string().optional(),
  size: z.number(),
  mimeType: z.string().optional(),
  link: z.string().optional(),
  path: z.string().optional(),
  index: z.number().optional(),
});

export type DebridFile = z.infer<typeof DebridFileSchema>;

export interface DebridDownload {
  id: string | number;
  library?: boolean;
  hash?: string;
  name?: string;
  size?: number;
  status:
    | 'cached'
    | 'downloaded'
    | 'downloading'
    | 'failed'
    | 'invalid'
    | 'processing'
    | 'queued'
    | 'unknown'
    | 'uploading';
  files?: DebridFile[];
}

const TitleMetadataSchema = z.object({
  titles: z.array(z.string()),
  year: z.number().optional(),
  season: z.number().optional(),
  episode: z.number().optional(),
  absoluteEpisode: z.number().optional(),
});

const BasePlaybackInfoSchema = z.object({
  // title: z.string().optional(),
  metadata: TitleMetadataSchema.optional(),
  filename: z.string().optional(),
  index: z.number().optional(),
});

const BaseFileInfoSchema = z.object({
  index: z.number().optional(),
  cacheAndPlay: z.boolean().optional(),
  autoRemoveDownloads: z.boolean().optional(),
});

const TorrentInfoSchema = BaseFileInfoSchema.extend({
  downloadUrl: z.string().optional(),
  hash: z.string(),
  private: z.boolean().optional(),
  sources: z.array(z.string()),
  type: z.literal('torrent'),
});

const TorrentPlaybackInfoSchema =
  BasePlaybackInfoSchema.merge(TorrentInfoSchema);

const UsenetInfoSchema = BaseFileInfoSchema.extend({
  hash: z.string(),
  easynewsUrl: z.string().optional(),
  nzb: z.string(),
  type: z.literal('usenet'),
});

const UsenetPlaybackInfoSchema = BasePlaybackInfoSchema.merge(UsenetInfoSchema);

export const PlaybackInfoSchema = z.discriminatedUnion('type', [
  TorrentPlaybackInfoSchema,
  UsenetPlaybackInfoSchema,
]);

export const FileInfoSchema = z.discriminatedUnion('type', [
  TorrentInfoSchema,
  UsenetInfoSchema,
]);

export const ServiceAuthSchema = z.object({
  id: z.enum(constants.BUILTIN_SUPPORTED_SERVICES),
  credential: z.string(),
});
export type ServiceAuth = z.infer<typeof ServiceAuthSchema>;

export type PlaybackInfo = z.infer<typeof PlaybackInfoSchema>;
export type FileInfo = z.infer<typeof FileInfoSchema>;
export type TitleMetadata = z.infer<typeof TitleMetadataSchema>;

export interface DebridService {
  // Common methods
  resolve(
    playbackInfo: PlaybackInfo,
    filename: string,
    cacheAndPlay: boolean,
    autoRemoveDownloads?: boolean
  ): Promise<string | undefined>;

  // Torrent specific methods
  checkMagnets(magnets: string[], sid?: string): Promise<DebridDownload[]>;
  listMagnets(): Promise<DebridDownload[]>;
  addMagnet(magnet: string): Promise<DebridDownload>;
  addTorrent(torrent: string): Promise<DebridDownload>;
  generateTorrentLink(link: string, clientIp?: string): Promise<string>;

  // Usenet specific methods
  checkNzbs?(
    nzbs: { name?: string; hash?: string }[],
    checkOwned?: boolean
  ): Promise<DebridDownload[]>;
  listNzbs?(id?: string): Promise<DebridDownload[]>;
  addNzb?(nzb: string, name: string): Promise<DebridDownload>;
  generateUsenetLink?(
    downloadId: string,
    fileId?: string,
    clientIp?: string
  ): Promise<string>;
  removeMagnet?(magnetId: string): Promise<void>;
  removeNzb?(nzbId: string): Promise<void>;

  // Service info
  readonly serviceName: ServiceId;
  readonly supportsUsenet: boolean;
}

export type DebridServiceConfig = {
  token: string;
  clientIp?: string;
};
