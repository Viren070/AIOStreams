import { constants, Env } from '../index.js';
import {
  Meta,
  MetaPreview,
  ParsedStream,
  Resource,
  AIOStream,
  Subtitle,
  UserData,
  AddonCatalog,
  Stream,
  AddonCatalogResponse,
  AIOStreamResponse,
  SubtitleResponse,
  MetaResponse,
  CatalogResponse,
  StreamResponse,
  ParsedMeta,
} from '../db/index.js';
import { createFormatter, FormatterContext } from '../formatters/index.js';
import { AIOStreamsError, AIOStreamsResponse } from '../main.js';
import { Cache, createLogger, getTimeTakenSincePoint } from '../utils/index.js';
import { generateBingeGroup } from './utils.js';

type ErrorOptions = {
  errorTitle?: string;
  errorDescription?: string;
  errorUrl?: string;
};

const logger = createLogger('stremio');

export class StremioTransformer {
  constructor(private readonly userData: UserData) {}

  public showError(resource: Resource, errors: AIOStreamsError[]) {
    if (
      errors.length > 0 &&
      !this.userData.hideErrors &&
      !this.userData.hideErrorsForResources?.includes(resource)
    ) {
      return true;
    }
    return false;
  }

  private async convertParsedStreamToStream(
    stream: ParsedStream,
    formatter: {
      format: (
        stream: ParsedStream
      ) => Promise<{ name: string; description: string }>;
    },
    index: number,
    options?: { disableAutoplay?: boolean; provideStreamData?: boolean }
  ): Promise<AIOStream> {
    const { name, description } = stream.addon.formatPassthrough
      ? {
          name: stream.originalName || stream.addon.name,
          description: stream.originalDescription,
        }
      : await formatter.format(stream);

    const bingeGroup = options?.disableAutoplay
      ? undefined
      : generateBingeGroup(stream, index, this.userData);

    return {
      name,
      description,
      url: ['http', 'usenet', 'debrid', 'live', 'info'].includes(stream.type)
        ? stream.url
        : undefined,
      infoHash: stream.type === 'p2p' ? stream.torrent?.infoHash : undefined,
      fileIdx: stream.type === 'p2p' ? stream.torrent?.fileIdx : undefined,
      ytId: stream.type === 'youtube' ? stream.ytId : undefined,
      externalUrl: stream.type === 'external' ? stream.externalUrl : undefined,
      sources: stream.type === 'p2p' ? stream.torrent?.sources : undefined,
      nzbUrl:
        stream.type === constants.STREMIO_USENET_STREAM_TYPE
          ? stream.nzbUrl
          : undefined,
      servers:
        stream.type === constants.STREMIO_USENET_STREAM_TYPE
          ? stream.servers
          : undefined,
      rarUrls:
        stream.type === constants.ARCHIVE_STREAM_TYPE
          ? stream.rarUrls
          : undefined,
      zipUrls:
        stream.type === constants.ARCHIVE_STREAM_TYPE
          ? stream.zipUrls
          : undefined,
      '7zipUrls':
        stream.type === constants.ARCHIVE_STREAM_TYPE
          ? stream['7zipUrls']
          : undefined,
      tgzUrls:
        stream.type === constants.ARCHIVE_STREAM_TYPE
          ? stream.tgzUrls
          : undefined,
      tarUrls:
        stream.type === constants.ARCHIVE_STREAM_TYPE
          ? stream.tarUrls
          : undefined,
      subtitles: stream.subtitles,
      behaviorHints: {
        countryWhitelist: stream.countryWhitelist,
        notWebReady: stream.notWebReady,
        bingeGroup: options?.disableAutoplay ? undefined : bingeGroup,
        proxyHeaders:
          stream.requestHeaders || stream.responseHeaders
            ? {
                request: stream.requestHeaders,
                response: stream.responseHeaders,
              }
            : undefined,
        videoHash: stream.videoHash,
        videoSize: stream.size,
        filename: stream.filename,
      },
      streamData: options?.provideStreamData
        ? {
            type: stream.type,
            proxied: stream.proxied,
            indexer: stream.indexer,
            age: stream.age,
            duration: stream.duration,
            library: stream.library,
            size: stream.size,
            folderSize: stream.folderSize,
            torrent: stream.torrent,
            addon: stream.addon.name,
            filename: stream.filename,
            folderName: stream.folderName,
            service: stream.service,
            parsedFile: stream.parsedFile,
            message: stream.message,
            regexMatched: stream.regexMatched,
            keywordMatched: stream.keywordMatched,
            streamExpressionMatched: stream.streamExpressionMatched,
            rankedStreamExpressionsMatched:
              stream.rankedStreamExpressionsMatched,
            streamExpressionScore: stream.streamExpressionScore,
            regexScore: stream.regexScore,
            rankedRegexesMatched: stream.rankedRegexesMatched,
            seadex: stream.seadex,
            id: stream.id,
          }
        : undefined,
    };
  }

