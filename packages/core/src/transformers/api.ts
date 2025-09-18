import { ParsedStream, Resource, Subtitle, UserData } from '../db/index.js';
import { AIOStreamsResponse } from '../main.js';

export interface ApiSearchResponseData {
  results: ApiSearchResult[];
  errors: {
    title: string;
    description: string;
  }[];
}

interface ApiSearchResult {
  infoHash: string | null;
  seeders: number | null;
  age: string | null;
  sources: string[] | null;
  ytId: string | null;
  externalUrl: string | null;
  fileIdx: number | null;
  url: string | null;
  proxied: boolean;
  filename: string | null;
  folderName: string | null;
  size: number | null;
  folderSize: number | null;
  message: string | null;
  library: boolean;
  type: string;
  indexer: string | null;
  addon: string | null;
  duration: number | null;
  videoHash: string | null;
  subtitles: Subtitle[];
  countryWhitelist: string[];
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
}

export class ApiTransformer {
  constructor(private readonly userData: UserData) {}

  async transformStreams(
    response: AIOStreamsResponse<{
      streams: ParsedStream[];
      statistics: { title: string; description: string }[];
    }>
  ): Promise<ApiSearchResponseData> {
    const { data, errors } = response;
    const results: ApiSearchResult[] = data.streams.map((stream) => ({
      infoHash: stream.torrent?.infoHash ?? null,
      url: stream.url ?? null,
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
      videoHash: stream.videoHash ?? null,
      subtitles: stream.subtitles ?? [],
      countryWhitelist: stream.countryWhitelist ?? [],
      requestHeaders: stream.requestHeaders ?? {},
      responseHeaders: stream.responseHeaders ?? {},
    }));
    return {
      results,
      errors: errors.map((error) => ({
        title: error.title ?? '',
        description: error.description ?? '',
      })),
    };
  }
}
