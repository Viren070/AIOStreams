import {
  Addon,
  Option,
  ParsedFile,
  ParsedStream,
  Stream,
  UserData,
} from '../db';
import { Preset, baseOptions } from './preset';
import { constants, createLogger, Env } from '../utils';
import { debridioSocialOption } from './debridio';
import { FileParser, StreamParser } from '../parser';
const logger = createLogger('DebridioTvPreset');
class DebridioTvStreamParser extends StreamParser {
  protected override getParsedFile(
    stream: Stream,
    parsedStream: ParsedStream
  ): ParsedFile | undefined {
    const parsed = stream.name ? FileParser.parse(stream.name) : undefined;
    if (!parsed) {
      return undefined;
    }
    logger.debug(`resolution: ${parsed}`);

    return {
      ...parsed,
      title: undefined,
    };
  }
  protected override getFilename(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    logger.debug('returning undefined for filename');
    return undefined;
  }

  protected override getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return `${stream.name} - ${stream.description}`;
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
        label: 'Mexico',
        value: 'mx',
      },
      {
        label: 'UK',
        value: 'uk',
      },
      {
        label: 'France',
        value: 'fr',
      },
      {
        label: 'Chile',
        value: 'cl',
      },
      {
        label: 'Italy',
        value: 'it',
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
      {
        id: 'debridioApiKey',
        name: 'Debridio API Key',
        description:
          'Your Debridio API Key, located at your [account settings](https://debridio.com/account)',
        type: 'password',
        required: true,
      },
      {
        id: 'channels',
        name: 'Channels',
        description: 'The channels to display',
        type: 'multi-select',
        required: true,
        options: channels,
        default: channels.map((channel) => channel.value),
      },
      debridioSocialOption,
    ];

    return {
      ID: 'debridio-tv',
      NAME: 'Debridio TV',
      LOGO: 'https://res.cloudinary.com/adobotec/image/upload/w_120,h_120/v1735925306/debridio/logo.png.png',
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
      presetType: this.METADATA.ID,
      presetInstanceId: '',
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }
}
