import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';

export class OneZeroOneCatalogsPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [constants.CATALOG_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        '101Catalogs',
        supportedResources,
        appConfig.presets.oneZeroOneCatalogs.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ).filter((option) => option.id !== 'url'),
      {
        id: 'installationUrl',
        name: 'Installation URL',
        description:
          'Configure your catalogs and retrieve your unique installation URL from [config.101catalogs.xyz](https://config.101catalogs.xyz), then paste it here.',
        type: 'password',
        required: true,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [{ id: 'website', url: 'https://config.101catalogs.xyz' }],
      },
    ];

    return {
      ID: '101catalogs',
      NAME: '101Catalogs',
      LOGO: 'https://ik.imagekit.io/royalancap/101catalogs/logo101.png',
      URL: appConfig.presets.oneZeroOneCatalogs.url,
      TIMEOUT:
        appConfig.presets.oneZeroOneCatalogs.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.oneZeroOneCatalogs.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Customize your catalog with 550+ lists configured via [config.101catalogs.xyz](https://config.101catalogs.xyz).',
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
    const urlStr = options.installationUrl;
    if (typeof urlStr !== 'string' || !urlStr.trim()) {
      throw new Error('101Catalogs installation URL is required and must be a valid string.');
    }

    try {
      const parsedUrl = new URL(urlStr.trim());
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Installation URL must use HTTP or HTTPS protocol.');
      }
      if (!parsedUrl.pathname.endsWith('/manifest.json')) {
        throw new Error('Installation URL pathname must end with /manifest.json');
      }
    } catch (err: any) {
      throw new Error(`Invalid 101Catalogs installation URL: ${err.message || err}`);
    }

    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: options.installationUrl,
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
