import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { Env, RESOURCES, SUBTITLES_RESOURCE } from '../utils/index.js';

export class SubDLPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [SUBTITLES_RESOURCE];

    const languages = [
      { label: 'Albanian', value: 'SQ' },
      { label: 'Arabic', value: 'AR' },
      { label: 'Azerbaijani', value: 'AZ' },
      { label: 'Belarusian', value: 'BE' },
      { label: 'Bengali', value: 'BN' },
      { label: 'Big 5 code', value: 'ZH_BG' },
      { label: 'Bosnian', value: 'BS' },
      { label: 'Brazillian Portuguese', value: 'BR_PT' },
      { label: 'Bulgarian', value: 'BG' },
      { label: 'Bulgarian_English', value: 'BG_EN' },
      { label: 'Burmese', value: 'MY' },
      { label: 'Catalan', value: 'CA' },
      { label: 'Chinese BG code', value: 'ZH' },
      { label: 'Croatian', value: 'HR' },
      { label: 'Czech', value: 'CS' },
      { label: 'Danish', value: 'DA' },
      { label: 'Dutch', value: 'NL' },
      { label: 'Dutch_English', value: 'NL_EN' },
      { label: 'English', value: 'EN' },
      { label: 'English_German', value: 'EN_DE' },
      { label: 'Esperanto', value: 'EO' },
      { label: 'Estonian', value: 'ET' },
      { label: 'Farsi_Persian', value: 'FA' },
      { label: 'Finnish', value: 'FI' },
      { label: 'French', value: 'FR' },
      { label: 'Georgian', value: 'KA' },
      { label: 'German', value: 'DE' },
      { label: 'Greek', value: 'EL' },
      { label: 'Greenlandic', value: 'KL' },
      { label: 'Hebrew', value: 'HE' },
      { label: 'Hindi', value: 'HI' },
      { label: 'Hungarian', value: 'HU' },
      { label: 'Hungarian_English', value: 'HU_EN' },
      { label: 'Icelandic', value: 'IS' },
      { label: 'Indonesian', value: 'ID' },
      { label: 'Italian', value: 'IT' },
      { label: 'Japanese', value: 'JA' },
      { label: 'Korean', value: 'KO' },
      { label: 'Kurdish', value: 'KU' },
      { label: 'Latvian', value: 'LV' },
      { label: 'Lithuanian', value: 'LT' },
      { label: 'Macedonian', value: 'MK' },
      { label: 'Malay', value: 'MS' },
      { label: 'Malayalam', value: 'ML' },
      { label: 'Manipuri', value: 'MNI' },
      { label: 'Norwegian', value: 'NO' },
      { label: 'Polish', value: 'PL' },
      { label: 'Portuguese', value: 'PT' },
      { label: 'Romanian', value: 'RO' },
      { label: 'Russian', value: 'RU' },
      { label: 'Serbian', value: 'SR' },
      { label: 'Sinhala', value: 'SI' },
      { label: 'Slovak', value: 'SK' },
      { label: 'Slovenian', value: 'SL' },
      { label: 'Spanish', value: 'ES' },
      { label: 'Swedish', value: 'SV' },
      { label: 'Tagalog', value: 'TL' },
      { label: 'Tamil', value: 'TA' },
      { label: 'Telugu', value: 'TE' },
      { label: 'Thai', value: 'TH' },
      { label: 'Turkish', value: 'TR' },
      { label: 'Ukranian', value: 'UK' },
      { label: 'Urdu', value: 'UR' },
      { label: 'Vietnamese', value: 'VI' },
    ];

    const options: Option[] = [
      ...baseOptions(
        'SubDL',
        supportedResources,
        Env.DEFAULT_SUBDL_TIMEOUT || Env.DEFAULT_TIMEOUT
      ),
      {
        id: 'subDlApiKey',
        type: 'password',
        name: 'SubDL API Key',
        description:
          'Your SubDL API key, located at your [account panel](https://subdl.com/panel/api)',
        required: true,
      },
      {
        id: 'language',
        type: 'multi-select',
        name: 'Language',
        description: 'Select the languages you want subtitles in',
        options: languages,
        required: true,
        constraints: {
          min: 1,
          max: 5,
        },
      },
      {
        id: 'hearingImpairment',
        type: 'select',
        name: 'Hearing Impairment',
        description: 'Select the hearing impairment you want subtitles in',
        options: [
          { label: 'Include', value: 'hiInclude' },
          { label: 'Exclude', value: 'hiExclude' },
          { label: 'Only', value: 'hiOnly' },
        ],
        required: true,
        default: 'hiInclude',
      },
      {
        id: 'socials',
        type: 'socials',
        name: '',
        description: '',
        socials: [
          {
            id: 'donate',
            url: 'https://sociabuzz.com/apisapis/donate',
          },
        ],
      },
    ];

    return {
      ID: 'subdl',
      NAME: 'SubDL',
      LOGO: 'https://raw.githubusercontent.com/nexusdiscord/tv-logo/master/download.jpg',
      URL: Env.SUBDL_URL,
      TIMEOUT: Env.DEFAULT_SUBDL_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_SUBDL_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'SubDL addon',
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

    const config = Buffer.from(
      `${options.subDlApiKey}/${options.language.join(',')}/${options.hearingImpairment}`
    ).toString('base64');

    return `${host}/${config}/manifest.json`;
  }
}
