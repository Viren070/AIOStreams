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
import { createFormatter } from '../formatters/index.js';
import { AIOStreamsError, AIOStreamsResponse } from '../main.js';
import { createLogger, getTimeTakenSincePoint } from '../utils/index.js';

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
    provideStreamData: boolean
  ): Promise<AIOStream> {
    const { name, description } = stream.addon.formatPassthrough
      ? {
          name: stream.originalName || stream.addon.name,
          description: stream.originalDescription,
        }
      : await formatter.format(stream);

    const autoPlaySettings = {
      enabled: this.userData.autoPlay?.enabled ?? true,
      method: this.userData.autoPlay?.method ?? 'matchingFile',
      attributes:
        this.userData.autoPlay?.attributes ??
        constants.DEFAULT_AUTO_PLAY_ATTRIBUTES,
    };

    const identifyingAttributes = autoPlaySettings.attributes
      .map((attribute) => {
        switch (attribute) {
          case 'service':
            return stream.service?.id ?? 'no service';
          case 'type':
            return stream.type;
          case 'proxied':
            return stream.proxied;
          case 'addon':
            return stream.addon.name;
          case 'infoHash':
            return stream.torrent?.infoHash;
          case 'size':
            return (() => {
              const size = stream.size;
              if (!size || typeof size !== 'number' || isNaN(size)) return;

              // size in bytes
              const KB = 1024;
              const MB = 1024 * KB;
              const GB = 1024 * MB;

              if (size < 5 * GB) {
                if (size < 100 * MB) return '0-100MB';
                if (size > 100 * MB && size < 300 * MB) return '100-300MB';
                if (size > 300 * MB && size < 500 * MB) return '300-500MB';
                if (size > 500 * MB && size < 1 * GB) return '500MB-1GB';
                if (size > 1 * GB && size < 2 * GB) return '1-2GB';
                if (size > 2 * GB && size < 3 * GB) return '2-3GB';
                if (size > 3 * GB && size < 4 * GB) return '3-4GB';
                if (size > 4 * GB && size < 5 * GB) return '4-5GB';
                return '5GB+';
              }

              const sizeInGB = size / GB;

              const lower = Math.floor(
                Math.pow(1.5, Math.floor(Math.log(sizeInGB) / Math.log(1.5)))
              );
              const upper = Math.floor(
                Math.pow(
                  1.5,
                  Math.floor(Math.log(sizeInGB) / Math.log(1.5)) + 1
                )
              );

              if (lower === upper) {
                return `${upper}GB+`;
              }

              return `${lower}-${upper}GB`;
            })();
          default:
            return stream.parsedFile?.[attribute];
        }
      })
      .filter((attribute) =>
        attribute !== undefined &&
        attribute !== null &&
        Array.isArray(attribute)
          ? attribute.length
          : true
      );
    let bingeGroup: string | undefined;
    if (autoPlaySettings.enabled) {
      bingeGroup = Env.ADDON_ID;

      switch (autoPlaySettings.method) {
        case 'matchingFile':
          bingeGroup += `|${identifyingAttributes.join('|')}`;
          break;
        case 'matchingIndex':
          bingeGroup += `|${index.toString()}`;
          break;
      }
    }

    return {
      name,
      description,
      url: ['http', 'usenet', 'debrid', 'live'].includes(stream.type)
        ? stream.url
        : undefined,
      infoHash: stream.type === 'p2p' ? stream.torrent?.infoHash : undefined,
      fileIdx: stream.type === 'p2p' ? stream.torrent?.fileIdx : undefined,
      ytId: stream.type === 'youtube' ? stream.ytId : undefined,
      externalUrl: stream.type === 'external' ? stream.externalUrl : undefined,
      sources: stream.type === 'p2p' ? stream.torrent?.sources : undefined,
      subtitles: stream.subtitles,
      behaviorHints: {
        countryWhitelist: stream.countryWhitelist,
        notWebReady: stream.notWebReady,
        bingeGroup,
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
      streamData: provideStreamData
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
    options?: { provideStreamData: boolean }
  ): Promise<AIOStreamResponse> {
    const formatter = createFormatter(this.userData);
    const {
      data: { streams, statistics },
      errors,
    } = response;
    const { provideStreamData } = options ?? {};

    let transformedStreams: AIOStream[] = [];

    const start = Date.now();

    transformedStreams = await Promise.all(
      streams.map((stream: ParsedStream, index: number) =>
        this.convertParsedStreamToStream(
          stream,
          formatter,
          index,
          provideStreamData ?? false
        )
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
    options?: { provideStreamData: boolean }
  ): Promise<MetaResponse | null> {
    const { data: meta, errors } = response;
    const { provideStreamData } = options ?? {};

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
      meta.videos?.some((video) => video.streams && video.streams.length > 0)
    ) {
      formatter = createFormatter(this.userData);
    }

    // Transform streams in videos if present
    if (meta.videos && formatter) {
      for (const video of meta.videos) {
        if (video.streams && video.streams.length > 0) {
          const transformedStreams = await Promise.all(
            video.streams.map((stream, index) =>
              this.convertParsedStreamToStream(
                stream,
                formatter!,
                index,
                provideStreamData ?? false
              )
            )
          );
          video.streams = transformedStreams as unknown as ParsedStream[];
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
