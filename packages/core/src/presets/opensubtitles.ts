import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { Env, RESOURCES, SUBTITLES_RESOURCE } from '../utils/index.js';

export class OpenSubtitlesPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [SUBTITLES_RESOURCE];
    const options: Option[] = [
      ...baseOptions(
        'OpenSubtitles',
        supportedResources,
        Env.DEFAULT_OPENSUBTITLES_TIMEOUT
      ).filter((option) => option.id !== 'url'),
    ];

    return {
      ID: 'opensubtitles',
      NAME: 'OpenSubtitles v3',
      LOGO: 'https://iwf1.com/scrapekod/icons/service.subtitles.opensubtitles_by_opensubtitles_dualsub.png',
      URL: Env.OPENSUBTITLES_URL,
      TIMEOUT: Env.DEFAULT_OPENSUBTITLES_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_OPENSUBTITLES_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'OpenSubtitles addon',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
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
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: `${Env.OPENSUBTITLES_URL}/manifest.json`,
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