  async transformStreams(
    response: AIOStreamsResponse<{
      streams: ParsedStream[];
      statistics: { title: string; description: string }[];
    }>,
    formatterContext: FormatterContext,
    options?: { provideStreamData?: boolean; disableAutoplay?: boolean }
  ): Promise<AIOStreamResponse> {
    const formatter = createFormatter(formatterContext);
    const {
      data: { streams, statistics },
      errors,
    } = response;
    const { provideStreamData, disableAutoplay } = options ?? {};

    let transformedStreams: AIOStream[] = [];

    const start = Date.now();

    transformedStreams = await Promise.all(
      streams.map((stream: ParsedStream, index: number) =>
        this.convertParsedStreamToStream(stream, formatter, index, {
          disableAutoplay: disableAutoplay ?? false,
          provideStreamData: provideStreamData ?? false,
        })
      )
    );

    logger.info(
      `Transformed ${streams.length} streams using ${this.userData.formatter.id} formatter in ${getTimeTakenSincePoint(start)}`
    );

    // add errors to the end (if this.userData.hideErrors is false  or the resource is not in this.userData.hideErrorsForResources)
    if (this.showError('stream', errors)) {
      transformedStreams.push(
        ...errors.map((error) =>
          StremioTransformer.createErrorStream({
            errorTitle: error.title,
            errorDescription: error.description,
          })
        )
      );
    }

    if (this.userData.statistics?.enabled) {
      let position = this.userData.statistics?.position || 'bottom';
      let statisticStreams = statistics.map((statistic) => ({
        name: statistic.title,
        description: statistic.description,
        externalUrl: 'https://github.com/Viren070/AIOStreams',
        streamData: {
          type: constants.STATISTIC_STREAM_TYPE,
        },
      }));
      if (position === 'bottom') {
        transformedStreams.push(...statisticStreams);
      } else {
        transformedStreams.unshift(...statisticStreams);
      }
    }

    return {
      streams: transformedStreams,
    };
  }

  transformSubtitles(
    response: AIOStreamsResponse<Subtitle[]>
  ): SubtitleResponse {
    const { data: subtitles, errors } = response;

    if (this.showError('subtitles', errors)) {
      subtitles.push(
        ...errors.map((error) =>
          StremioTransformer.createErrorSubtitle({
            errorTitle: error.title,
            errorDescription: error.description,
          })
        )
      );
    }

    return {
      subtitles,
    };
  }

  transformCatalog(
    response: AIOStreamsResponse<MetaPreview[]>
  ): CatalogResponse {
    const { data: metas, errors } = response;

    if (this.showError('catalog', errors)) {
      metas.push(
        ...errors.map((error) =>
          StremioTransformer.createErrorMeta({
            errorTitle: error.title,
            errorDescription: error.description,
          })
        )
      );
    }

    return {
      metas,
    };
  }

