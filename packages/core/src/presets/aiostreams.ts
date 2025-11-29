import {
  Addon,
  Option,
  UserData,
  ParsedStream,
  Stream,
  AIOStream,
} from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants, Env, formatZodError, RESOURCES } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';
import { createLogger } from '../utils/index.js';
import { parseAgeString } from '../parser/utils.js';

const logger = createLogger('parser');

class AIOStreamsStreamParser extends StreamParser {
  override parse(stream: Stream): ParsedStream | { skip: true } {
    const aioStream = stream as AIOStream;
    const parsed = AIOStream.safeParse(aioStream);
    if (!parsed.success) {
      logger.error(
        `Stream from AIOStream was not detected as a valid stream: ${formatZodError(parsed.error)}`
      );
      throw new Error('Invalid stream');
    }
    if (!aioStream.streamData) {
      throw new Error('Stream Data was missing from AIOStream response');
    }
    if (
      aioStream.streamData.id?.endsWith('external-download') ||
      aioStream.streamData.type === constants.STATISTIC_STREAM_TYPE
    ) {
      return { skip: true };
    }
    const addonName = this.addon?.name?.trim();
    return {
      id: this.getRandomId(),
      addon: {
        ...this.addon,
        name: addonName
          ? `${addonName} | ${aioStream.streamData?.addon ?? ''}`
          : (aioStream.streamData?.addon ?? ''),
      },
      error: aioStream.streamData?.error,
      type: aioStream.streamData?.type ?? 'http',
      url: aioStream.url ?? undefined,
      externalUrl: aioStream.externalUrl ?? undefined,
      ytId: aioStream.ytId ?? undefined,
      requestHeaders: aioStream.behaviorHints?.proxyHeaders?.request,
      responseHeaders: aioStream.behaviorHints?.proxyHeaders?.response,
      notWebReady: aioStream.behaviorHints?.notWebReady ?? undefined,
      videoHash: aioStream.behaviorHints?.videoHash ?? undefined,
      filename: aioStream.streamData?.filename,
      folderName: aioStream.streamData?.folderName,
      proxied: aioStream.streamData?.proxied ?? false,
      size: aioStream.streamData?.size,
      folderSize: aioStream.streamData?.folderSize,
      indexer: aioStream.streamData?.indexer,
      service: aioStream.streamData?.service,
      duration: aioStream.streamData?.duration,
      library: aioStream.streamData?.library ?? false,
      age:
        typeof aioStream.streamData?.age === 'string'
          ? parseAgeString(aioStream.streamData?.age)
          : aioStream.streamData?.age,
      message: aioStream.streamData?.message,
      torrent: aioStream.streamData?.torrent,
      parsedFile: aioStream.streamData?.parsedFile,
      keywordMatched: aioStream.streamData?.keywordMatched,
      streamExpressionMatched: aioStream.streamData?.streamExpressionMatched,
      regexMatched: aioStream.streamData?.regexMatched,
      originalName: aioStream.name ?? undefined,
      originalDescription: (aioStream.description || stream.title) ?? undefined,
    };
  }
}

export class AIOStreamsPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return AIOStreamsStreamParser;
  }

  static override get METADATA() {
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description:
          "What to call this addon. Leave empty if you don't want to include the name of this addon in the stream results.",
        type: 'string',
        required: false,
        default: 'AIOStreams',
      },
      {
        id: 'manifestUrl',
        name: 'Manifest URL',
        description: 'Provide the Manifest URL for this AIOStreams addon.',
        type: 'url',
        required: true,
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        default: Env.DEFAULT_TIMEOUT,
        constraints: {
          min: Env.MIN_TIMEOUT,
          max: Env.MAX_TIMEOUT,
          forceInUi: false,
        },
      },
      {
        id: 'resources',
        name: 'Resources',
        showInSimpleMode: false,
        description:
          'Optionally override the resources that are fetched from this addon ',
        type: 'multi-select',
        required: false,
        default: undefined,
        options: RESOURCES.map((resource) => ({
          label: constants.RESOURCE_LABELS[resource],
          value: resource,
        })),
      },
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: [
          { label: 'Movie', value: 'movie' },
          { label: 'Series', value: 'series' },
          { label: 'Anime', value: 'anime' },
        ],
        default: [],
      },
      {
        id: 'libraryAddon',
        name: 'Library Addon',
        description:
          'Whether to mark this addon as a library addon. This will result in all streams from this addon being marked as library streams.',
        type: 'boolean',
        required: false,
        showInSimpleMode: false,
        default: false,
      },
      {
        id: 'formatPassthrough',
        name: 'Format Passthrough',
        description:
          'Whether to pass through the stream formatting. This means your formatting will not be applied and original stream formatting is retained.',
        type: 'boolean',
        required: false,
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'resultPassthrough',
        name: 'Result Passthrough',
        description:
          'If enabled, all results from this addon will never be filtered out and always included in the final stream list.',
        type: 'boolean',
        required: false,
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'forceToTop',
        name: 'Force to Top',
        description:
          'Whether to force results from this addon to be pushed to the top of the stream list.',
        type: 'boolean',
        required: false,
        default: false,
        showInSimpleMode: false,
      },
    ];

    return {
      ID: 'aiostreams',
      NAME: 'AIOStreams',
      LOGO: 'https://raw.githubusercontent.com/Viren070/AIOStreams/refs/heads/main/packages/frontend/public/assets/logo.png',
      URL: '',
      TIMEOUT: Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.AIOSTREAMS_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Wrap AIOStreams within AIOStreams!',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: [],
      CATEGORY: constants.PresetCategory.MISC,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    if (!options.manifestUrl.endsWith('/manifest.json')) {
      throw new Error(
        `${options.name} has an invalid Manifest URL. It must be a valid link to a manifest.json`
      );
    }
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name ?? this.METADATA.NAME,
      manifestUrl: options.manifestUrl.replace('stremio://', 'https://'),
      enabled: true,
      library: options.libraryAddon ?? false,
      resources: options.resources || undefined,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      resultPassthrough: options.resultPassthrough ?? false,
      formatPassthrough: options.formatPassthrough ?? false,
      forceToTop: options.forceToTop ?? false,
      mediaTypes: options.mediaTypes || [],
      preset: {
        id: '',
        type: this.METADATA.ID,
        options: options,
      },
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }
}
