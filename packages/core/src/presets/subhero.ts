import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import {
  constants,
  FULL_LANGUAGE_MAPPING,
  SUBTITLES_RESOURCE,
} from '../utils/index.js';
import { config as appConfig } from '../config/index.js';

export class SubHeroPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [SUBTITLES_RESOURCE];

    let languagesC = [
      'af',
      'ar',
      'az',
      'be',
      'bg',
      'bn',
      'bs',
      'ca',
      'cs',
      'da',
      'de',
      'el',
      'en',
      'es',
      'et',
      'fa',
      'fi',
      'fr',
      'he',
      'hi',
      'hr',
      'hu',
      'hy',
      'id',
      'is',
      'it',
      'ja',
      'ka',
      'kk',
      'ko',
      'lt',
      'lv',
      'mk',
      'mn',
      'ms',
      'nb',
      'nl',
      'nn',
      'no',
      'pl',
      'pt',
      'ro',
      'ru',
      'sk',
      'sl',
      'sq',
      'sr',
      'sv',
      'th',
      'tr',
      'uk',
      'vi',
      'zh',
      'ze',
      'zt',
    ];
    const languages = languagesC.map((lang) => {
      const langObjs = FULL_LANGUAGE_MAPPING.filter(
        (l) => l.iso_639_1 === lang
      );
      const langObj = langObjs.find((l) => l.flag_priority) || langObjs[0];

      return {
        label: langObj
          ? `${langObj?.flag} ${langObj?.english_name?.split('(')[0]?.trim()} (${lang.toUpperCase()})`
          : lang,
        value: lang,
      };
    });
    languages.push({
      label: 'Portuguese (Brazil)',
      value: 'pb',
    });

    const options: Option[] = [
      ...baseOptions(
        'SubHero',
        supportedResources,
        appConfig.presets.subhero.defaultTimeout ??
          appConfig.presets.defaultTimeout
      ),
      {
        id: 'languages',
        type: 'multi-select',
        name: 'Languages',
        description: 'Select the languages you want subtitles in',
        options: languages,
        required: true,
        constraints: {
          min: 1,
        },
      },
    ];

    return {
      ID: 'subhero',
      NAME: 'SubHero',
      LOGO: `https://subhero.chromeknight.dev/static/logo4x4.png`,
      URL: appConfig.presets.subhero.url,
      TIMEOUT:
        appConfig.presets.subhero.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.subhero.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Subtitles with language filtering, caching, file format conversion and more. Powered by Wyzie API.',
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
      manifestUrl: this.generateManifestUrl(options),
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

  private static generateManifestUrl(options: Record<string, any>): string {
    if (options.url?.endsWith('/manifest.json')) {
      return options.url;
    }
    const host = options.url || this.DEFAULT_URL;

    let config = this.urlEncodeJSON({
      language: options.languages.join(','),
    });

    return `${host}/${config}/manifest.json`;
  }
}
