import { Addon, Option, UserData } from '../db/index.js';
import { CacheKeyRequestOptions, Preset, baseOptions } from './preset.js';
import { constants, Env } from '../utils/index.js';

export class MarvelPreset extends Preset {
  private static catalogs = [
    {
      label: 'MCU Chronological Order',
      value: 'marvel-mcu',
    },
    {
      label: 'MCU Release Order',
      value: 'release-order',
    },
    {
      label: 'X-Men Chronological Order',
      value: 'xmen',
    },
    {
      label: 'Marvel Movies',
      value: 'movies',
    },
    {
      label: 'Marvel TV Shows',
      value: 'series',
    },
    {
      label: 'Marvel Animated Series',
      value: 'animations',
    },
  ];
  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Marvel Universe',
        supportedResources,
        Env.DEFAULT_MARVEL_CATALOG_TIMEOUT
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
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          { id: 'github', url: 'https://github.com/joaogonp/addon-marvel' },
          { id: 'buymeacoffee', url: 'https://buymeacoffee.com/joaogonp' },
        ],
      },
    ];

    return {
      ID: 'marvel-universe',
      NAME: 'Marvel Universe',
      LOGO: 'https://upload.wikimedia.org/wikipedia/commons/b/b9/Marvel_Logo.svg',
      URL: Env.MARVEL_UNIVERSE_URL,
      TIMEOUT: Env.DEFAULT_MARVEL_CATALOG_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_MARVEL_CATALOG_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Catalogs for the Marvel Universe',
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
    const config =
      options.catalogs.length !== this.catalogs.length
        ? options.catalogs.join('%2C')
        : '';
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: `${Env.MARVEL_UNIVERSE_URL}/${config ? 'catalog/' + config + '/' : ''}manifest.json`,
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
      if (new URL(presetOptions.url).origin !== this.METADATA.URL) {
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
