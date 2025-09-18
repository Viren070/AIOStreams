import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import {
  Env,
  FULL_LANGUAGE_MAPPING,
  SUBTITLES_RESOURCE,
} from '../utils/index.js';

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
        Env.DEFAULT_SUBHERO_TIMEOUT || Env.DEFAULT_TIMEOUT
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
      LOGO: `https://images.icon-icons.com/3606/PNG/512/sculpture_statue_texture_futuristic_art_geometry_organic_abstract_shape_explode_shae_icon_226539.png`,
      URL: Env.SUBHERO_URL,
      TIMEOUT: Env.DEFAULT_SUBHERO_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_SUBHERO_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Subtitles provided & scraped by Wyzie API',
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
    const host = options.url || this.METADATA.URL;

    let config = this.urlEncodeJSON({
      language: options.languages.join(','),
    });

    return `${host}/${config}/manifest.json`;
  }
}