  async transformMeta(
    response: AIOStreamsResponse<ParsedMeta | null>,
    formatterContext?: FormatterContext,
    options?: { provideStreamData?: boolean; disableAutoplay?: boolean }
  ): Promise<MetaResponse | null> {
    const { data: meta, errors } = response;
    const { provideStreamData, disableAutoplay } = options ?? {};

    if (!meta && errors.length === 0) {
      return null;
    }

    if (this.showError('meta', errors) || !meta) {
      return {
        meta: StremioTransformer.createErrorMeta({
          errorTitle: errors.length > 0 ? errors[0].title : undefined,
          errorDescription: errors[0]?.description || 'Unknown error',
        }),
      };
    }

    // Create formatter for stream conversion if needed
    let formatter: {
      format: (
        stream: ParsedStream
      ) => Promise<{ name: string; description: string }>;
    } | null = null;
    if (
      meta.videos?.some((video) => video.streams && video.streams.length > 0) &&
      formatterContext
    ) {
      formatter = createFormatter(formatterContext);
    }

    // Transform streams in videos if present
    if (meta.videos && formatter) {
      for (const video of meta.videos) {
        if (video.streams && video.streams.length > 0) {
          const transformedStreams: AIOStream[] = await Promise.all(
            video.streams.map((stream, index) =>
              this.convertParsedStreamToStream(stream, formatter!, index, {
                disableAutoplay: disableAutoplay ?? false,
                provideStreamData: provideStreamData ?? false,
              })
            )
          );
          (video as NonNullable<Meta['videos']>[number]).streams =
            transformedStreams;
        }
      }
    }

    return {
      meta,
    };
  }

  transformAddonCatalog(
    response: AIOStreamsResponse<AddonCatalog[]>
  ): AddonCatalogResponse {
    const { data: addonCatalogs, errors } = response;
    if (this.showError('addon_catalog', errors)) {
      addonCatalogs.push(
        ...errors.map((error) =>
          StremioTransformer.createErrorAddonCatalog({
            errorTitle: error.title,
            errorDescription: error.description,
          })
        )
      );
    }
    return {
      addons: addonCatalogs,
    };
  }
  static createErrorStream(options: ErrorOptions = {}): AIOStream {
    const {
      errorTitle = `[❌] ${Env.ADDON_NAME}`,
      errorDescription = 'Unknown error',
      errorUrl = 'https://github.com/Viren070/AIOStreams',
    } = options;
    return {
      name: errorTitle,
      description: errorDescription,
      externalUrl: errorUrl,
      streamData: {
        type: constants.ERROR_STREAM_TYPE,
        error: {
          title: errorTitle,
          description: errorDescription,
        },
        id: `error.${errorTitle}`,
      },
    };
  }

  static createErrorSubtitle(options: ErrorOptions = {}) {
    const {
      errorTitle = 'Unknown error',
      errorDescription = 'Unknown error',
      errorUrl = 'https://github.com/Viren070/AIOStreams',
    } = options;
    return {
      id: `error.${errorTitle}`,
      lang: `[❌] ${errorTitle} - ${errorDescription}`,
      url: errorUrl,
    };
  }

  static createErrorMeta(options: ErrorOptions = {}): MetaPreview {
    const {
      errorTitle = `[❌] ${Env.ADDON_NAME} - Error`,
      errorDescription = 'Unknown error',
    } = options;
    return {
      id: `aiostreamserror.${encodeURIComponent(JSON.stringify(options))}`,
      name: errorTitle,
      description: errorDescription,
      type: 'movie',
    };
  }

  static createErrorAddonCatalog(options: ErrorOptions = {}): AddonCatalog {
    const {
      errorTitle = `[❌] ${Env.ADDON_NAME} - Error`,
      errorDescription = 'Unknown error',
    } = options;
    return {
      transportName: 'http',
      transportUrl: 'https://github.com/Viren070/AIOStreams',
      manifest: {
        name: errorTitle,
        description: errorDescription,
        id: `error.${errorTitle}`,
        version: '1.0.0',
        types: ['addon_catalog'],
        resources: [{ name: 'addon_catalog', types: ['addon_catalog'] }],
        catalogs: [],
      },
    };
  }

  static createDynamicError(
    resource: Resource,
    options: ErrorOptions = {}
  ): any {
    if (resource === 'meta') {
      return { meta: StremioTransformer.createErrorMeta(options) };
    }
    if (resource === 'addon_catalog') {
      return { addons: [StremioTransformer.createErrorAddonCatalog(options)] };
    }
    if (resource === 'catalog') {
      return { metas: [StremioTransformer.createErrorMeta(options)] };
    }
    if (resource === 'stream') {
      return { streams: [StremioTransformer.createErrorStream(options)] };
    }
    if (resource === 'subtitles') {
      return { subtitles: [StremioTransformer.createErrorSubtitle(options)] };
    }
    return null;
  }
}
