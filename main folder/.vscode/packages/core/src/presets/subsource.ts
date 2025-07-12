import { Addon, Option, UserData } from '../db';
import { Preset, baseOptions } from './preset';
import { Env, RESOURCES, SUBTITLES_RESOURCE } from '../utils';

export class SubSourcePreset extends Preset {
  static override get METADATA() {
    const supportedResources = [SUBTITLES_RESOURCE];

    const languages = [
      { label: 'Abkhazian', value: 'Abkhazian' },
      { label: 'Afrikaans', value: 'Afrikaans' },
      { label: 'Albanian', value: 'Albanian' },
      { label: 'Amharic', value: 'Amharic' },
      { label: 'Arabic', value: 'Arabic' },
      { label: 'Aragonese', value: 'Aragonese' },
      { label: 'Armenian', value: 'Armenian' },
      { label: 'Assamese', value: 'Assamese' },
      { label: 'Asturian', value: 'Asturian' },
      { label: 'Azerbaijani', value: 'Azerbaijani' },
      { label: 'Basque', value: 'Basque' },
      { label: 'Belarusian', value: 'Belarusian' },
      { label: 'Bengali', value: 'Bengali' },
      { label: 'Big 5 code', value: 'Big 5 code' },
      { label: 'Bosnian', value: 'Bosnian' },
      { label: 'Brazillian Portuguese', value: 'Brazillian Portuguese' },
      { label: 'Breton', value: 'Breton' },
      { label: 'Bulgarian', value: 'Bulgarian' },
      { label: 'Burmese', value: 'Burmese' },
      { label: 'Catalan', value: 'Catalan' },
      { label: 'Chinese', value: 'Chinese' },
      { label: 'Chinese BG code', value: 'Chinese BG code' },
      { label: 'Chinese (Cantonese)', value: 'Chinese (Cantonese)' },
      { label: 'Chinese (Simplified)', value: 'Chinese (Simplified)' },
      { label: 'Chinese (Traditional)', value: 'Chinese (Traditional)' },
      { label: 'Chinese Bilingual', value: 'Chinese Bilingual' },
      { label: 'Croatian', value: 'Croatian' },
      { label: 'Czech', value: 'Czech' },
      { label: 'Danish', value: 'Danish' },
      { label: 'Dari', value: 'Dari' },
      { label: 'Dutch', value: 'Dutch' },
      { label: 'English', value: 'English' },
      { label: 'Esperanto', value: 'Esperanto' },
      { label: 'Estonian', value: 'Estonian' },
      { label: 'Extremaduran', value: 'Extremaduran' },
      { label: 'Farsi/Persian', value: 'Farsi/Persian' },
      { label: 'Finnish', value: 'Finnish' },
      { label: 'French', value: 'French' },
      { label: 'French (Canada)', value: 'French (Canada)' },
      { label: 'French (France)', value: 'French (France)' },
      { label: 'Gaelic', value: 'Gaelic' },
      { label: 'Galician', value: 'Galician' },
      { label: 'Georgian', value: 'Georgian' },
      { label: 'German', value: 'German' },
      { label: 'Greek', value: 'Greek' },
      { label: 'Greenlandic', value: 'Greenlandic' },
      { label: 'Hebrew', value: 'Hebrew' },
      { label: 'Hindi', value: 'Hindi' },
      { label: 'Hungarian', value: 'Hungarian' },
      { label: 'Icelandic', value: 'Icelandic' },
      { label: 'Igbo', value: 'Igbo' },
      { label: 'Indonesian', value: 'Indonesian' },
      { label: 'Interlingua', value: 'Interlingua' },
      { label: 'Irish', value: 'Irish' },
      { label: 'Italian', value: 'Italian' },
      { label: 'Japanese', value: 'Japanese' },
      { label: 'Kannada', value: 'Kannada' },
      { label: 'Kazakh', value: 'Kazakh' },
      { label: 'Khmer', value: 'Khmer' },
      { label: 'Korean', value: 'Korean' },
      { label: 'Kurdish', value: 'Kurdish' },
      { label: 'Kyrgyz', value: 'Kyrgyz' },
      { label: 'Latvian', value: 'Latvian' },
      { label: 'Lithuanian', value: 'Lithuanian' },
      { label: 'Luxembourgish', value: 'Luxembourgish' },
      { label: 'Macedonian', value: 'Macedonian' },
      { label: 'Malay', value: 'Malay' },
      { label: 'Malayalam', value: 'Malayalam' },
      { label: 'Manipuri', value: 'Manipuri' },
      { label: 'Marathi', value: 'Marathi' },
      { label: 'Mongolian', value: 'Mongolian' },
      { label: 'Montenegrin', value: 'Montenegrin' },
      { label: 'Navajo', value: 'Navajo' },
      { label: 'Nepali', value: 'Nepali' },
      { label: 'Northen Sami', value: 'Northen Sami' },
      { label: 'Norwegian', value: 'Norwegian' },
      { label: 'Occitan', value: 'Occitan' },
      { label: 'Odia', value: 'Odia' },
      { label: 'Pashto', value: 'Pashto' },
      { label: 'Polish', value: 'Polish' },
      { label: 'Portuguese', value: 'Portuguese' },
      { label: 'Romanian', value: 'Romanian' },
      { label: 'Russian', value: 'Russian' },
      { label: 'Santli', value: 'Santli' },
      { label: 'Serbian', value: 'Serbian' },
      { label: 'Sindhi', value: 'Sindhi' },
      { label: 'Sinhala', value: 'Sinhala' },
      { label: 'Sinhalese', value: 'Sinhalese' },
      { label: 'Slovak', value: 'Slovak' },
      { label: 'Slovenian', value: 'Slovenian' },
      { label: 'Somali', value: 'Somali' },
      { label: 'Sorbian', value: 'Sorbian' },
      { label: 'Spanish', value: 'Spanish' },
      { label: 'Spanish (Latin America)', value: 'Spanish (Latin America)' },
      { label: 'Spanish (Spain)', value: 'Spanish (Spain)' },
      { label: 'Swahili', value: 'Swahili' },
      { label: 'Swedish', value: 'Swedish' },
      { label: 'Syriac', value: 'Syriac' },
      { label: 'Tagalog', value: 'Tagalog' },
      { label: 'Tamil', value: 'Tamil' },
      { label: 'Tatar', value: 'Tatar' },
      { label: 'Telugu', value: 'Telugu' },
      { label: 'Tetum', value: 'Tetum' },
      { label: 'Thai', value: 'Thai' },
      { label: 'Toki Pona', value: 'Toki Pona' },
      { label: 'Turkish', value: 'Turkish' },
      { label: 'Turkmen', value: 'Turkmen' },
      { label: 'Ukrainian', value: 'Ukrainian' },
      { label: 'Urdu', value: 'Urdu' },
      { label: 'Uzbek', value: 'Uzbek' },
      { label: 'Vietnamese', value: 'Vietnamese' },
      { label: 'Welsh', value: 'Welsh' },
    ];

    const options: Option[] = [
      ...baseOptions(
        'SubSource',
        supportedResources,
        Env.DEFAULT_SUBSOURCE_TIMEOUT || Env.DEFAULT_TIMEOUT
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
      ID: 'subsource',
      NAME: 'SubSource',
      LOGO: 'https://raw.githubusercontent.com/nexusdiscord/tv-logo/master/ss.png',
      URL: Env.SUBSOURCE_URL,
      TIMEOUT: Env.DEFAULT_SUBSOURCE_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_SUBSOURCE_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'SubSource addon',
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

    const host = options.url || this.METADATA.URL;

    const config = Buffer.from(
      `${options.language.join(',')}/${options.hearingImpairment}`
    ).toString('base64');

    return `${host}/${config}/manifest.json`;
  }
}
