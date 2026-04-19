import { Addon, Option, ParsedStream, Stream, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import {
  constants,
  Env,
  HTTP_STREAM_TYPE,
  LIVE_STREAM_TYPE,
} from '../utils/index.js';
import StreamParser from '../parser/streams.js';

const wyzieLanguageOptions = [
  { value: 'aa', label: 'Afar' },
  { value: 'ab', label: 'Abkhazian' },
  { value: 'ae', label: 'Avestan' },
  { value: 'af', label: 'Afrikaans' },
  { value: 'ak', label: 'Akan' },
  { value: 'am', label: 'Amharic' },
  { value: 'an', label: 'Aragonese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'as', label: 'Assamese' },
  { value: 'av', label: 'Avaric' },
  { value: 'ay', label: 'Aymara' },
  { value: 'az', label: 'Azerbaijani' },
  { value: 'ba', label: 'Bashkir' },
  { value: 'be', label: 'Belarusian' },
  { value: 'bg', label: 'Bulgarian' },
  { value: 'bh', label: 'Bihari' },
  { value: 'bi', label: 'Bislama' },
  { value: 'bm', label: 'Bambara' },
  { value: 'bn', label: 'Bengali' },
  { value: 'bo', label: 'Tibetan' },
  { value: 'br', label: 'Breton' },
  { value: 'bs', label: 'Bosnian' },
  { value: 'ca', label: 'Catalan' },
  { value: 'ce', label: 'Chechen' },
  { value: 'ch', label: 'Chamorro' },
  { value: 'co', label: 'Corsican' },
  { value: 'cr', label: 'Cree' },
  { value: 'cs', label: 'Czech' },
  { value: 'cu', label: 'Church Slavonic' },
  { value: 'cv', label: 'Chuvash' },
  { value: 'cy', label: 'Welsh' },
  { value: 'da', label: 'Danish' },
  { value: 'de', label: 'German' },
  { value: 'dv', label: 'Divehi' },
  { value: 'dz', label: 'Dzongkha' },
  { value: 'ee', label: 'Ewe' },
  { value: 'el', label: 'Greek' },
  { value: 'en', label: 'English' },
  { value: 'eo', label: 'Esperanto' },
  { value: 'es', label: 'Spanish' },
  { value: 'et', label: 'Estonian' },
  { value: 'eu', label: 'Basque' },
  { value: 'fa', label: 'Persian' },
  { value: 'ff', label: 'Fulah' },
  { value: 'fi', label: 'Finnish' },
  { value: 'fj', label: 'Fijian' },
  { value: 'fo', label: 'Faroese' },
  { value: 'fr', label: 'French' },
  { value: 'fy', label: 'Western Frisian' },
  { value: 'ga', label: 'Irish' },
  { value: 'gd', label: 'Scottish Gaelic' },
  { value: 'gl', label: 'Galician' },
  { value: 'gn', label: 'Guarani' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'gv', label: 'Manx' },
  { value: 'ha', label: 'Hausa' },
  { value: 'he', label: 'Hebrew' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ho', label: 'Hiri Motu' },
  { value: 'hr', label: 'Croatian' },
  { value: 'ht', label: 'Haitian Creole' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'hy', label: 'Armenian' },
  { value: 'hz', label: 'Herero' },
  { value: 'ia', label: 'Interlingua' },
  { value: 'id', label: 'Indonesian' },
  { value: 'ie', label: 'Interlingue' },
  { value: 'ig', label: 'Igbo' },
  { value: 'ii', label: 'Sichuan Yi' },
  { value: 'ik', label: 'Inupiaq' },
  { value: 'io', label: 'Ido' },
  { value: 'is', label: 'Icelandic' },
  { value: 'it', label: 'Italian' },
  { value: 'iu', label: 'Inuktitut' },
  { value: 'ja', label: 'Japanese' },
  { value: 'jv', label: 'Javanese' },
  { value: 'ka', label: 'Georgian' },
  { value: 'kg', label: 'Kongo' },
  { value: 'ki', label: 'Kikuyu' },
  { value: 'kj', label: 'Kuanyama' },
  { value: 'kk', label: 'Kazakh' },
  { value: 'kl', label: 'Kalaallisut' },
  { value: 'km', label: 'Khmer' },
  { value: 'kn', label: 'Kannada' },
  { value: 'ko', label: 'Korean' },
  { value: 'kr', label: 'Kanuri' },
  { value: 'ks', label: 'Kashmiri' },
  { value: 'ku', label: 'Kurdish' },
  { value: 'kv', label: 'Komi' },
  { value: 'kw', label: 'Cornish' },
  { value: 'ky', label: 'Kyrgyz' },
  { value: 'la', label: 'Latin' },
  { value: 'lb', label: 'Luxembourgish' },
  { value: 'lg', label: 'Ganda' },
  { value: 'li', label: 'Limburgish' },
  { value: 'ln', label: 'Lingala' },
  { value: 'lo', label: 'Lao' },
  { value: 'lt', label: 'Lithuanian' },
  { value: 'lu', label: 'Luba-Katanga' },
  { value: 'lv', label: 'Latvian' },
  { value: 'mg', label: 'Malagasy' },
  { value: 'mh', label: 'Marshallese' },
  { value: 'mi', label: 'Maori' },
  { value: 'mk', label: 'Macedonian' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'mn', label: 'Mongolian' },
  { value: 'mr', label: 'Marathi' },
  { value: 'ms', label: 'Malay' },
  { value: 'mt', label: 'Maltese' },
  { value: 'my', label: 'Burmese' },
  { value: 'na', label: 'Nauru' },
  { value: 'nb', label: 'Norwegian Bokmal' },
  { value: 'nd', label: 'North Ndebele' },
  { value: 'ne', label: 'Nepali' },
  { value: 'ng', label: 'Ndonga' },
  { value: 'nl', label: 'Dutch' },
  { value: 'nn', label: 'Norwegian Nynorsk' },
  { value: 'no', label: 'Norwegian' },
  { value: 'nr', label: 'South Ndebele' },
  { value: 'nv', label: 'Navajo' },
  { value: 'ny', label: 'Chichewa' },
  { value: 'oc', label: 'Occitan' },
  { value: 'oj', label: 'Ojibwa' },
  { value: 'om', label: 'Oromo' },
  { value: 'or', label: 'Odia' },
  { value: 'os', label: 'Ossetian' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'pi', label: 'Pali' },
  { value: 'pl', label: 'Polish' },
  { value: 'ps', label: 'Pashto' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'qu', label: 'Quechua' },
  { value: 'rm', label: 'Romansh' },
  { value: 'rn', label: 'Kirundi' },
  { value: 'ro', label: 'Romanian' },
  { value: 'ru', label: 'Russian' },
  { value: 'rw', label: 'Kinyarwanda' },
  { value: 'sa', label: 'Sanskrit' },
  { value: 'sc', label: 'Sardinian' },
  { value: 'sd', label: 'Sindhi' },
  { value: 'se', label: 'Northern Sami' },
  { value: 'sg', label: 'Sango' },
  { value: 'si', label: 'Sinhala' },
  { value: 'sk', label: 'Slovak' },
  { value: 'sl', label: 'Slovenian' },
  { value: 'sm', label: 'Samoan' },
  { value: 'sn', label: 'Shona' },
  { value: 'so', label: 'Somali' },
  { value: 'sq', label: 'Albanian' },
  { value: 'sr', label: 'Serbian' },
  { value: 'ss', label: 'Swati' },
  { value: 'st', label: 'Southern Sotho' },
  { value: 'su', label: 'Sundanese' },
  { value: 'sv', label: 'Swedish' },
  { value: 'sw', label: 'Swahili' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'tg', label: 'Tajik' },
  { value: 'th', label: 'Thai' },
  { value: 'ti', label: 'Tigrinya' },
  { value: 'tk', label: 'Turkmen' },
  { value: 'tl', label: 'Tagalog' },
  { value: 'tn', label: 'Tswana' },
  { value: 'to', label: 'Tonga' },
  { value: 'tr', label: 'Turkish' },
  { value: 'ts', label: 'Tsonga' },
  { value: 'tt', label: 'Tatar' },
  { value: 'tw', label: 'Twi' },
  { value: 'ty', label: 'Tahitian' },
  { value: 'ug', label: 'Uighur' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'ur', label: 'Urdu' },
  { value: 'uz', label: 'Uzbek' },
  { value: 've', label: 'Venda' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'vo', label: 'Volapuk' },
  { value: 'wa', label: 'Walloon' },
  { value: 'wo', label: 'Wolof' },
  { value: 'xh', label: 'Xhosa' },
  { value: 'yi', label: 'Yiddish' },
  { value: 'yo', label: 'Yoruba' },
  { value: 'za', label: 'Zhuang' },
  { value: 'zh', label: 'Chinese' },
  { value: 'zu', label: 'Zulu' },
] as const;

const supportedResources = [
  constants.STREAM_RESOURCE,
  constants.CATALOG_RESOURCE,
  constants.META_RESOURCE,
];

const marketplaceDefaults = {
  enable_vidzee: true,
  enable_autoembed: false,
  enable_vixsrc: false,
  enable_cineby: false,
  enable_aniways: false,
  enable_animeav1: false,
  enable_a111477: false,
  enable_kisskh: false,
  enable_hdhub4u: true,
  enable_rivestream: false,
  enable_vadapav: false,
  enable_uhdmovies: false,
  enable_vegamovies: false,
  enable_moviesmod: false,
  enable_animeflix: false,
  enable_gokuhd: false,
  enable_hollymoviehd: false,
  enable_livetv_sx: false,
  enable_librefutbol: false,
  enable_freelivesports: false,
  enable_toonami_aftermath: false,
  enable_mkvcinemas: false,
  enable_ee3: false,
  enable_debrid_vault: true,
  enable_jellyfin: false,
  enable_jellyfin_live_tv: false,
  enable_emby: true,
  enable_telegram: true,
  enable_filesearchtools: false,
  enable_egybest: false,
  enable_naija2movies: false,
  telegram_server: 'server1',
  enable_live_tv_catalog: true,
  famelack_countries: ['us'],
  enable_wyzie: true,
  supporter_token: '',
  wyzie_languages: ['en'],
  wyzie_formats: ['srt', 'ass'],
  wyzie_source: 'all',
  wyzie_hearing_impaired: false,
  wyzie_max_results: 8,
} as const;

const supporterHint: Option = {
  id: 'supporterHint',
  name: 'Supporter Access',
  description:
    'Paid access unlocks the premium provider stack, including Signal Vault, Media Library, sports relays, anime sources, and the rest of the supporter-only providers. Total support is matched by payment email: 5.00 USD unlocks up to 5 providers, while 8.99 USD total unlocks up to 10 providers.',
  type: 'alert',
  intent: 'info-basic',
};

const supporterTokenOption: Option = {
  id: 'supporter_token',
  name: 'Lifetime supporter token',
  description:
    'Generate a supporter token at [https://flixnest.app/flix-streams/](https://flixnest.app/flix-streams/) using your payment email and paste it here for exclusive supporter features.',
  type: 'password',
  required: false,
  emptyIsUndefined: true,
  default: undefined,
};

const moreProvidersSubsection: Option = {
  id: 'moreProviders',
  name: 'More Providers',
  description:
    'Open the rest of the Flix providers if you want the full provider list.',
  type: 'subsection',
  subsectionIntent: 'pill',
  showInSimpleMode: false,
  subOptions: [
    {
      id: 'enable_jellyfin',
      name: 'Enable Media Library (Jellyfin)',
      description:
        'Movies, TV Shows, Anime with up to 4K remux lossless links.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_a111477',
      name: 'Enable Lotus Vault',
      description:
        '1.1 PB archive for movies, series, anime, and K-dramas, with frequent 4K and remux-heavy library releases.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_filesearchtools',
      name: 'Enable Archive Vault',
      description:
        'Deep archive search for hard-to-find movies, shows, anime, specials, and filename matches with strong 4K and remux coverage.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_uhdmovies',
      name: 'Enable UhdMovies',
      description:
        'Direct-link fallback source for movies, TV shows, and anime episode packs, often with dual-audio or multi-language releases.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_vegamovies',
      name: 'Enable VegaMovies',
      description:
        'FastDL-backed movie, TV, and anime source with quality-specific release pages and frequent multi-language releases.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_moviesmod',
      name: 'Enable MoviesMod',
      description: 'Source for fresh movies and TV series.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_gokuhd',
      name: 'Enable GokuHD',
      description:
        'Anime links for series and movies, often with dubbed or multi-language releases.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_animeflix',
      name: 'Enable AnimeFlix',
      description: 'Source for anime and Japanese cinema content.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_hdhub4u',
      name: 'Enable Hdhub4u',
      description:
        'Movie and series source in the free tier, with direct HubDrive movie links and episode pages resolved lazily through the same gadgetsweb middleman chain as 4KHDHub.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_vidzee',
      name: 'Enable VidZee',
      description: 'Fast default source for the free tier.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_cineby',
      name: 'Enable Cineby (4K, English, Spanish, Hindi, Latino)',
      description: 'Movie and series source with broader language coverage.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_rivestream',
      name: 'Enable RiveStream (English, Hindi)',
      description:
        'MP4-first movie and series source with English and Hindi coverage.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_autoembed',
      name: 'Enable AutoEmbed (English and Hindi)',
      description:
        'General movie and series source for wider fallback coverage.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_vixsrc',
      name: 'Enable VixSrc',
      description: 'Movie and series source for broader catalog coverage.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_vadapav',
      name: 'Enable Vadapav',
      description: 'Extra movie and series fallback provider.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_mkvcinemas',
      name: 'Enable MkvCinemas (multi/hindi)',
      description: 'Hindi and multi-audio focused movie catalog.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_ee3',
      name: 'Enable EE3',
      description: 'Alternative premium source for movie and series links.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_hollymoviehd',
      name: 'Enable HollyMovieHD',
      description: 'Additional movie source for premium fallback coverage.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_aniways',
      name: 'Enable Aniways (Anime links)',
      description: 'Anime links source with Aniways and Kitsu ID matching.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_kisskh',
      name: 'Enable KissKH (Movies, K-Drama)',
      description: 'Movies and K-Drama provider with Asian catalog coverage.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_animeav1',
      name: 'Enable AnimeAV1 (Anime links)',
      description: 'Anime links source for extra anime coverage and fallback.',
      type: 'boolean',
      default: false,
    },
  ],
};

const providerSubsection: Option = {
  id: 'providers',
  name: 'Providers',
  description:
    'The main Flix simple-mode provider set, grouped into one marketplace panel.',
  type: 'subsection',
  subsectionIntent: 'pill',
  subOptions: [
    {
      id: 'enable_telegram',
      name: 'Enable Signal Vault (Movies, TV Shows, Anime)',
      description:
        'Priority relay for movies, TV shows, and anime file pulls through the server-side bridge.',
      type: 'boolean',
      default: true,
    },
    {
      id: 'telegram_server',
      name: 'Signal Vault server',
      description:
        'Default is SERVER1. Pick SERVER2 or SERVER3 only if that fits your library better.',
      type: 'select',
      default: 'server1',
      options: [
        { value: 'server1', label: 'Server 1' },
        { value: 'server2', label: 'Server 2' },
        { value: 'server3', label: 'Server 3' },
      ],
    },
    {
      id: 'enable_debrid_vault',
      name: 'Enable Debrid Vault (Movies, TV Shows, Anime)',
      description:
        'Magnet-indexed movie, series, and anime streams resolved on the addon host into direct playback links.',
      type: 'boolean',
      default: true,
    },
    {
      id: 'enable_emby',
      name: 'Enable Media Library (Emby)',
      description:
        'Movies, TV Shows, Anime with broad media library coverage and direct playback links.',
      type: 'boolean',
      default: true,
    },
    moreProvidersSubsection,
  ],
};

const liveTvSubsection: Option = {
  id: 'liveTv',
  name: 'Live TV',
  description:
    'Free live TV catalog first, with optional sports-focused providers if you want more coverage later.',
  type: 'subsection',
  subsectionIntent: 'pill',
  subOptions: [
    {
      id: 'enable_live_tv_catalog',
      name: 'Live TV - Free Catalog',
      description:
        'Keep it on if you want the built-in free Live TV catalog, or turn it off entirely without affecting your paid provider cap.',
      type: 'boolean',
      default: true,
    },
    {
      id: 'enable_livetv_sx',
      name: 'Live TV - Sports',
      description: 'Broad live sports source.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_librefutbol',
      name: 'Libre Futbol',
      description: 'Football-heavy live sports source.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_freelivesports',
      name: 'Free Live Sports',
      description: 'Extra live sports fallback source.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'enable_toonami_aftermath',
      name: 'Toonami Aftermath',
      description: 'Dedicated live channel feed.',
      type: 'boolean',
      default: false,
    },
  ],
};

const wyzieSubsection: Option = {
  id: 'wyzie',
  name: 'Wyzie Subtitles',
  description:
    'Configure Flix built-in subtitle fetching for regular playback.',
  type: 'subsection',
  subsectionIntent: 'pill',
  subOptions: [
    {
      id: 'enable_wyzie',
      name: 'Enable Wyzie subtitles',
      description: 'Attach Wyzie subtitles to supported streams.',
      type: 'boolean',
      default: true,
    },
    {
      id: 'wyzie_hearing_impaired',
      name: 'Include hearing-impaired (HI)',
      description: 'Allow hearing-impaired subtitle variants.',
      type: 'boolean',
      default: false,
    },
    {
      id: 'wyzie_languages',
      name: 'Languages',
      description:
        "Uses Wyzie's ISO 639-1 language filter. Leave it empty and the default subtitle language stays active.",
      type: 'multi-select',
      required: false,
      emptyIsUndefined: true,
      options: wyzieLanguageOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
      default: ['en'],
    },
    {
      id: 'wyzie_formats',
      name: 'Formats (comma separated)',
      description: 'Leave it empty and the default formats stay active.',
      type: 'string',
      required: false,
      emptyIsUndefined: true,
      default: 'srt,ass',
    },
    {
      id: 'wyzie_source',
      name: 'Source',
      description:
        'For anime-heavy setup, set source to AnimeTosho and keep Aniways enabled.',
      type: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'All sources' },
        { value: 'opensubtitles', label: 'OpenSubtitles' },
        { value: 'subdl', label: 'SubDL' },
        { value: 'subf2m', label: 'Subf2m' },
        { value: 'podnapisi', label: 'Podnapisi' },
        { value: 'gestdown', label: 'Gestdown' },
        { value: 'animetosho', label: 'AnimeTosho' },
      ],
    },
    {
      id: 'wyzie_max_results',
      name: 'Max subtitles per stream (1-30)',
      description: 'Allowed range is 1-30.',
      type: 'number',
      default: 8,
      constraints: {
        min: 1,
        max: 30,
      },
    },
  ],
};

export class FlixStreamsStreamParser extends StreamParser {
  protected getIndexer(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    if (typeof stream.message === 'string') {
      return stream.message;
    }
  }
}

export class FlixStreamsPreset extends Preset {
  static override getParser() {
    return FlixStreamsStreamParser;
  }
  static override get METADATA() {
    const options: Option[] = [
      ...baseOptions(
        'Flix-Streams',
        supportedResources,
        Env.DEFAULT_FLIX_STREAMS_TIMEOUT || 10000
      ),
      supporterHint,
      supporterTokenOption,
      providerSubsection,
      liveTvSubsection,
      wyzieSubsection,
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          { id: 'website', url: 'https://flixnest.app/flix-streams/' },
          { id: 'ko-fi', url: 'https://ko-fi.com/sandortoth' },
          { id: 'donate', url: 'https://flixnest.tip4serv.com/' },
        ],
      },
    ];

    return {
      ID: 'flix-streams',
      NAME: 'Flix-Streams',
      LOGO: 'https://flixnest.app/flix-streams/static/icon.png',
      URL: Env.FLIX_STREAMS_URL,
      TIMEOUT: Env.DEFAULT_FLIX_STREAMS_TIMEOUT || 10000,
      USER_AGENT: Env.DEFAULT_FLIX_STREAMS_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'All-in-one Flix addon for movies, series, anime, live TV, and sports.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [HTTP_STREAM_TYPE, LIVE_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      CATEGORY: constants.PresetCategory.STREAMS,
    };
  }

  static async generateAddons(
    _userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [this.generateAddon(options)];
  }

  private static generateAddon(options: Record<string, any>): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: this.generateManifestUrl(options),
      enabled: true,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options,
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

    const url = String(options.url || this.METADATA.URL).replace(/\/$/, '');
    const config = this.buildConfig(options);
    const configToken = this.base64EncodeJSON(config, 'urlSafe');

    return `${url}/${configToken}/manifest.json`;
  }

  private static buildConfig(
    options: Record<string, any>
  ): Record<string, any> {
    const providers = options.providers || {};
    const moreProviders = providers.moreProviders || {};
    const liveTv = options.liveTv || {};
    const wyzie = {
      ...(options.wyzie || {}),
      wyzie_formats: options.wyzie?.wyzie_formats
        ? options.wyzie.wyzie_formats
            .split(',')
            .map((format: string) => format.trim())
        : marketplaceDefaults.wyzie_formats,
    };

    const config: Record<string, any> = {
      ...marketplaceDefaults,
      supporter_token: options.supporter_token,
      ...providers,
      ...moreProviders,
      ...liveTv,
      ...wyzie,
    };

    delete config.moreProviders;
    delete config.supporter_email;

    if (config.supporter_token) {
      config.enable_vidzee = false;
    }

    config.enable_jellyfin_live_tv = false;

    if (config.enable_live_tv_catalog) {
      config.famelack_countries = ['us'];
    } else {
      delete config.famelack_countries;
    }

    return config;
  }
}
