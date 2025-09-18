import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants, Env } from '../utils/index.js';

export class TorrentCatalogsPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [constants.CATALOG_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Torrent Catalogs',
        supportedResources,
        Env.DEFAULT_TORRENT_CATALOGS_TIMEOUT
      ).filter((option) => option.id !== 'url'),
    ];

    return {
      ID: 'torrent-catalogs',
      NAME: 'Torrent Catalogs',
      LOGO: 'https://i.ibb.co/w4BnkC9/GwxAcDV.png',
      URL: Env.TORRENT_CATALOGS_URL,
      TIMEOUT: Env.DEFAULT_TORRENT_CATALOGS_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_TORRENT_CATALOGS_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Provides catalogs for movies/series/anime based on top seeded torrents. Requires Kitsu addon for anime.',
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
      manifestUrl: `${Env.TORRENT_CATALOGS_URL}/manifest.json`,
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
