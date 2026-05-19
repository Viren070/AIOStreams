import { Addon, Option, UserData } from '../db/index.js';
import { CacheKeyRequestOptions, Preset, baseOptions } from './preset.js';
import { constants } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';

export class StarWarsUniversePreset extends Preset {
  private static catalogs = [
    {
      label: 'Movies & Series Chronological',
      value: 'sw-movies-series-chronological',
    },
    {
      label: 'Movies & Series Release',
      value: 'sw-movies-series-release',
    },
    {
      label: 'Skywalker Saga',
      value: 'sw-skywalker-saga',
    },
    {
      label: 'Anthology Films',
      value: 'sw-anthology-films',
    },
    {
      label: 'Live-Action Series',
      value: 'sw-live-action-series',
    },
    {
      label: 'Animated Series',
      value: 'sw-animated-series',
    },
    {
      label: 'Micro-Series & Shorts',
      value: 'sw-micro-series-shorts',
    },
    {
      label: 'High Republic Era',
      value: 'sw-high-republic-era',
    },
    {
      label: 'Empire Era',
      value: 'sw-empire-era',
    },
    {
      label: 'New Republic Era',
      value: 'sw-new-republic-era',
    },
    {
      label: 'Bounty Hunters & Underworld',
      value: 'sw-bounty-hunters-underworld',
    },
    {
      label: 'Jedi & Sith Lore',
      value: 'sw-jedi-sith-lore',
    },
    {
      label: 'Droids & Creatures',
      value: 'sw-droids-creatures',
    },
  ];
  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Star Wars Universe',
        supportedResources,
        appConfig.presets.starWarsUniverse.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ).filter((option) => option.id !== 'url'),
      {
        id: 'catalogs',
        name: 'Catalogs',
        description: 'The catalogs to display',
        type: 'multi-select',
        required: true,
        options: this.catalogs,
        default: this.catalogs.map((catalog) => catalog.value),
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          { id: 'github', url: 'https://github.com/tapframe/addon-star-wars' },
          { id: 'ko-fi', url: 'https://ko-fi.com/tapframe' },
        ],
      },
    ];

    return {
      ID: 'star-wars-universe',
      NAME: 'Star Wars Universe',
      LOGO: 'https://www.freeiconspng.com/uploads/logo-star-wars-png-4.png',
      URL: appConfig.presets.starWarsUniverse.url,
      TIMEOUT:
        appConfig.presets.starWarsUniverse.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.starWarsUniverse.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Explore the Star Wars Universe by sagas, series, eras, and more!',
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
    const config =
      options.catalogs.length !== this.catalogs.length
        ? options.catalogs.join('%2C')
        : '';
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: `${this.DEFAULT_URL}/${config ? 'catalog/' + config + '/' : ''}manifest.json`,
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
