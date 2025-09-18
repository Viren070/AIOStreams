import { Addon, Option, ParsedStream, Stream, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants, Env, FULL_LANGUAGE_MAPPING } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';

class TmdbCollectionsStreamParser extends StreamParser {
  protected override getFilename(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return undefined;
  }

  protected override getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    const message = stream.description?.match(/"([^"]*)"/);
    return message ? message[1] : undefined;
  }
}

export class TmdbCollectionsPreset extends Preset {
  static override getParser() {
    return TmdbCollectionsStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'TMDB Collections',
        supportedResources,
        Env.DEFAULT_TMDB_COLLECTIONS_TIMEOUT
      ),
      {
        id: 'enableAdultContent',
        name: 'Enable Adult Content',
        description: 'Enable adult content in the catalogs',
        type: 'boolean',
        default: false,
        required: false,
      },
      {
        id: 'enableSearch',
        name: 'Enable Search',
        description: 'Enable search in the catalogs',
        type: 'boolean',
        default: true,
        required: false,
      },
      {
        id: 'enableCollectionFromMovie',
        name: 'Add Collection Stream',
        description:
          'Adds a stream link to movies that links to its collection page.',
        type: 'boolean',
        default: false,
        required: false,
      },
      {
        id: 'moveStreamLinkToTop',
        name: 'Move Stream Link to Top',
        description:
          'Push any streams from the above option to the top of the stream list.',
        type: 'boolean',
        default: true,
        required: false,
      },
      {
        id: 'language',
        name: 'Language',
        description: 'The language of the catalogs',
        type: 'select',
        default: 'en',
        options: [
          {
            label: 'English',
            value: 'en',
          },
          {
            label: 'Afar (Qafár af)',
            value: 'aa',
          },
          {
            label: 'Afrikaans',
            value: 'af',
          },
          {
            label: 'Akan (Akan)',
            value: 'ak',
          },
          {
            label: 'Aragonese (Aragonés)',
            value: 'an',
          },
          {
            label: 'Assamese (অসমীয়া)',
            value: 'as',
          },
          {
            label: 'Avaric (Авар мацӀ)',
            value: 'av',
          },
          {
            label: 'Avestan (Avesta)',
            value: 'ae',
          },
          {
            label: 'Aymara (Aymar aru)',
            value: 'ay',
          },
          {
            label: 'Azerbaijani (Azərbaycan)',
            value: 'az',
          },
          {
            label: 'Bashkir (Башҡорт теле)',
            value: 'ba',
          },
          {
            label: 'Bambara (Bamanankan)',
            value: 'bm',
          },
          {
            label: 'Bengali (বাংলা)',
            value: 'bn',
          },
          {
            label: 'Bislama (Bislama)',
            value: 'bi',
          },
          {
            label: 'Tibetan (བོད་ཡིག)',
            value: 'bo',
          },
          {
            label: 'Bosnian (Bosanski)',
            value: 'bs',
          },
          {
            label: 'Breton (Brezhoneg)',
            value: 'br',
          },
          {
            label: 'Catalan (Català)',
            value: 'ca',
          },
          {
            label: 'Czech (Český)',
            value: 'cs',
          },
          {
            label: "Chamorro (Finu' Chamorro)",
            value: 'ch',
          },
          {
            label: 'Chechen (Нохчийн мотт)',
            value: 'ce',
          },
          {
            label: 'Slavic (Словѣньскъ)',
            value: 'cu',
          },
          {
            label: 'Chuvash (Чӑваш чӗлхи)',
            value: 'cv',
          },
          {
            label: 'Cornish (Kernewek)',
            value: 'kw',
          },
          {
            label: 'Corsican (Corsu)',
            value: 'co',
          },
          {
            label: 'Cree (ᓀᐦᐃᔭᐍᐏᐣ)',
            value: 'cr',
          },
          {
            label: 'Welsh (Cymraeg)',
            value: 'cy',
          },
          {
            label: 'Danish (Dansk)',
            value: 'da',
          },
          {
            label: 'German (Deutsch)',
            value: 'de',
          },
          {
            label: 'Divehi (ދިވެހި)',
            value: 'dv',
          },
          {
            label: 'Dzongkha (རྫོང་ཁ)',
            value: 'dz',
          },
          {
            label: 'Esperanto',
            value: 'eo',
          },
          {
            label: 'Estonian (Eesti)',
            value: 'et',
          },
          {
            label: 'Basque (Euskera)',
            value: 'eu',
          },
          {
            label: 'Faroese (Føroyskt)',
            value: 'fo',
          },
          {
            label: 'Fijian (Vosa Vakaviti)',
            value: 'fj',
          },
          {
            label: 'Finnish (Suomi)',
            value: 'fi',
          },
          {
            label: 'French (Français)',
            value: 'fr',
          },
          {
            label: 'Frisian (Frysk)',
            value: 'fy',
          },
          {
            label: 'Fulah (Fulfulde)',
            value: 'ff',
          },
          {
            label: 'Gaelic (Gàidhlig)',
            value: 'gd',
          },
          {
            label: 'Irish (Gaeilge)',
            value: 'ga',
          },
          {
            label: 'Galician (Galego)',
            value: 'gl',
          },
          {
            label: 'Manx (Gaelg)',
            value: 'gv',
          },
          {
            label: "Guarani (Avañe'ẽ)",
            value: 'gn',
          },
          {
            label: 'Gujarati (ગુજરાતી)',
            value: 'gu',
          },
          {
            label: 'Haitian; Haitian Creole (Kreyòl ayisyen)',
            value: 'ht',
          },
          {
            label: 'Hausa',
            value: 'ha',
          },
          {
            label: 'Serbo-Croatian (Srpskohrvatski)',
            value: 'sh',
          },
          {
            label: 'Herero (Otjiherero)',
            value: 'hz',
          },
          {
            label: 'Hiri Motu (Hiri Motu)',
            value: 'ho',
          },
          {
            label: 'Croatian (Hrvatski)',
            value: 'hr',
          },
          {
            label: 'Hungarian (Magyar)',
            value: 'hu',
          },
          {
            label: 'Igbo (Asụsụ Igbo)',
            value: 'ig',
          },
          {
            label: 'Ido (Ido)',
            value: 'io',
          },
          {
            label: 'Yi (ꆈꌠꉙ)',
            value: 'ii',
          },
          {
            label: 'Inuktitut (ᐃᓄᒃᑎᑐᑦ)',
            value: 'iu',
          },
          {
            label: 'Interlingue (Interlingue)',
            value: 'ie',
          },
          {
            label: 'Interlingua (Interlingua)',
            value: 'ia',
          },
          {
            label: 'Indonesian (Bahasa indonesia)',
            value: 'id',
          },
          {
            label: 'Inupiaq (Iñupiaq)',
            value: 'ik',
          },
          {
            label: 'Icelandic (Íslenska)',
            value: 'is',
          },
          {
            label: 'Italian (Italiano)',
            value: 'it',
          },
          {
            label: 'Javanese (Basa Jawa)',
            value: 'jv',
          },
          {
            label: 'Japanese (日本語)',
            value: 'ja',
          },
          {
            label: 'Kalaallisut (Kalaallisut)',
            value: 'kl',
          },
          {
            label: 'Kannada',
            value: 'kn',
          },
          {
            label: 'Kashmiri (कश्मीरी)',
            value: 'ks',
          },
          {
            label: 'Georgian (ქართული)',
            value: 'ka',
          },
          {
            label: 'Kanuri (Kanuri)',
            value: 'kr',
          },
          {
            label: 'Kazakh (Қазақ)',
            value: 'kk',
          },
          {
            label: 'Khmer (ភាសាខ្មែរ)',
            value: 'km',
          },
          {
            label: 'Kikuyu (Gĩkũyũ)',
            value: 'ki',
          },
          {
            label: 'Kinyarwanda',
            value: 'rw',
          },
          {
            label: 'Kirghiz',
            value: 'ky',
          },
          {
            label: 'Komi (Коми кыв)',
            value: 'kv',
          },
          {
            label: 'Kongo (KiKongo)',
            value: 'kg',
          },
          {
            label: 'Korean (한국어/조선말)',
            value: 'ko',
          },
          {
            label: 'Kuanyama (Kuanyama)',
            value: 'kj',
          },
          {
            label: 'Kurdish (Kurdî)',
            value: 'ku',
          },
          {
            label: 'Lao (ພາສາລາວ)',
            value: 'lo',
          },
          {
            label: 'Latin',
            value: 'la',
          },
          {
            label: 'Latvian (Latviešu)',
            value: 'lv',
          },
          {
            label: 'Limburgish (Limburgs)',
            value: 'li',
          },
          {
            label: 'Lingala (Lingála)',
            value: 'ln',
          },
          {
            label: 'Lithuanian (Lietuvių)',
            value: 'lt',
          },
          {
            label: 'Letzeburgesch (Lëtzebuergesch)',
            value: 'lb',
          },
          {
            label: 'Luba-Katanga (Tshiluba)',
            value: 'lu',
          },
          {
            label: 'Ganda (Luganda)',
            value: 'lg',
          },
          {
            label: 'Marshall (Kajin M̧ajeļ)',
            value: 'mh',
          },
          {
            label: 'Malayalam (മലയാളം)',
            value: 'ml',
          },
          {
            label: 'Marathi (मराठी)',
            value: 'mr',
          },
          {
            label: 'Malagasy (Malagasy)',
            value: 'mg',
          },
          {
            label: 'Maltese (Malti)',
            value: 'mt',
          },
          {
            label: 'Moldavian (Лимба молдовеняскэ)',
            value: 'mo',
          },
          {
            label: 'Mongolian (Монгол)',
            value: 'mn',
          },
          {
            label: 'Maori (Te Reo Māori)',
            value: 'mi',
          },
          {
            label: 'Malay (Bahasa melayu)',
            value: 'ms',
          },
          {
            label: 'Burmese (ဗမာစာ)',
            value: 'my',
          },
          {
            label: 'Nauru (Dorerin Naoero)',
            value: 'na',
          },
          {
            label: 'Navajo (Diné bizaad)',
            value: 'nv',
          },
          {
            label: 'Ndebele (IsiNdebele)',
            value: 'nr',
          },
          {
            label: 'Ndebele (IsiNdebele)',
            value: 'nd',
          },
          {
            label: 'Ndonga (Owambo)',
            value: 'ng',
          },
          {
            label: 'Nepali (नेपाली)',
            value: 'ne',
          },
          {
            label: 'Dutch (Nederlands)',
            value: 'nl',
          },
          {
            label: 'Norwegian Nynorsk (Nynorsk)',
            value: 'nn',
          },
          {
            label: 'Norwegian Bokmål (Bokmål)',
            value: 'nb',
          },
          {
            label: 'Norwegian (Norsk)',
            value: 'no',
          },
          {
            label: 'Chichewa; Nyanja (ChiCheŵa)',
            value: 'ny',
          },
          {
            label: 'Occitan (Occitan)',
            value: 'oc',
          },
          {
            label: 'Ojibwa (ᐊᓂᔑᓈᐯᒧᐎᓐ)',
            value: 'oj',
          },
          {
            label: 'Oriya (ଓଡ଼ିଆ)',
            value: 'or',
          },
          {
            label: 'Oromo (Afaan Oromoo)',
            value: 'om',
          },
          {
            label: 'Ossetian; Ossetic (Ирон æвзаг)',
            value: 'os',
          },
          {
            label: 'Punjabi (ਪੰਜਾਬੀ)',
            value: 'pa',
          },
          {
            label: 'Pali (पाऴि)',
            value: 'pi',
          },
          {
            label: 'Polish (Polski)',
            value: 'pl',
          },
          {
            label: 'Portuguese (Português)',
            value: 'pt',
          },
          {
            label: 'Quechua (Runa Simi)',
            value: 'qu',
          },
          {
            label: 'Raeto-Romance (Rumantsch grischun)',
            value: 'rm',
          },
          {
            label: 'Romanian (Română)',
            value: 'ro',
          },
          {
            label: 'Rundi (Kirundi)',
            value: 'rn',
          },
          {
            label: 'Russian (Pусский)',
            value: 'ru',
          },
          {
            label: 'Sango (Yângâ tî sängö)',
            value: 'sg',
          },
          {
            label: 'Sanskrit (संस्कृतम्)',
            value: 'sa',
          },
          {
            label: 'Sinhalese (සිංහල)',
            value: 'si',
          },
          {
            label: 'Slovak (Slovenčina)',
            value: 'sk',
          },
          {
            label: 'Slovenian (Slovenščina)',
            value: 'sl',
          },
          {
            label: 'Northern Sami (Davvisámegiella)',
            value: 'se',
          },
          {
            label: "Samoan (Gagana fa'a Samoa)",
            value: 'sm',
          },
          {
            label: 'Shona (ChiShona)',
            value: 'sn',
          },
          {
            label: 'Sindhi (सिन्धी)',
            value: 'sd',
          },
          {
            label: 'Somali',
            value: 'so',
          },
          {
            label: 'Sotho (Sesotho)',
            value: 'st',
          },
          {
            label: 'Spanish (Español)',
            value: 'es',
          },
          {
            label: 'Albanian (Shqip)',
            value: 'sq',
          },
          {
            label: 'Sardinian (Sardu)',
            value: 'sc',
          },
          {
            label: 'Serbian (Srpski)',
            value: 'sr',
          },
          {
            label: 'Swati (SiSwati)',
            value: 'ss',
          },
          {
            label: 'Sundanese (Basa Sunda)',
            value: 'su',
          },
          {
            label: 'Swahili (Kiswahili)',
            value: 'sw',
          },
          {
            label: 'Swedish (Svenska)',
            value: 'sv',
          },
          {
            label: 'Tahitian (Reo Tahiti)',
            value: 'ty',
          },
          {
            label: 'Tamil (தமிழ்)',
            value: 'ta',
          },
          {
            label: 'Tatar (Татар теле)',
            value: 'tt',
          },
          {
            label: 'Telugu (తెలుగు)',
            value: 'te',
          },
          {
            label: 'Tajik (тоҷикӣ)',
            value: 'tg',
          },
          {
            label: 'Tagalog (Wikang Tagalog)',
            value: 'tl',
          },
          {
            label: 'Thai (ภาษาไทย)',
            value: 'th',
          },
          {
            label: 'Tigrinya (ትግርኛ)',
            value: 'ti',
          },
          {
            label: 'Tonga (Faka Tonga)',
            value: 'to',
          },
          {
            label: 'Tswana (Setswana)',
            value: 'tn',
          },
          {
            label: 'Tsonga (Xitsonga)',
            value: 'ts',
          },
          {
            label: 'Turkmen (Türkmen)',
            value: 'tk',
          },
          {
            label: 'Turkish (Türkçe)',
            value: 'tr',
          },
          {
            label: 'Twi (Twi)',
            value: 'tw',
          },
          {
            label: 'Uighur (Uyƣurqə)',
            value: 'ug',
          },
          {
            label: 'Ukrainian (Український)',
            value: 'uk',
          },
          {
            label: 'Urdu (اردو)',
            value: 'ur',
          },
          {
            label: 'Uzbek (Ozbek)',
            value: 'uz',
          },
          {
            label: 'Venda (Tshivenḓa)',
            value: 've',
          },
          {
            label: 'Vietnamese (Tiếng Việt)',
            value: 'vi',
          },
          {
            label: 'Volapük (Volapük)',
            value: 'vo',
          },
          {
            label: 'Walloon (Walon)',
            value: 'wa',
          },
          {
            label: 'Wolof',
            value: 'wo',
          },
          {
            label: 'Xhosa (IsiXhosa)',
            value: 'xh',
          },
          {
            label: 'Yiddish (ייִדיש)',
            value: 'yi',
          },
          {
            label: 'Zhuang (Saɯ cueŋƅ)',
            value: 'za',
          },
          {
            label: 'Zulu (IsiZulu)',
            value: 'zu',
          },
          {
            label: 'Abkhazian (Аҧсуа бызшәа)',
            value: 'ab',
          },
          {
            label: 'Mandarin (普通话)',
            value: 'zh',
          },
          {
            label: 'Pushto (پښتو)',
            value: 'ps',
          },
          {
            label: 'Amharic (አማርኛ)',
            value: 'am',
          },
          {
            label: 'Arabic (العربية)',
            value: 'ar',
          },
          {
            label: 'Belarusian (Беларуская мова)',
            value: 'be',
          },
          {
            label: 'Bulgarian (Български език)',
            value: 'bg',
          },
          {
            label: 'Cantonese (广州话 / 廣州話)',
            value: 'cn',
          },
          {
            label: 'Macedonian (Македонски јазик)',
            value: 'mk',
          },
          {
            label: 'Ewe (Èʋegbe)',
            value: 'ee',
          },
          {
            label: 'Greek (Ελληνικά)',
            value: 'el',
          },
          {
            label: 'Persian (فارسی)',
            value: 'fa',
          },
          {
            label: 'Hebrew (עִבְרִית)',
            value: 'he',
          },
          {
            label: 'Hindi (हिन्दी)',
            value: 'hi',
          },
          {
            label: 'Armenian (Հայերեն)',
            value: 'hy',
          },
          {
            label: 'Yoruba (Èdè Yorùbá)',
            value: 'yo',
          },
        ],
        required: false,
      },
      {
        id: 'alert',
        name: '',
        description:
          'The language selector above will not work for some languages due to the option values not being consistent. In which case, you can override the URL with a preconfigured Manifest URL.',
        type: 'alert',
      },
      // https://github.com/youchi1/tmdb-collections/
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          { id: 'github', url: 'https://github.com/youchi1/tmdb-collections' },
        ],
      },
    ];

    return {
      ID: 'tmdb-collections',
      NAME: 'TMDB Collections',
      LOGO: 'https://raw.githubusercontent.com/youchi1/tmdb-collections/main/Images/logo.png',
      URL: Env.TMDB_COLLECTIONS_URL,
      TIMEOUT: Env.DEFAULT_TMDB_COLLECTIONS_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_TMDB_COLLECTIONS_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Catalogs for the TMDB Collections',
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
      manifestUrl: this.generateManifestUrl(userData, options),
      enabled: true,
      library: false,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      forceToTop: options.moveStreamLinkToTop ?? true,
      resultPassthrough: true,
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

  private static generateManifestUrl(
    userData: UserData,
    options: Record<string, any>
  ) {
    let url = options.url || this.METADATA.URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    url = url.replace(/\/$/, '');
    const config = this.urlEncodeJSON({
      enableAdultContent: options.enableAdultContent ?? false,
      enableSearch: options.enableSearch ?? true,
      enableCollectionFromMovie: options.enableCollectionFromMovie ?? false,
      language: options.language,
      catalogList: ['popular', 'topRated', 'newReleases'],
      discoverOnly: { popular: false, topRated: false, newReleases: false },
    });
    return `${url}/${config}/manifest.json`;
  }
}
