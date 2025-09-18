import { z } from 'zod';
import { BuiltinDebridServices } from '../../debrid/utils.js';

const TorBoxApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  detail: z.string().optional(),
  message: z.string().optional(),
  data: z.null(),
});

const TorBoxApiSuccessResponseSchema = <T>(dataSchema: z.ZodSchema<T>) =>
  z.object({
    success: z.literal(true),
    message: z.string().optional(),
    detail: z.string().optional(),
    data: z.union([z.null(), dataSchema]),
  });

export const TorBoxApiResponseSchema = <T>(dataSchema: z.ZodSchema<T>) =>
  z.union([
    TorBoxApiErrorResponseSchema,
    TorBoxApiSuccessResponseSchema(dataSchema),
  ]);

const TorBoxSearchApiMetadataSchema = z.object({
  globalID: z.string(),
  title: z.string(),
  titles: z.array(z.string()),
  imdb_id: z.string().nullable(),
  tmdb_id: z.number().nullable(),
});

const TorBoxSearchApiResultSchema = z.object({
  hash: z.string(),
  raw_title: z.string(),
  title: z.string(),
  title_parsed_data: z.object({
    resolution: z.string().optional(),
    quality: z.string().optional(),
    year: z.number().optional(),
    codec: z.string().optional(),
    audio: z.string().optional(),
    bitDepth: z.number().optional(),
    hdr: z.boolean().optional(),
    title: z.string().optional(),
    encoder: z.string().optional(),
    site: z.string().optional(),
  }),
  magnet: z.union([z.string(), z.null()]),
  torrent: z.union([z.string(), z.null()]).optional(),
  last_known_seeders: z.number(),
  last_known_peers: z.number(),
  size: z.coerce.number(),
  tracker: z.string(),
  categories: z
    .union([z.array(z.union([z.string(), z.number()])), z.null()])
    .optional(),
  files: z.coerce.number(),
  type: z.union([z.literal('torrent'), z.literal('usenet')]),
  nzb: z.union([z.string(), z.null()]),
  age: z.string(),
  user_search: z.boolean(),
  cached: z.boolean().optional(),
  owned: z.boolean().optional(),
});

export const TorBoxSearchApiDataSchema = z.object({
  metadata: TorBoxSearchApiMetadataSchema.nullable().optional(),
  torrents: z.array(TorBoxSearchApiResultSchema).nullable().optional(),
  nzbs: z.array(TorBoxSearchApiResultSchema).nullable().optional(),
});

export const TorBoxApiUsenetDownloadSchema = z.object({
  hash: z.string(),
  usenetdownload_id: z.number(),
  auth_id: z.string(),
});

export const TorBoxApiUsenetDownloadLinkSchema = z.string();

export const TorBoxSearchAddonUserDataSchema = z.object({
  torBoxApiKey: z.string(),
  searchUserEngines: z.boolean(),
  onlyShowUserSearchResults: z.boolean(),
  tmdbAccessToken: z.string().optional(),
  sources: z
    .array(z.enum(['torrent', 'usenet']))
    .min(1, 'At least one source must be configured'),
  services: BuiltinDebridServices.min(
    1,
    'At least one service must be configured'
  ),
});
