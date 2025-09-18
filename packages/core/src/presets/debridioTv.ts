import {
  Addon,
  Option,
  ParsedFile,
  ParsedStream,
  Stream,
  UserData,
} from '../db/index.js';
import { CacheKeyRequestOptions, Preset, baseOptions } from './preset.js';
import { constants, Env } from '../utils/index.js';
import {
  debridioSocialOption,
  debridioApiKeyOption,
  debridioLogo,
} from './debridio.js';
import { FileParser, StreamParser } from '../parser/index.js';

class DebridioTvStreamParser extends StreamParser {
  protected override getParsedFile(
    stream: Stream,
    parsedStream: ParsedStream
  ): ParsedFile | undefined {
    const parsed = stream.name ? FileParser.parse(stream.name) : undefined;
    if (!parsed) {
      return undefined;
    }

    return {
      ...parsed,
      title: undefined,
    };
  }
  protected override getFilename(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return undefined;
  }

  protected override getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return `${stream.name} - ${stream.description}`;
  }

  protected getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return constants.LIVE_STREAM_TYPE;
  }
}
export class DebridioTvPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return DebridioTvStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];

    const channels = [
      {
        label: 'USA',
        value: 'usa',
      },
      {
        label: 'Canada',
        value: 'ca',
      },
      {
        label: 'Mexico',
        value: 'mx',
      },
      {
        label: 'United Kingdom',
        value: 'uk',
      },
      {
        label: 'Australia',
        value: 'au',
      },
      {
        label: 'Chile',
        value: 'cl',
      },
      {
        label: 'France',
        value: 'fr',
      },
      {
        label: 'Italy',
        value: 'it',
      },
      {
        label: 'South Africa',
        value: 'za',
      },
      {
        label: 'New Zealand',
        value: 'nz',
      },
      {
        label: 'Estonia',
        value: 'ee',
      },
    ];
    const options: Option[] = [
      ...baseOptions(
        'Debridio TV',
        supportedResources,
        Env.DEFAULT_DEBRIDIO_TV_TIMEOUT
      ),
      debridioApiKeyOption,
      {
        id: 'channels',
        name: 'Channels',
        description: 'The channels to display',
        type: 'multi-select',
        required: true,
        options: channels,
        default: channels.map((channel) => channel.value),
      },
      {
        id: 'resultPassthrough',
        name: 'Result Passthrough',
        description:
          'Ensure no Debridio TV results are filtered out by anything',
        required: false,
        type: 'boolean',
        default: true,
      },
      debridioSocialOption,
    ];

    return {
      ID: 'debridio-tv',
      NAME: 'Debridio TV',
      LOGO: debridioLogo,
      URL: Env.DEBRIDIO_TV_URL,
      TIMEOUT: Env.DEFAULT_DEBRIDIO_TV_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_DEBRIDIO_TV_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Live streaming of a wide variety of channels.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.LIVE_STREAM_TYPE],
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
        channels: options.channels,
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
      resultPassthrough: options.resultPassthrough ?? true,
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

  static override getCacheKey(
    options: CacheKeyRequestOptions
  ): string | undefined {
    const { resource, type, id, options: presetOptions, extras } = options;
    try {
      if (new URL(presetOptions.url).pathname.endsWith('/manifest.json')) {
        return undefined;
      }
      if (new URL(presetOptions.url).origin !== this.METADATA.URL) {
        return undefined;
      }
    } catch {}
    let cacheKey = `${this.METADATA.ID}-${resource}-${type}-${id}-${extras}`;
    if (resource === 'manifest') {
      cacheKey += `-${presetOptions.debridioApiKey}-${presetOptions.channels}`;
    }
    return cacheKey;
  }
}
