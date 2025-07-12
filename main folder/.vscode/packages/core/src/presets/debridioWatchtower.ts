import { Addon, Option, ParsedStream, Stream, UserData } from '../db';
import { Preset, baseOptions } from './preset';
import { constants, Env } from '../utils';
import { FileParser, StreamParser } from '../parser';
import { debridioSocialOption } from './debridio';

class DebridioWatchtowerStreamParser extends StreamParser {
  parse(stream: Stream): ParsedStream {
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

    parsedStream.message = stream.name
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
      {
        id: 'debridioApiKey',
        name: 'Debridio API Key',
        description:
          'Your Debridio API Key, located at your [account settings](https://debridio.com/account)',
        type: 'password',
        required: true,
      },
      debridioSocialOption,
    ];

    return {
      ID: 'debridio-watchtower',
      NAME: 'Debridio Watchtower',
      LOGO: 'https://res.cloudinary.com/adobotec/image/upload/w_120,h_120/v1735925306/debridio/logo.png.png',
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
      presetType: this.METADATA.ID,
      presetInstanceId: '',
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }
}
