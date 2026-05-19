import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants, RESOURCES, SUBTITLES_RESOURCE } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';

export class OpenSubtitlesPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [SUBTITLES_RESOURCE];
    const options: Option[] = [
      ...baseOptions(
        'OpenSubtitles',
        supportedResources,
        appConfig.presets.opensubtitles.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ).filter((option) => option.id !== 'url'),
    ];

    return {
      ID: 'opensubtitles',
      NAME: 'OpenSubtitles v3',
      LOGO: 'https://iwf1.com/scrapekod/icons/service.subtitles.opensubtitles_by_opensubtitles_dualsub.png',
      URL: appConfig.presets.opensubtitles.url,
      TIMEOUT:
        appConfig.presets.opensubtitles.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.opensubtitles.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'OpenSubtitles addon',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
      CATEGORY: constants.PresetCategory.SUBTITLES,
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
      manifestUrl: `${this.DEFAULT_URL}/manifest.json`,
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
