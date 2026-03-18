import {
  Addon,
  Option,
  ParsedFile,
  ParsedStream,
  PresetMetadata,
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

class DebridioIC4AStreamParser extends StreamParser {
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
export class DebridioIC4APreset extends Preset {
  static override getParser(): typeof StreamParser {
    return DebridioIC4AStreamParser;
  }

  static override get METADATA(): PresetMetadata {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];

    const server = [
      { value: 'na-east-edge01', label: 'North America (East)' },
      { value: 'eu-west-edge01', label: 'Europe (West)' },
    ];

    const countries = [
      { value: 'ar', label: 'Argentina' },
      { value: 'au', label: 'Australia' },
      { value: 'be', label: 'Belgium' },
      { value: 'br', label: 'Brasil' },
      { value: 'ca', label: 'Canada' },
      { value: 'co', label: 'Colombia' },
      { value: 'de', label: 'Germany' },
      { value: 'dk', label: 'Denmark' },
      { value: 'es', label: 'Spain' },
      { value: 'fr', label: 'France' },
      { value: 'gr', label: 'Greece' },
      { value: 'in', label: 'India' },
      { value: 'it', label: 'Italy' },
      { value: 'mx', label: 'Mexico' },
      { value: 'nl', label: 'Netherlands' },
      { value: 'no', label: 'Norway' },
      { value: 'nz', label: 'New Zealand' },
      { value: 'pt', label: 'Portugal' },
      { value: 'uk', label: 'United Kingdom' },
      { value: 'us', label: 'United States' },
      { value: 'za', label: 'South Africa' },
    ];
    const options: Option[] = [
      ...baseOptions(
        'Debridio IC4A',
        supportedResources,
        Env.DEFAULT_DEBRIDIO_IC4A_TIMEOUT
      ),
      debridioApiKeyOption,
      {
        id: 'server',
        name: 'Select Server',
        description:
          'Choose the server closest to your location for better performance.',
        type: 'select',
        required: true,
        options: server,
        default: 'na-east-edge01',
      },
      {
        id: 'countries',
        name: 'Selected Countries',
        description: 'All available countries are selected by default.',
        type: 'multi-select',
        required: false,
        options: countries,
        default: countries.map((countries) => countries.value),
      },
      {
        id: 'resultPassthrough',
        name: 'Result Passthrough',
        description:
          'Ensure no Debridio IC4A results are filtered out by anything',
        required: false,
        type: 'boolean',
        default: true,
      },
      debridioSocialOption,
    ];

    return {
      ID: 'debridio-ic4a',
      NAME: 'Debridio IC4A',
      LOGO: debridioLogo,
      URL: Env.DEBRIDIO_IC4A_URL,
      TIMEOUT: Env.DEFAULT_DEBRIDIO_IC4A_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_DEBRIDIO_IC4A_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'IPTV backed livestreams from around the world. Provided by Debridio.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.LIVE_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      DISABLED: {
        reason: 'Deprecated by Debridio',
        disabled: true,
        removed: true,
      },
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
        server: options.server,
        countries: options.countries,
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
}
