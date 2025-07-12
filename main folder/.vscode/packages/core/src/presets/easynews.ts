import { baseOptions, Preset } from './preset';
import { constants, Env } from '../utils';
import {
  PresetMetadata,
  Option,
  Addon,
  UserData,
  ParsedStream,
  Stream,
} from '../db';
import { StreamParser } from '../parser';

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
        Env.DEFAULT_EASYNEWS_TIMEOUT
      ),
    ];

    return {
      ID: 'easynews',
      NAME: 'Easynews',
      DESCRIPTION:
        'The original Easynews addon, to access streams from Easynews',
      LOGO: `https://pbs.twimg.com/profile_images/479627852757733376/8v9zH7Yo_400x400.jpeg`,
      URL: Env.EASYNEWS_URL,
      TIMEOUT: Env.DEFAULT_EASYNEWS_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_EASYNEWS_USER_AGENT || Env.DEFAULT_USER_AGENT,
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
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      presetType: this.METADATA.ID,
      presetInstanceId: '',
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
    let url = options.url || this.METADATA.URL;
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
