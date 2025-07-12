import {
  Addon,
  Option,
  ParsedStream,
  ParsedFile,
  Stream,
  UserData,
} from '../db';
import { Preset, baseOptions } from './preset';
import { constants, Env, LIVE_STREAM_TYPE } from '../utils';
import { FileParser, StreamParser } from '../parser';

class USATvStreamParser extends StreamParser {
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
}

export class USATVPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return USATvStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions('USA TV', supportedResources, Env.DEFAULT_USA_TV_TIMEOUT),
    ];

    return {
      ID: 'usa-tv',
      NAME: 'USA TV',
      LOGO: `${Env.USA_TV_URL}/public/logo.png`,
      URL: Env.USA_TV_URL,
      TIMEOUT: Env.DEFAULT_USA_TV_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USA_TV_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Provides access to channels across various categories for USA',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [LIVE_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    const baseUrl = options.url
      ? new URL(options.url).origin
      : this.METADATA.URL;

    const url = options.url?.endsWith('/manifest.json')
      ? options.url
      : `${baseUrl}/manifest.json`;
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
