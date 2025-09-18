import {
  Addon,
  Option,
  ParsedFile,
  ParsedStream,
  Stream,
  UserData,
} from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants, Env, LIVE_STREAM_TYPE } from '../utils/index.js';
import { FileParser, StreamParser } from '../parser/index.js';

class ArgentinaTvStreamParser extends StreamParser {
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

export class ArgentinaTVPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return ArgentinaTvStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Argentina TV',
        supportedResources,
        Env.DEFAULT_ARGENTINA_TV_TIMEOUT
      ),
    ];

    return {
      ID: 'argentina-tv',
      NAME: 'Argentina TV',
      LOGO: `${Env.ARGENTINA_TV_URL}/public/logo.png`,
      URL: Env.ARGENTINA_TV_URL,
      TIMEOUT: Env.DEFAULT_ARGENTINA_TV_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_ARGENTINA_TV_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Provides access to channels across various categories for Argentina',
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
      resultPassthrough: true,
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
