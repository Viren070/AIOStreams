import { Addon, Option, ParsedStream, Stream, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import { FileParser, StreamParser } from '../parser/index.js';
import {
  debridioSocialOption,
  debridioApiKeyOption,
  debridioLogo,
} from './debridio.js';

class DebridioWatchtowerStreamParser extends StreamParser {
  override parse(stream: Stream): ParsedStream | { skip: true } {
    let parsedStream: ParsedStream = {
      id: this.getRandomId(),
      addon: this.addon,
      type: 'http',
      url: this.applyUrlModifications(stream.url ?? undefined),
      externalUrl: stream.externalUrl ?? undefined,
      ytId: stream.ytId ?? undefined,
      requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
      responseHeaders: stream.behaviorHints?.proxyHeaders?.response,
      notWebReady: stream.behaviorHints?.notWebReady ?? undefined,
      videoHash: stream.behaviorHints?.videoHash ?? undefined,
      originalName: stream.name ?? undefined,
      originalDescription: (stream.description || stream.title) ?? undefined,
    };

    stream.description = stream.description || stream.title;

    if (stream.description?.toLowerCase().includes('no streams available')) {
      return { skip: true };
    }

    parsedStream.type = 'http';
    let resolution = (stream as any).resolution;
    resolution = typeof resolution === 'string' ? resolution : undefined;
    parsedStream.parsedFile = FileParser.parse(resolution);
    parsedStream.parsedFile = {
      resolution: parsedStream.parsedFile.resolution,
      languages: [],
      audioChannels: [],
      visualTags: [],
      audioTags: [],
    };
    parsedStream.parsedFile.languages = Array.from(
      new Set([
        ...parsedStream.parsedFile.languages,
        ...this.getLanguages(stream, parsedStream),
      ])
    );

    parsedStream.indexer = stream.name
      ? (stream.name?.split('\n')?.[0]?.match(/\[([^\]]+)\]/)?.[1] ?? undefined)
      : undefined;

    return parsedStream;
  }
}

export class DebridioWatchtowerPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return DebridioWatchtowerStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Debridio Watchtower',
        supportedResources,
        appConfig.presets.debridioWatchtower.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ),
      debridioApiKeyOption,
      debridioSocialOption,
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
        type: 'multi-select',
        required: false,
        options: [
          { label: 'Movie', value: 'movie' },
          { label: 'Series', value: 'series' },
          { label: 'Anime', value: 'anime' },
        ],
        default: [],
        showInSimpleMode: false,
      },
    ];

    return {
      ID: 'debridio-watchtower',
      NAME: 'Debridio Watchtower',
      LOGO: debridioLogo,
      URL: appConfig.presets.debridioWatchtower.url,
      TIMEOUT:
        appConfig.presets.debridioWatchtower.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.debridioWatchtower.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Watchtower is a http stream provider.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.HTTP_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    if (!options.url && !options.debridioApiKey) {
      throw new Error(
        'To access the Debridio addons, you must provide your Debridio API Key'
      );
    }
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    let url = this.DEFAULT_URL;
    if (options.url?.endsWith('/manifest.json')) {
      url = options.url;
    } else {
      let baseUrl = this.DEFAULT_URL;
      if (options.url) {
        baseUrl = new URL(options.url).origin;
      }
      // remove trailing slash
      baseUrl = baseUrl.replace(/\/$/, '');
      if (!options.debridioApiKey) {
        throw new Error(
          'To access the Debridio addons, you must provide your Debridio API Key'
        );
      }
      const config = this.base64EncodeJSON({
        api_key: options.debridioApiKey,
      });
      url = `${baseUrl}/${config}/manifest.json`;
    }
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: url,
      enabled: true,
      library: false,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
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
