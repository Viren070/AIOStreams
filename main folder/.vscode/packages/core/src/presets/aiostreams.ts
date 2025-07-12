import {
  Addon,
  Option,
  UserData,
  ParsedStream,
  Stream,
  AIOStream,
} from '../db';
import { Preset, baseOptions } from './preset';
import { constants, Env, formatZodError, RESOURCES } from '../utils';
import { StreamParser } from '../parser';
import { createLogger } from '../utils';

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
      size: aioStream.streamData?.size,
      folderSize: aioStream.streamData?.folderSize,
      indexer: aioStream.streamData?.indexer,
      service: aioStream.streamData?.service,
      duration: aioStream.streamData?.duration,
      library: aioStream.streamData?.library ?? false,
      age: aioStream.streamData?.age,
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
        required: true,
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
        name: 'Timeout',
        description: 'The timeout for this addon',
        type: 'number',
        default: Env.DEFAULT_TIMEOUT,
        constraints: {
          min: Env.MIN_TIMEOUT,
          max: Env.MAX_TIMEOUT,
        },
      },
      {
        id: 'resources',
        name: 'Resources',
        description:
          'Optionally override the resources that are fetched from this addon ',
        type: 'multi-select',
        required: false,
        default: undefined,
        options: RESOURCES.map((resource) => ({
          label: resource,
          value: resource,
        })),
      },
    ];

    return {
      ID: 'aiostreams',
      NAME: 'AIOStreams',
      LOGO: 'https://raw.githubusercontent.com/Viren070/AIOStreams/refs/heads/main/packages/frontend/public/assets/logo.png',
      URL: '',
      TIMEOUT: Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Wrap AIOStreams within AIOStreams!',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: [],
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
      name: options.name || this.METADATA.NAME,
      manifestUrl: options.manifestUrl.replace('stremio://', 'https://'),
      enabled: true,
      library: false,
      resources: options.resources || undefined,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      presetType: this.METADATA.ID,
      presetInstanceId: '',
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }
}
