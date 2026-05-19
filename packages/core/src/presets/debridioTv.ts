import {
  Addon,
  Option,
  ParsedFile,
  ParsedStream,
  Stream,
  UserData,
} from '../db/index.js';
import { CacheKeyRequestOptions, Preset, baseOptions } from './preset.js';
import { constants } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
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
      { value: 'au', label: 'Australia' },
      { value: 'br', label: 'Brasil' },
      { value: 'ca', label: 'Canada' },
      { value: 'cl', label: 'Chile' },
      { value: 'es', label: 'Spain' },
      { value: 'events', label: 'Live Events' },
      { value: 'fr', label: 'France' },
      { value: 'it', label: 'Italy' },
      { value: 'in', label: 'India' },
      { value: 'mx', label: 'Mexico' },
      { value: 'nz', label: 'New Zealand' },
      { value: 'uk', label: 'United Kingdom' },
      { value: 'usa_locals', label: 'United States Local' },
      { value: 'usa', label: 'United States' },
      { value: 'za', label: 'South Africa' },
      { value: '247', label: '24/7' },
      { value: 'search', label: 'Enable Searching' },
    ];
    const options: Option[] = [
      ...baseOptions(
        'Debridio TV',
        supportedResources,
        appConfig.presets.debridioTv.defaultTimeout ??
          appConfig.presets.defaultTimeout
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
      URL: appConfig.presets.debridioTv.url,
      TIMEOUT:
        appConfig.presets.debridioTv.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.debridioTv.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
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
      if (new URL(presetOptions.url).origin !== this.DEFAULT_URL) {
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
