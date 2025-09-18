import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants, Env } from '../utils/index.js';

export class AnimeKitsuPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Anime Kitsu',
        supportedResources,
        Env.DEFAULT_ANIME_KITSU_TIMEOUT
      ),
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'github',
            url: 'https://github.com/TheBeastLT/stremio-kitsu-anime',
          },
        ],
      },
    ];

    return {
      ID: 'anime-kitsu',
      NAME: 'Anime Kitsu',
      LOGO: 'https://i.imgur.com/7N6XGoO.png',
      URL: Env.ANIME_KITSU_URL,
      TIMEOUT: Env.DEFAULT_ANIME_KITSU_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_ANIME_KITSU_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Anime catalog using Kitsu',
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
    const baseUrl = options.url
      ? new URL(options.url).origin
      : Env.ANIME_KITSU_URL;
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
