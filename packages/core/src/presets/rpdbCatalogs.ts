import { Addon, Option, UserData } from '../db/index.js';
import { CacheKeyRequestOptions, Preset, baseOptions } from './preset.js';
import { constants, Env } from '../utils/index.js';

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
        Env.DEFAULT_RPDB_CATALOGS_TIMEOUT
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
      LOGO: `${Env.RPDB_CATALOGS_URL}/addon-logo.png`,
      URL: Env.RPDB_CATALOGS_URL,
      TIMEOUT: Env.DEFAULT_RPDB_CATALOGS_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_RPDB_CATALOGS_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Catalogs to accurately track new / popular / best release!',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
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
      manifestUrl: `${Env.RPDB_CATALOGS_URL}/${userData.rpdbApiKey}/poster-default/${options.catalogs.join('_')}/manifest.json`,
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
