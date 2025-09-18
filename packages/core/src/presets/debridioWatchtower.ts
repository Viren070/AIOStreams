import { Addon, Option, ParsedStream, Stream, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants, Env } from '../utils/index.js';
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
        Env.DEFAULT_DEBRIDIO_WATCHTOWER_TIMEOUT
      ),
      debridioApiKeyOption,
      debridioSocialOption,
    ];

    return {
      ID: 'debridio-watchtower',
      NAME: 'Debridio Watchtower',
      LOGO: debridioLogo,
      URL: Env.DEBRIDIO_WATCHTOWER_URL,
      TIMEOUT: Env.DEFAULT_DEBRIDIO_WATCHTOWER_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_DEBRIDIO_WATCHTOWER_USER_AGENT || Env.DEFAULT_USER_AGENT,
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
    let url = this.METADATA.URL;
    if (options.url?.endsWith('/manifest.json')) {
      url = options.url;
    } else {
      let baseUrl = this.METADATA.URL;
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
