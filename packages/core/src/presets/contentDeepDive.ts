import { Addon, Option, ParsedStream, Stream, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants, Env } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';

class ContentDeepDiveStreamParser extends StreamParser {
  protected getFilename(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return undefined;
  }

  protected getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return stream.description || undefined;
  }
}

export class ContentDeepDivePreset extends Preset {
  static override getParser(): typeof StreamParser {
    return ContentDeepDiveStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Content Deep Dive',
        supportedResources,
        Env.DEFAULT_CONTENT_DEEP_DIVE_TIMEOUT
      ),
      {
        id: 'forceToTop',
        name: 'Force to Top',
        description:
          'If enabled, streams from this addon will be forced to the top of the list.',
        type: 'boolean',
        default: true,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'buymeacoffee',
            url: 'https://buymeacoffee.com/contentdeepdive',
          },
        ],
      },
    ];

    return {
      ID: 'content-deep-dive',
      NAME: 'Content Deep Dive',
      LOGO: `${Env.CONTENT_DEEP_DIVE_URL}/DeepDiveLogo.png`,
      URL: Env.CONTENT_DEEP_DIVE_URL,
      TIMEOUT: Env.DEFAULT_CONTENT_DEEP_DIVE_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_CONTENT_DEEP_DIVE_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'A comprehensive companion addon that provides detailed content information, cast details, reviews, and production insights for movies and series.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [await this.generateAddon(userData, options)];
  }

  private static async generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon> {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: this.generateManifestUrl(options),
      enabled: true,
      library: false,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      forceToTop: options.forceToTop ?? true,
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

  private static generateManifestUrl(options: Record<string, any>): string {
    let url = (options.url || this.METADATA.URL).replace(/\/$/, '');
    if (url.endsWith('/manifest.json')) {
      return url;
    }

    return `${url}/manifest.json`;
  }
}
