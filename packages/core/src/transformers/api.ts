import {
  ParsedFileSchema,
  ParsedStream,
  Resource,
  SourceSchema,
  SubtitleSchema,
  UserData,
} from '../db/index.js';
import { AIOStreamsResponse } from '../main.js';
import { generateBingeGroup } from './utils.js';

export interface SearchApiResponseData {
  results: SearchApiResult[];
  filtered: number;
  errors: {
    title: string;
    description: string;
  }[];
}

import { z } from 'zod';

const SearchApiResultSchema = z.object({
  infoHash: z.string().nullable(),
  seeders: z.number().nullable(),
  age: z.number().nullable(),
  sources: z.array(z.string()).nullable(),
  ytId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  fileIdx: z.number().nullable(),
  url: z.string().nullable(),
  nzbUrl: z.string().nullable(),
  rarUrls: z.array(SourceSchema).nullable(),
  '7zipUrls': z.array(SourceSchema).nullable(),
  zipUrls: z.array(SourceSchema).nullable(),
  tarUrls: z.array(SourceSchema).nullable(),
  tgzUrls: z.array(SourceSchema).nullable(),
  proxied: z.boolean(),
  filename: z.string().nullable(),
  folderName: z.string().nullable(),
  size: z.number().nullable(),
  folderSize: z.number().nullable(),
  message: z.string().nullable(),
  library: z.boolean(),
  type: z.string(),
  indexer: z.string().nullable(),
  addon: z.string().nullable(),
  duration: z.number().nullable(),
  bitrate: z.number().nullable(),
  videoHash: z.string().nullable(),
  subtitles: z.array(SubtitleSchema),
  countryWhitelist: z.array(z.string()),
  requestHeaders: z.partialRecord(z.string(), z.string()),
  responseHeaders: z.partialRecord(z.string(), z.string()),
  parsedFile: ParsedFileSchema.optional(),
  service: z.string().nullable(),
  cached: z.boolean().nullable(),
  servers: z.array(z.string()).nullable(),
  notWebReady: z.boolean().nullable(),
  bingeGroup: z.string().nullable(),
  private: z.boolean().nullable(),
  seadexBest: z.boolean().nullable(),
  seadex: z.boolean().nullable(),
});

export type SearchApiResult = z.infer<typeof SearchApiResultSchema>;

export type SearchApiResultField = keyof SearchApiResult;
export const SearchApiResultField = z.keyof(SearchApiResultSchema);

export class ApiTransformer {
  constructor(private readonly userData: UserData) {}

  async transformStreams(
    response: AIOStreamsResponse<{
      streams: ParsedStream[];
      statistics: { title: string; description: string }[];
    }>,
    requiredFields: SearchApiResultField[]
  ): Promise<SearchApiResponseData> {
    const { data, errors } = response;
    let filteredCount = 0;
    const results: SearchApiResult[] = data.streams
      .map((stream: ParsedStream, index: number) => ({
        infoHash: stream.torrent?.infoHash ?? null,
        url: stream.url ?? null,
        nzbUrl: stream.nzbUrl ?? null,
        rarUrls: stream.rarUrls ?? null,
        '7zipUrls': stream['7zipUrls'] ?? null,
        zipUrls: stream.zipUrls ?? null,
        tarUrls: stream.tarUrls ?? null,
        tgzUrls: stream.tgzUrls ?? null,
        seeders: stream.torrent?.seeders ?? null,
        age: stream.age ?? null,
        sources: stream.torrent?.sources ?? null,
        ytId: stream.ytId ?? null,
        externalUrl: stream.externalUrl ?? null,
        fileIdx: stream.torrent?.fileIdx ?? null,
        proxied: stream.proxied ?? false,
        filename: stream.filename ?? null,
        folderName: stream.folderName ?? null,
        size: stream.size ?? null,
        folderSize: stream.folderSize ?? null,
        message: stream.message ?? null,
        library: stream.library ?? false,
        addon: stream.addon.name ?? null,
        type: stream.type ?? '',
        indexer: stream.indexer ?? null,
        duration: stream.duration ?? null,
        bitrate: stream.bitrate ?? null,
        videoHash: stream.videoHash ?? null,
        subtitles: stream.subtitles ?? [],
        countryWhitelist: stream.countryWhitelist ?? [],
        requestHeaders: stream.requestHeaders ?? {},
        responseHeaders: stream.responseHeaders ?? {},
        parsedFile: stream.parsedFile,
        service: stream.service?.id ?? null,
        cached: stream.service?.cached ?? null,
        servers: stream.servers ?? null,
        notWebReady: stream.notWebReady ?? null,
        bingeGroup: generateBingeGroup(stream, index, this.userData) ?? null,
        private: stream.torrent?.private ?? null,
        seadexBest: stream.seadex?.isBest ?? null,
        seadex: stream.seadex?.isSeadex ?? null,
      }))
      ?.filter((result) => {
        const hasRequiredFields = requiredFields.every(
          (field) => result[field] !== null
        );
        if (!hasRequiredFields) {
          filteredCount++;
        }
        return hasRequiredFields;
      });

    return {
      filtered: filteredCount,
      results,
      errors: errors.map((error) => ({
        title: error.title ?? '',
        description: error.description ?? '',
      })),
    };
  }
}
