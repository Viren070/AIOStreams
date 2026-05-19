// stremio://new-who.onrender.com/manifest.json

import { Addon, Option, ParsedStream, Stream, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import { StreamParser } from '../parser/index.js';

class DoctorWhoUniverseStreamParser extends StreamParser {
  protected override getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return stream.name ?? undefined;
  }
}

export class DoctorWhoUniversePreset extends Preset {
  static override getParser(): typeof StreamParser {
    return DoctorWhoUniverseStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Doctor Who Universe',
        supportedResources,
        appConfig.presets.doctorWhoUniverse.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ),
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          { id: 'github', url: 'https://github.com/nubblyn/whoniverse' },
        ],
      },
    ];

    return {
      ID: 'doctor-who-universe',
      NAME: 'Doctor Who Universe',
      LOGO: 'https://i.imgur.com/zQ9Btju.png',
      URL: appConfig.presets.doctorWhoUniverse.url,
      TIMEOUT:
        appConfig.presets.doctorWhoUniverse.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.doctorWhoUniverse.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'The complete Doctor Who universe, including Classic and New Who episodes, specials, minisodes, prequels, and spinoffs in original UK broadcast order.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
      CATEGORY: constants.PresetCategory.STREAMS,
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
      : this.DEFAULT_URL;
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: `${baseUrl}/manifest.json`,
      enabled: true,
      library: false,
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
}
