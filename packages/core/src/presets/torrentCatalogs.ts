import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';

export class TorrentCatalogsPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [constants.CATALOG_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Torrent Catalogs',
        supportedResources,
        appConfig.presets.torrentCatalogs.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ).filter((option) => option.id !== 'url'),
    ];

    return {
      ID: 'torrent-catalogs',
      NAME: 'Torrent Catalogs',
      LOGO: 'https://i.ibb.co/w4BnkC9/GwxAcDV.png',
      URL: appConfig.presets.torrentCatalogs.url,
      TIMEOUT:
        appConfig.presets.torrentCatalogs.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.torrentCatalogs.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Provides catalogs for movies/series/anime based on top seeded torrents. Requires Kitsu addon for anime.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
      CATEGORY: constants.PresetCategory.META_CATALOGS,
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
