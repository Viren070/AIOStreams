import { constants, Env } from '..';
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
} from '../db';
import { createFormatter } from '../formatters';
import { AIOStreamsError, AIOStreamsResponse } from '../main';
import { createLogger } from '../utils';

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

  async transformStreams(
    response: AIOStreamsResponse<{
      streams: ParsedStream[];
      statistics: { title: string; description: string }[];
    }>
  ): Promise<AIOStreamResponse> {
    const {
      data: { streams, statistics },
      errors,
    } = response;

    let transformedStreams: AIOStream[] = [];

    let formatter;
    if (this.userData.formatter.id === constants.CUSTOM_FORMATTER) {
      const template = this.userData.formatter.definition;
      if (!template) {
        throw new Error('No template defined for custom formatter');
      }
      formatter = createFormatter(
        this.userData.formatter.id,
        template,
        this.userData.addonName
      );
    } else {
      formatter = createFormatter(
        this.userData.formatter.id,
        undefined,
        this.userData.addonName
      );
    }

    logger.info(
      `Transforming ${streams.length} streams, using formatter ${this.userData.formatter.id}`
    );

    transformedStreams = await Promise.all(
      streams.map(async (stream: ParsedStream): Promise<AIOStream> => {
        const { name, description } = stream.addon.streamPassthrough
          ? {
              name: stream.originalName,
              description: stream.originalDescription,
            }
          : formatter.format(stream);
        const identifyingAttributes = [
          Env.ADDON_ID,
          stream.addon.name,
          stream.service?.id,
          stream.library,
          stream.proxied,
          stream.parsedFile?.resolution,
          stream.parsedFile?.quality,
          stream.parsedFile?.encode,
          stream.parsedFile?.audioTags.length
            ? stream.parsedFile?.audioTags
            : undefined,
          stream.parsedFile?.visualTags.length
            ? stream.parsedFile?.visualTags
            : undefined,
          stream.parsedFile?.languages.length
            ? stream.parsedFile?.languages
            : undefined,
          stream.parsedFile?.releaseGroup,
          stream.indexer,
        ].filter(Boolean);
        const bingeGroup = `${identifyingAttributes.join('|')}`;
        return {
          name,
          description,
          url: ['http', 'usenet', 'debrid', 'live'].includes(stream.type)
            ? stream.url
            : undefined,
          infoHash:
            stream.type === 'p2p' ? stream.torrent?.infoHash : undefined,
          fileIdx: stream.type === 'p2p' ? stream.torrent?.fileIdx : undefined,
          ytId: stream.type === 'youtube' ? stream.ytId : undefined,
          externalUrl:
            stream.type === 'external' ? stream.externalUrl : undefined,
          sources: stream.type === 'p2p' ? stream.torrent?.sources : undefined,
          subtitles: stream.subtitles,
          behaviorHints: {
            countryWhitelist: stream.countryWhitelist,
            notWebReady: stream.notWebReady,
            bingeGroup: bingeGroup,
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
          streamData: {
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
          },
        };
      })
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

    if (this.userData.showStatistics) {
      transformedStreams.push(
        ...statistics.map((statistic) => ({
          name: statistic.title,
          description: statistic.description,
          externalUrl: 'https://github.com/Viren070/AIOStreams',
          streamData: {
            type: constants.STATISTIC_STREAM_TYPE,
          },
        }))
      );
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

  transformMeta(
    response: AIOStreamsResponse<Meta | null>
  ): MetaResponse | null {
    const { data: meta, errors } = response;

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
      id: `error.${errorTitle}`,
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
