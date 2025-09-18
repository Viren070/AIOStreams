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

const BasePlaybackInfoSchema = z.object({
  // hash: z.string(),
  title: z.string().optional(),
  metadata: z
    .object({
      titles: z.array(z.string()),
      season: z.number().optional(),
      episode: z.number().optional(),
      absoluteEpisode: z.number().optional(),
    })
    .optional(),
  file: DebridFileSchema.optional(),
});

const TorrentPlaybackInfoSchema = BasePlaybackInfoSchema.extend({
  hash: z.string(),
  sources: z.array(z.string()),
  // magnet: z.string().optional(),
  type: z.literal('torrent'),
});

const UsenetPlaybackInfoSchema = BasePlaybackInfoSchema.extend({
  hash: z.string(),
  nzb: z.string(),
  type: z.literal('usenet'),
});

export const PlaybackInfoSchema = z.discriminatedUnion('type', [
  TorrentPlaybackInfoSchema,
  UsenetPlaybackInfoSchema,
]);

export const ServiceAuthSchema = z.object({
  id: z.enum(constants.BUILTIN_SUPPORTED_SERVICES),
  credential: z.string(),
});
export type ServiceAuth = z.infer<typeof ServiceAuthSchema>;

export type PlaybackInfo = z.infer<typeof PlaybackInfoSchema>;

export interface DebridService {
  // Common methods
  resolve(
    playbackInfo: PlaybackInfo,
    filename: string
  ): Promise<string | undefined>;

  // Torrent specific methods
  checkMagnets(magnets: string[], sid?: string): Promise<DebridDownload[]>;
  addMagnet(magnet: string): Promise<DebridDownload>;
  generateTorrentLink(link: string, clientIp?: string): Promise<string>;

  // Usenet specific methods
  checkNzbs?(nzbs: string[]): Promise<DebridDownload[]>;
  addNzb?(nzb: string, name: string): Promise<DebridDownload>;
  generateUsenetLink?(
    downloadId: string,
    fileId?: string,
    clientIp?: string
  ): Promise<string>;

  // Service info
  readonly serviceName: ServiceId;
  readonly supportsUsenet: boolean;
}

export type DebridServiceConfig = {
  token: string;
  clientIp?: string;
};
