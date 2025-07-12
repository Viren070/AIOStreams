import { Addon, Option, UserData } from '../db';
import { Preset, baseOptions } from './preset';
import { Env, RESOURCES, SUBTITLES_RESOURCE } from '../utils';

export class OpenSubtitlesV3PlusPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [SUBTITLES_RESOURCE];

    const languages = [
      { label: 'Afrikaans', value: 'af' },
      { label: 'Belarusian', value: 'be' },
      { label: 'Burmese', value: 'my' },
      { label: 'Abkhazian', value: 'ab' },
      { label: 'Arabic', value: 'ar' },
      { label: 'Armenian', value: 'hy' },
      { label: 'Assamese', value: 'as' },
      { label: 'Asturian', value: 'at' },
      { label: 'Basque', value: 'eu' },
      { label: 'Bengali', value: 'bn' },
      { label: 'Breton', value: 'br' },
      { label: 'Bulgarian', value: 'bg' },
      { label: 'Catalan', value: 'ca' },
      { label: 'French', value: 'fr' },
      { label: 'Georgian', value: 'ka' },
      { label: 'German', value: 'de' },
      { label: 'Gaelic', value: 'gd' },
      { label: 'Irish', value: 'ga' },
      { label: 'Galician', value: 'gl' },
      { label: 'Greek', value: 'el' },
      { label: 'Hebrew', value: 'he' },
      { label: 'Hindi', value: 'hi' },
      { label: 'Croatian', value: 'hr' },
      { label: 'Hungarian', value: 'hu' },
      { label: 'Igbo', value: 'ig' },
      { label: 'Icelandic', value: 'is' },
      { label: 'Interlingua', value: 'ia' },
      { label: 'Kazakh', value: 'kk' },
      { label: 'Latvian', value: 'lv' },
      { label: 'Lithuanian', value: 'lt' },
      { label: 'Malayalam', value: 'ml' },
      { label: 'Italian', value: 'it' },
      { label: 'Japanese', value: 'ja' },
      { label: 'Khmer', value: 'km' },
      { label: 'Korean', value: 'ko' },
      { label: 'Kurdish', value: 'ku' },
      { label: 'Macedonian', value: 'mk' },
      { label: 'Marathi', value: 'mr' },
      { label: 'Navajo', value: 'nv' },
      { label: 'Norwegian', value: 'no' },
      { label: 'Occitan', value: 'oc' },
      { label: 'Persian', value: 'fa' },
      { label: 'Polish', value: 'pl' },
      { label: 'Pushto', value: 'ps' },
      { label: 'Russian', value: 'ru' },
      { label: 'Serbian', value: 'sr' },
      { label: 'Slovak', value: 'sk' },
      { label: 'Slovenian', value: 'sl' },
      { label: 'Syriac', value: 'sy' },
      { label: 'Tamil', value: 'ta' },
      { label: 'Montenegrin', value: 'me' },
      { label: 'Chinese bilingual', value: 'ze' },
      { label: 'Sindhi', value: 'sd' },
      { label: 'Spanish', value: 'es' },
      { label: 'Swahili', value: 'sw' },
      { label: 'Swedish', value: 'sv' },
      { label: 'Tatar', value: 'tt' },
      { label: 'Telugu', value: 'te' },
      { label: 'Thai', value: 'th' },
      { label: 'Turkmen', value: 'tk' },
      { label: 'Turkish', value: 'tr' },
      { label: 'Ukrainian', value: 'uk' },
      { label: 'Uzbek', value: 'uz' },
      { label: 'Vietnamese', value: 'vi' },
      { label: 'Welsh', value: 'cy' },
      { label: 'Romanian', value: 'ro' },
      { label: 'Albanian', value: 'sq' },
      { label: 'Aragonese', value: 'an' },
      { label: 'Azerbaijani', value: 'az' },
      { label: 'Bosnian', value: 'bs' },
      { label: 'Czech', value: 'cs' },
      { label: 'Danish', value: 'da' },
      { label: 'Dutch', value: 'nl' },
      { label: 'English', value: 'en' },
      { label: 'Esperanto', value: 'eo' },
      { label: 'Estonian', value: 'et' },
      { label: 'Finnish', value: 'fi' },
      { label: 'Indonesian', value: 'id' },
      { label: 'Kannada', value: 'kn' },
      { label: 'Luxembourgish', value: 'lb' },
      { label: 'Malay', value: 'ms' },
      { label: 'Manipuri', value: 'ma' },
      { label: 'Mongolian', value: 'mn' },
      { label: 'Nepali', value: 'ne' },
      { label: 'Odia', value: 'or' },
      { label: 'Sinhalese', value: 'si' },
      { label: 'Northern Sami', value: 'se' },
      { label: 'Somali', value: 'so' },
      { label: 'Tagalog', value: 'tl' },
      { label: 'Urdu', value: 'ur' },
      { label: 'Portuguese (MZ)', value: 'pm' },
      { label: 'Spanish (LA)', value: 'ea' },
      { label: 'Extremaduran', value: 'ex' },
      { label: 'Dari', value: 'pr' },
      { label: 'Spanish (EU)', value: 'sp' },
      { label: 'Santali', value: 'sx' },
      { label: 'Toki Pona', value: 'tp' },
    ];

    const options: Option[] = [
      ...baseOptions(
        'OpenSubtitles V3+',
        supportedResources,
        Env.DEFAULT_OPENSUBTITLES_V3_PLUS_TIMEOUT || Env.DEFAULT_TIMEOUT
      ),
      {
        id: 'language',
        type: 'multi-select',
        name: 'Language',
        description: 'Select the languages you want subtitles in',
        options: languages,
        required: true,
        constraints: {
          min: 1,
          max: 10,
        },
      },
      {
        id: 'sources',
        type: 'select',
        name: 'Sources',
        description: 'Filter based on uploaders',
        options: [
          { label: 'Trusted Only', value: 'trusted' },
          { label: 'Users', value: 'users' },
          { label: 'All', value: 'all' },
        ],
        default: 'all',
        required: true,
      },
      {
        id: 'includeAiTranslated',
        type: 'boolean',
        name: 'Include AI Translated',
        description: 'Include AI Translated subtitles',
        default: true,
        required: true,
      },
      {
        id: 'movieHashPlusAutoAdjustment',
        type: 'boolean',
        name: 'Movie Hash + Auto Adjustment',
        description: 'Automatically adjust subtitle timings',
        default: false,
        required: true,
      },
    ];

    return {
      ID: 'opensubtitles-v3-plus',
      NAME: 'OpenSubtitles V3 Pro',
      LOGO: 'https://i.ibb.co/yN39ZPV/opensubtitles-plus-256x256.png',
      URL: Env.OPENSUBTITLES_V3_PLUS_URL,
      TIMEOUT: Env.DEFAULT_OPENSUBTITLES_V3_PLUS_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_OPENSUBTITLES_V3_PLUS_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Subtitles from OpenSubtitles with language selection and more features',
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
      presetType: this.METADATA.ID,
      presetInstanceId: '',
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }

  private static generateManifestUrl(options: Record<string, any>): string {
    if (options.url?.endsWith('/manifest.json')) {
      return options.url;
    }

    const host = (options.url || this.METADATA.URL).replace(/\/$/, '');

    const optionPairs = [
      ['ai-translated', options.includeAiTranslated],
      ['from', options.sources],
      ['auto-adjustment', options.movieHashPlusAutoAdjustment],
    ];
    const config = Buffer.from(
      `${encodeURIComponent(options.language.join('|'))}/${this.urlEncodeKeyValuePairs(optionPairs)}`
    );

    return `${host}/${config}/manifest.json`;
  }
}
