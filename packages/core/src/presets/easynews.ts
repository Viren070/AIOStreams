import { baseOptions, Preset } from './preset.js';
import { constants } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import {
  PresetMetadata,
  Option,
  Addon,
  UserData,
  ParsedStream,
  Stream,
} from '../db/index.js';
import { StreamParser } from '../parser/index.js';

export class EasynewsParser extends StreamParser {
  protected override getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return constants.USENET_STREAM_TYPE;
  }
}

export class EasynewsPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return EasynewsParser;
  }

  static override get METADATA(): PresetMetadata {
    const supportedServices = [constants.EASYNEWS_SERVICE];
    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Easynews',
        supportedResources,
        appConfig.presets.easynews.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ),
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
      ID: 'easynews',
      NAME: 'Easynews',
      DESCRIPTION:
        'The original Easynews addon, to access streams from Easynews',
      LOGO: `https://pbs.twimg.com/profile_images/479627852757733376/8v9zH7Yo_400x400.jpeg`,
      URL: appConfig.presets.easynews.url,
      TIMEOUT:
        appConfig.presets.easynews.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.easynews.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: supportedServices,
      SUPPORTED_RESOURCES: supportedResources,
      SUPPORTED_STREAM_TYPES: [constants.USENET_STREAM_TYPE],
      OPTIONS: options,
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
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: this.generateManifestUrl(userData, options),
      enabled: true,
      mediaTypes: options.mediaTypes || [],
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

  protected static generateConfig(
    easynewsCredentials: {
      username: string;
      password: string;
    },
    options: Record<string, any>
  ) {
    return this.urlEncodeJSON({
      username: easynewsCredentials.username,
      password: easynewsCredentials.password,
    });
  }

  private static generateManifestUrl(
    userData: UserData,
    options: Record<string, any>
  ) {
    let url = options.url || this.DEFAULT_URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    url = url.replace(/\/$/, '');
    const easynewsCredentials = this.getServiceCredential(
      constants.EASYNEWS_SERVICE,
      userData
    );
    if (!easynewsCredentials) {
      throw new Error(
        `${this.METADATA.NAME} requires the Easynews service to be enabled.`
      );
    }
    return `${url}/${this.generateConfig(easynewsCredentials, options)}/manifest.json`;
  }
}
