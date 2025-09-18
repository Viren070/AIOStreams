import { Addon, Option, UserData } from '../db/index.js';
import { CacheKeyRequestOptions, Preset, baseOptions } from './preset.js';
import { constants, Env } from '../utils/index.js';
import {
  debridioSocialOption,
  debridioApiKeyOption,
  debridioLogo,
} from './debridio.js';

export class DebridioTmdbPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const languages = [
      { value: 'ab-AB', label: 'Abkhazian' },
      { value: 'aa-AA', label: 'Afar' },
      { value: 'af-AF', label: 'Afrikaans' },
      { value: 'ak-AK', label: 'Akan' },
      { value: 'sq-AL', label: 'Albanian' },
      { value: 'am-AM', label: 'Amharic' },
      { value: 'ar-SA', label: 'Arabic (Saudi Arabia)' },
      { value: 'ar-AE', label: 'Arabic (UAE)' },
      { value: 'an-AN', label: 'Aragonese' },
      { value: 'hy-HY', label: 'Armenian' },
      { value: 'as-AS', label: 'Assamese' },
      { value: 'av-AV', label: 'Avaric' },
      { value: 'ae-AE', label: 'Avestan' },
      { value: 'ay-AY', label: 'Aymara' },
      { value: 'az-AZ', label: 'Azerbaijani' },
      { value: 'bm-BM', label: 'Bambara' },
      { value: 'ba-BA', label: 'Bashkir' },
      { value: 'eu-ES', label: 'Basque' },
      { value: 'be-BY', label: 'Belarusian' },
      { value: 'bn-BD', label: 'Bengali' },
      { value: 'bi-BI', label: 'Bislama' },
      { value: 'nb-NO', label: 'Bokmål' },
      { value: 'bs-BS', label: 'Bosnian' },
      { value: 'br-BR', label: 'Breton' },
      { value: 'bg-BG', label: 'Bulgarian' },
      { value: 'my-MY', label: 'Burmese' },
      { value: 'cn-CN', label: 'Cantonese' },
      { value: 'ca-ES', label: 'Catalan' },
      { value: 'km-KM', label: 'Central Khmer' },
      { value: 'ch-GU', label: 'Chamorro' },
      { value: 'ce-CE', label: 'Chechen' },
      { value: 'ny-NY', label: 'Chichewa' },
      { value: 'zh-CN', label: 'Chinese (China)' },
      { value: 'zh-HK', label: 'Chinese (Hong Kong)' },
      { value: 'zh-TW', label: 'Chinese (Taiwan)' },
      { value: 'cu-CU', label: 'Church Slavic' },
      { value: 'cv-CV', label: 'Chuvash' },
      { value: 'kw-KW', label: 'Cornish' },
      { value: 'co-CO', label: 'Corsican' },
      { value: 'cr-CR', label: 'Cree' },
      { value: 'hr-HR', label: 'Croatian' },
      { value: 'cs-CZ', label: 'Czech' },
      { value: 'da-DK', label: 'Danish' },
      { value: 'dv-DV', label: 'Divehi' },
      { value: 'nl-NL', label: 'Dutch' },
      { value: 'dz-DZ', label: 'Dzongkha' },
      { value: 'en-US', label: 'English (US)' },
      { value: 'en-AU', label: 'English (Australia)' },
      { value: 'en-CA', label: 'English (Canada)' },
      { value: 'en-GB', label: 'English (UK)' },
      { value: 'en-IE', label: 'English (Ireland)' },
      { value: 'en-NZ', label: 'English (New Zealand)' },
      { value: 'eo-EO', label: 'Esperanto' },
      { value: 'et-EE', label: 'Estonian' },
      { value: 'ee-EE', label: 'Ewe' },
      { value: 'fo-FO', label: 'Faroese' },
      { value: 'fj-FJ', label: 'Fijian' },
      { value: 'fi-FI', label: 'Finnish' },
      { value: 'fr-FR', label: 'French (France)' },
      { value: 'fr-CA', label: 'French (Canada)' },
      { value: 'ff-FF', label: 'Fulah' },
      { value: 'gd-GD', label: 'Gaelic' },
      { value: 'gl-ES', label: 'Galician' },
      { value: 'lg-LG', label: 'Ganda' },
      { value: 'ka-GE', label: 'Georgian' },
      { value: 'de-DE', label: 'German (Germany)' },
      { value: 'de-AT', label: 'German (Austria)' },
      { value: 'de-CH', label: 'German (Switzerland)' },
      { value: 'el-GR', label: 'Greek' },
      { value: 'gn-GN', label: 'Guarani' },
      { value: 'gu-GU', label: 'Gujarati' },
      { value: 'ht-HT', label: 'Haitian' },
      { value: 'ha-HA', label: 'Hausa' },
      { value: 'he-IL', label: 'Hebrew' },
      { value: 'hz-HZ', label: 'Herero' },
      { value: 'hi-IN', label: 'Hindi' },
      { value: 'ho-HO', label: 'Hiri Motu' },
      { value: 'hu-HU', label: 'Hungarian' },
      { value: 'is-IS', label: 'Icelandic' },
      { value: 'io-IO', label: 'Ido' },
      { value: 'ig-IG', label: 'Igbo' },
      { value: 'id-ID', label: 'Indonesian' },
      { value: 'ia-IA', label: 'Interlingua' },
      { value: 'ie-IE', label: 'Interlingue' },
      { value: 'iu-IU', label: 'Inuktitut' },
      { value: 'ik-IK', label: 'Inupiaq' },
      { value: 'ga-GA', label: 'Irish' },
      { value: 'it-IT', label: 'Italian' },
      { value: 'ja-JP', label: 'Japanese' },
      { value: 'jv-JV', label: 'Javanese' },
      { value: 'kl-KL', label: 'Kalaallisut' },
      { value: 'kn-IN', label: 'Kannada' },
      { value: 'kr-KR', label: 'Kanuri' },
      { value: 'ks-KS', label: 'Kashmiri' },
      { value: 'kk-KZ', label: 'Kazakh' },
      { value: 'ki-KI', label: 'Kikuyu' },
      { value: 'rw-RW', label: 'Kinyarwanda' },
      { value: 'ky-KY', label: 'Kirghiz' },
      { value: 'kv-KV', label: 'Komi' },
      { value: 'kg-KG', label: 'Kongo' },
      { value: 'ko-KR', label: 'Korean' },
      { value: 'kj-KJ', label: 'Kuanyama' },
      { value: 'ku-KU', label: 'Kurdish' },
      { value: 'lo-LO', label: 'Lao' },
      { value: 'la-LA', label: 'Latin' },
      { value: 'lv-LV', label: 'Latvian' },
      { value: 'li-LI', label: 'Limburgan' },
      { value: 'ln-LN', label: 'Lingala' },
      { value: 'lt-LT', label: 'Lithuanian' },
      { value: 'lu-LU', label: 'Luba-Katanga' },
      { value: 'lb-LB', label: 'Luxembourgish' },
      { value: 'mk-MK', label: 'Macedonian' },
      { value: 'mg-MG', label: 'Malagasy' },
      { value: 'ms-MY', label: 'Malay (Malaysia)' },
      { value: 'ms-SG', label: 'Malay (Singapore)' },
      { value: 'ml-IN', label: 'Malayalam' },
      { value: 'mt-MT', label: 'Maltese' },
      { value: 'gv-GV', label: 'Manx' },
      { value: 'mi-MI', label: 'Maori' },
      { value: 'mr-MR', label: 'Marathi' },
      { value: 'mh-MH', label: 'Marshallese' },
      { value: 'mo-MO', label: 'Moldavian' },
      { value: 'mn-MN', label: 'Mongolian' },
      { value: 'na-NA', label: 'Nauru' },
      { value: 'nv-NV', label: 'Navajo' },
      { value: 'nd-ND', label: 'North Ndebele' },
      { value: 'nr-NR', label: 'South Ndebele' },
      { value: 'ng-NG', label: 'Ndonga' },
      { value: 'ne-NE', label: 'Nepali' },
      { value: 'se-SE', label: 'Northern Sami' },
      { value: 'no-NO', label: 'Norwegian' },
      { value: 'nn-NN', label: 'Norwegian Nynorsk' },
      { value: 'oc-OC', label: 'Occitan' },
      { value: 'oj-OJ', label: 'Ojibwa' },
      { value: 'or-OR', label: 'Oriya' },
      { value: 'om-OM', label: 'Oromo' },
      { value: 'os-OS', label: 'Ossetian' },
      { value: 'pi-PI', label: 'Pali' },
      { value: 'pa-PA', label: 'Panjabi' },
      { value: 'fa-IR', label: 'Persian' },
      { value: 'pl-PL', label: 'Polish' },
      { value: 'pt-PT', label: 'Portuguese (Portugal)' },
      { value: 'pt-BR', label: 'Portuguese (Brazil)' },
      { value: 'ps-PS', label: 'Pushto' },
      { value: 'qu-QU', label: 'Quechua' },
      { value: 'ro-RO', label: 'Romanian' },
      { value: 'rm-RM', label: 'Romansh' },
      { value: 'rn-RN', label: 'Rundi' },
      { value: 'ru-RU', label: 'Russian' },
      { value: 'sm-SM', label: 'Samoan' },
      { value: 'sg-SG', label: 'Sango' },
      { value: 'sa-SA', label: 'Sanskrit' },
      { value: 'sc-SC', label: 'Sardinian' },
      { value: 'sr-RS', label: 'Serbian' },
      { value: 'sh-SH', label: 'Serbo-Croatian' },
      { value: 'sn-SN', label: 'Shona' },
      { value: 'ii-II', label: 'Sichuan Yi' },
      { value: 'sd-SD', label: 'Sindhi' },
      { value: 'si-LK', label: 'Sinhala' },
      { value: 'sk-SK', label: 'Slovak' },
      { value: 'sl-SI', label: 'Slovenian' },
      { value: 'so-SO', label: 'Somali' },
      { value: 'st-ST', label: 'Sotho' },
      { value: 'es-ES', label: 'Spanish (Spain)' },
      { value: 'es-MX', label: 'Spanish (Mexico)' },
      { value: 'su-SU', label: 'Sundanese' },
      { value: 'sw-SW', label: 'Swahili' },
      { value: 'ss-SS', label: 'Swati' },
      { value: 'sv-SE', label: 'Swedish' },
      { value: 'tl-PH', label: 'Tagalog' },
      { value: 'ty-TY', label: 'Tahitian' },
      { value: 'tg-TG', label: 'Tajik' },
      { value: 'ta-IN', label: 'Tamil' },
      { value: 'tt-TT', label: 'Tatar' },
      { value: 'te-IN', label: 'Telugu' },
      { value: 'th-TH', label: 'Thai' },
      { value: 'bo-BO', label: 'Tibetan' },
      { value: 'ti-TI', label: 'Tigrinya' },
      { value: 'to-TO', label: 'Tonga' },
      { value: 'ts-TS', label: 'Tsonga' },
      { value: 'tn-TN', label: 'Tswana' },
      { value: 'tr-TR', label: 'Turkish' },
      { value: 'tk-TK', label: 'Turkmen' },
      { value: 'tw-TW', label: 'Twi' },
      { value: 'ug-UG', label: 'Uighur' },
      { value: 'uk-UA', label: 'Ukrainian' },
      { value: 'ur-UR', label: 'Urdu' },
      { value: 'uz-UZ', label: 'Uzbek' },
      { value: 've-VE', label: 'Venda' },
      { value: 'vi-VN', label: 'Vietnamese' },
      { value: 'vo-VO', label: 'Volapük' },
      { value: 'wa-WA', label: 'Walloon' },
      { value: 'cy-CY', label: 'Welsh' },
      { value: 'fy-FY', label: 'Western Frisian' },
      { value: 'wo-WO', label: 'Wolof' },
      { value: 'xh-XH', label: 'Xhosa' },
      { value: 'yi-YI', label: 'Yiddish' },
      { value: 'yo-YO', label: 'Yoruba' },
      { value: 'za-ZA', label: 'Zhuang' },
      { value: 'zu-ZA', label: 'Zulu' },
    ];

    const options: Option[] = [
      ...baseOptions(
        'Debridio TMDB',
        supportedResources,
        Env.DEFAULT_DEBRIDIO_TMDB_TIMEOUT
      ),
      debridioApiKeyOption,
      {
        id: 'language',
        name: 'Language',
        description: 'The language of the catalogs',
        type: 'select',
        default: 'en-US',
        options: languages,
        required: false,
      },
      debridioSocialOption,
    ];

    return {
      ID: 'debridio-tmdb',
      NAME: 'Debridio TMDB',
      LOGO: debridioLogo,
      URL: Env.DEBRIDIO_TMDB_URL,
      TIMEOUT: Env.DEFAULT_DEBRIDIO_TMDB_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_DEBRIDIO_TMDB_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Catalogs for the Debridio TMDB',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    if (!options.debridioApiKey && !options.url) {
      throw new Error(
        'To access the Debridio addons, you must provide your Debridio API Key'
      );
    }
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    let url = this.METADATA.URL;
    if (options.url?.endsWith('/manifest.json')) {
      url = options.url;
    } else {
      let baseUrl = this.METADATA.URL;
      if (options.url) {
        baseUrl = new URL(options.url).origin;
      }
      // remove trailing slash
      baseUrl = baseUrl.replace(/\/$/, '');
      if (!options.debridioApiKey) {
        throw new Error(
          'To access the Debridio addons, you must provide your Debridio API Key'
        );
      }
      const config = this.base64EncodeJSON({
        api_key: options.debridioApiKey,
        language: options.language || 'en-US',
        rpdb_api: '',
        catalogs: [
          {
            id: 'debridio_tmdb.movie_trending',
            home: true,
            enabled: true,
            name: 'Trending',
          },
          {
            id: 'debridio_tmdb.movie_popular',
            home: true,
            enabled: true,
            name: 'Popular',
          },
          {
            id: 'debridio_tmdb.tv_trending',
            home: true,
            enabled: true,
            name: 'Trending',
          },
          {
            id: 'debridio_tmdb.tv_popular',
            home: true,
            enabled: true,
            name: 'Popular',
          },
          {
            id: 'debridio_tmdb.search_collections',
            home: false,
            enabled: true,
            name: 'Search',
          },
        ],
      });
      url = `${baseUrl}/${config}/manifest.json`;
    }

    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: url,
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
    if (
      resource === constants.CATALOG_RESOURCE ||
      resource === constants.META_RESOURCE
    ) {
      cacheKey += `-${presetOptions.language}`;
    }
    if (resource === 'manifest') {
      cacheKey += `-${presetOptions.debridioApiKey}`;
    }
    return cacheKey;
  }
}
