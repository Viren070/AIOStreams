import { Addon, Option, UserData } from '../db/index.js';
import { CacheKeyRequestOptions, Preset, baseOptions } from './preset.js';
import { constants } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';

export class RpdbCatalogsPreset extends Preset {
  private static catalogs = [
    {
      label: 'Movies',
      value: 'movie',
    },
    {
      label: 'Series',
      value: 'series',
    },
    {
      label: 'Other (News / Talk-Shows / Reality TV etc.)',
      value: 'other',
    },
  ];
  static override get METADATA() {
    const supportedResources = [constants.CATALOG_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'RPDB Catalogs',
        supportedResources,
        appConfig.presets.rpdbCatalogs.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ).filter((option) => option.id !== 'url'),
      // series movies animations xmen release-order marvel-mcu
      {
        id: 'catalogs',
        name: 'Catalogs',
        description: 'The catalogs to display',
        type: 'multi-select',
        required: true,
        options: this.catalogs,
        default: this.catalogs.map((catalog) => catalog.value),
      },
    ];

    return {
      ID: 'rpdb-catalogs',
      NAME: 'RPDB Catalogs',
      LOGO: `${appConfig.presets.rpdbCatalogs.url[0] ?? ''}/addon-logo.png`,
      URL: appConfig.presets.rpdbCatalogs.url,
      TIMEOUT:
        appConfig.presets.rpdbCatalogs.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.rpdbCatalogs.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Catalogs to accurately track new / popular / best release!',
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
    if (!userData.rpdbApiKey) {
      throw new Error(
        `${this.METADATA.NAME} requires an RPDB API Key. Please provide one in the services section`
      );
    }
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: `${this.DEFAULT_URL}/${userData.rpdbApiKey}/poster-default/${options.catalogs.join('_')}/manifest.json`,
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

  static override getCacheKey(
    options: CacheKeyRequestOptions
  ): string | undefined {
    const { resource, type, id, options: presetOptions, extras } = options;
    try {
      if (new URL(presetOptions.url).pathname.endsWith('/manifest.json')) {
        return undefined;
      }
      if (new URL(presetOptions.url).origin !== this.DEFAULT_URL) {
        return undefined;
      }
    } catch {}
    let cacheKey = `${this.METADATA.ID}-${type}-${id}-${extras}`;
    if (resource === 'manifest') {
      cacheKey += `-${presetOptions.catalogs.sort((a: string, b: string) =>
        a.localeCompare(b)
      )}`;
    }
    return cacheKey;
  }
}
