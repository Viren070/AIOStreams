import {
  Addon,
  Option,
  ParsedStream,
  PresetMetadata,
  Stream,
  UserData,
} from '../db/index.js';
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
  box13_emby_live_categories: [],
  box13_emby_live_order_mode: 'default',
  debrid_vault_priority_languages: [],
  dlstreams_include_adult: false,
  enable_4khdhub: false,
  enable_a111477: false,
  enable_animeav1: false,
  enable_animeflix: false,
  enable_aniways: false,
  enable_arabseed: false,
  enable_autoembed: false,
  enable_box13_emby: false,
  enable_box13_emby_live_tv: false,
  enable_cineby: false,
  enable_cncverse: false,
  enable_debrid_vault: true,
  enable_dlstreams: false,
  enable_ee3: false,
  enable_emby: true,
  enable_filesearchtools: false,
  enable_fivemovierulz: false,
  enable_freelivesports: false,
  enable_gokuhd: false,
  enable_hdhub4u: false,
  enable_hianime: false,
  enable_hollymoviehd: false,
  enable_jellyfin: true,
  enable_jellyfin_live_tv: false,
  enable_kisskh: false,
  enable_librefutbol: false,
  enable_live_tv_catalog: true,
  enable_livetv_sx: false,
  enable_maxrls: false,
  enable_mkvcinemas: false,
  enable_moflix: false,
  enable_moviesmod: false,
  enable_pelispedia: false,
  enable_piratesiptv: false,
  enable_pokemon_telegram: false,
  enable_rivestream: false,
  enable_sharkstreams: false,
  enable_showbox: false,
  enable_streamsports99: false,
  enable_superembed: false,
  enable_telegram: true,
  enable_toonami_aftermath: false,
  enable_tv247us: false,
  enable_uhdmovies: false,
  enable_vadapav: false,
  enable_vavoo: false,
  enable_vegamovies: false,
  enable_vidzee: false,
  enable_vimeus: false,
  enable_vixsrc: false,
  enable_warflix: false,
  enable_watch2movies: false,
  enable_wyzie: true,
  enable_xcine: false,
  famelack_countries: ['us'],
  live_event_time_format: '24h',
  live_event_timezone: 'provider_local',
  provider_min_quality: 'any',
  provider_order: [
    'enable_telegram',
    'enable_debrid_vault',
    'enable_jellyfin',
    'enable_emby',
    'enable_a111477',
    'enable_filesearchtools',
    'enable_warflix',
    'enable_box13_emby',
    'enable_uhdmovies',
    'enable_4khdhub',
    'enable_hdhub4u',
    'enable_showbox',
    'enable_vegamovies',
    'enable_watch2movies',
    'enable_moviesmod',
    'enable_gokuhd',
    'enable_animeflix',
    'enable_maxrls',
    'enable_pokemon_telegram',
    'enable_vidzee',
    'enable_cineby',
    'enable_rivestream',
    'enable_vixsrc',
    'enable_vimeus',
    'enable_vadapav',
    'enable_mkvcinemas',
    'enable_arabseed',
    'enable_pelispedia',
    'enable_xcine',
    'enable_moflix',
    'enable_fivemovierulz',
    'enable_ee3',
    'enable_hollymoviehd',
    'enable_aniways',
    'enable_kisskh',
    'enable_animeav1',
    'enable_box13_emby_live_tv',
    'enable_dlstreams',
    'enable_streamsports99',
    'enable_tv247us',
    'enable_sharkstreams',
    'enable_vavoo',
    'enable_livetv_sx',
    'enable_piratesiptv',
    'enable_cncverse',
    'enable_librefutbol',
    'enable_freelivesports',
    'enable_toonami_aftermath',
  ],
  provider_timeout_seconds: 20,
  showbox_febbox_cookie: '',
  showbox_febbox_cookie_ref: '',
  stream_sort_mode: 'default',
  streamsports99_countries: [],
  supporter_token: '',
  telegram_language_filter: 'english',
  telegram_server: 'master',
  vavoo_countries: [],
  wyzie_apply_to_aniways_ids: true,
  wyzie_languages: ['en'],
  wyzie_formats: ['srt', 'ass'],
  wyzie_source: 'all',
  wyzie_hearing_impaired: false,
  wyzie_max_results: 8,
} as const;

const providerOptions = [
  { value: 'enable_telegram', label: 'Signal Vault' },
  { value: 'enable_debrid_vault', label: 'Debrid Vault' },
  { value: 'enable_jellyfin', label: 'Media Library (Jellyfin)' },
  { value: 'enable_emby', label: 'Media Library (Emby)' },
  { value: 'enable_box13_emby', label: 'Media Lib (2)' },
  { value: 'enable_a111477', label: 'Lotus Vault' },
  { value: 'enable_filesearchtools', label: 'Archive Vault' },
  { value: 'enable_warflix', label: 'Warflix' },
  { value: 'enable_uhdmovies', label: 'UhdMovies' },
  { value: 'enable_4khdhub', label: '4KHDHub' },
  { value: 'enable_hdhub4u', label: 'HDHub4u' },
  { value: 'enable_showbox', label: 'Showbox / FebBox' },
  { value: 'enable_vegamovies', label: 'VegaMovies' },
  { value: 'enable_watch2movies', label: 'Watch2Movies' },
  { value: 'enable_moviesmod', label: 'MoviesMod' },
  { value: 'enable_gokuhd', label: 'GokuHD' },
  { value: 'enable_animeflix', label: 'AnimeFlix' },
  { value: 'enable_maxrls', label: 'MaxRLS' },
  { value: 'enable_pokemon_telegram', label: 'Pokemon Vault' },
  { value: 'enable_vidzee', label: 'VidZee' },
  { value: 'enable_cineby', label: 'Cineby' },
  { value: 'enable_rivestream', label: 'RiveStream' },
  { value: 'enable_vixsrc', label: 'VixSrc' },
  { value: 'enable_vimeus', label: 'Vimeus' },
  { value: 'enable_vadapav', label: 'Vadapav' },
  { value: 'enable_mkvcinemas', label: 'MkvCinemas' },
  { value: 'enable_arabseed', label: 'ArabSeed' },
  { value: 'enable_pelispedia', label: 'Pelispedia' },
  { value: 'enable_xcine', label: 'XCine' },
  { value: 'enable_moflix', label: 'Moflix' },
  { value: 'enable_fivemovierulz', label: '5Movierulz' },
  { value: 'enable_ee3', label: 'EE3' },
  { value: 'enable_hollymoviehd', label: 'HollyMovieHD' },
  { value: 'enable_aniways', label: 'Aniways' },
  { value: 'enable_kisskh', label: 'KissKH' },
  { value: 'enable_animeav1', label: 'AnimeAV1' },
] as const;

const liveTvProviderOptions = [
  { value: 'enable_box13_emby_live_tv', label: 'Media Lib (2) Live TV' },
  { value: 'enable_dlstreams', label: 'DLStreams' },
  { value: 'enable_streamsports99', label: 'Premium Live TV Vault' },
  { value: 'enable_tv247us', label: 'TV247US' },
  { value: 'enable_sharkstreams', label: 'SharkStreams' },
  { value: 'enable_vavoo', label: 'VAVOO' },
  { value: 'enable_livetv_sx', label: 'Live Sports' },
  { value: 'enable_piratesiptv', label: 'Pirates IPTV' },
  { value: 'enable_cncverse', label: 'CNCVerse' },
  { value: 'enable_librefutbol', label: 'Libre Futbol' },
  { value: 'enable_freelivesports', label: 'Free Live Sports' },
  { value: 'enable_toonami_aftermath', label: 'Toonami Aftermath' },
] as const;

const providerIds = providerOptions.map((option) => option.value);
const liveTvProviderIds = liveTvProviderOptions.map((option) => option.value);
const allProviderIds = [...providerIds, ...liveTvProviderIds];
const defaultProviderSelection = providerIds.filter(
  (id) => marketplaceDefaults[id]
);
const defaultLiveTvProviderSelection = liveTvProviderIds.filter(
  (id) => marketplaceDefaults[id]
);

type FlixProviderMetadata = {
  providerOptions: { value: string; label: string }[];
  liveTvProviderOptions: { value: string; label: string }[];
  defaultProviderSelection: string[];
  defaultLiveTvProviderSelection: string[];
};

const supporterHint: Option = {
  id: 'supporterHint',
  name: 'Supporter Access',
  description:
    'Paid access unlocks the premium provider stack, including Signal Vault, Media Library, sports relays, anime sources, and other supporter-only providers. 10.00 USD one-time unlocks up to 10 providers lifetime, 5.00 USD monthly unlocks unlimited providers while active, and Ko-fi also has a separate 1 year unlimited package.',
  type: 'alert',
  intent: 'info-basic',
};

const supporterTokenOption: Option = {
  id: 'supporter_token',
  name: 'Supporter token',
  description:
    'Generate a supporter token at [https://flixnest.app/flix-streams/](https://flixnest.app/flix-streams/) using your payment email and paste it here for exclusive supporter features.',
  type: 'password',
  required: false,
  emptyIsUndefined: true,
  default: undefined,
};

const providerSubsection: Option = {
  id: 'providers',
  name: 'Providers',
  description:
    'Select the Flix movie, series, and anime providers you want to enable. The generated config sends the selected providers back to Flix as its current enable_* flags.',
  type: 'subsection',
  subsectionIntent: 'pill',
  subOptions: [
    {
      id: 'selectedProviders',
      name: 'Enabled providers',
      description:
        'Multi-select provider dropdown matching the current Flix-Streams provider list.',
      type: 'multi-select',
      required: false,
      options: providerOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
      default: defaultProviderSelection,
    },
    {
      id: 'telegram_language_filter',
      name: 'Signal Vault language',
      description:
        'Signal Vault now uses one unified search source. English keeps the raw title query; other choices add the language token used by Flix.',
      type: 'select',
      default: 'english',
      options: [
        { value: 'english', label: 'English' },
        { value: 'hindi', label: 'Hindi' },
        { value: 'tamil', label: 'Tamil' },
        { value: 'telugu', label: 'Telugu' },
        { value: 'malayalam', label: 'Malayalam' },
        { value: 'kannada', label: 'Kannada' },
      ],
    },
    {
      id: 'provider_min_quality',
      name: 'Minimum provider quality',
      description:
        'Optional Flix-side quality filter for providers that expose quality metadata.',
      type: 'select',
      default: 'any',
      options: [
        { value: 'any', label: 'Default / Unfiltered' },
        { value: '480p', label: '480p or better' },
        { value: '720p', label: '720p or better' },
        { value: '720p_only', label: '720p only' },
        { value: '1080p', label: '1080p or better' },
        { value: '1080p_only', label: '1080p only' },
        { value: '2160p', label: '4K / 2160p only' },
      ],
    },
    {
      id: 'showbox_febbox_cookie',
      name: 'Showbox / FebBox cookie',
      description:
        'Optional cookie for Showbox / FebBox if your Flix setup uses it.',
      type: 'password',
      required: false,
      emptyIsUndefined: true,
      default: undefined,
    },
  ],
};

const liveTvSubsection: Option = {
  id: 'liveTv',
  name: 'Live TV',
  description:
    'Keep the built-in free catalog on, and optionally enable Flix live TV or sports sources from one dropdown.',
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
      id: 'selectedLiveTvProviders',
      name: 'Enabled live TV sources',
      description:
        'Multi-select live TV and sports sources. Channel-level selection is still handled by Flix for sources that expose country or channel pickers.',
      type: 'multi-select',
      required: false,
      options: liveTvProviderOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
      default: defaultLiveTvProviderSelection,
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
  private static remoteProviderMetadataCache:
    | {
        expiresAt: number;
        value: FlixProviderMetadata | null;
      }
    | undefined;

  static override getParser() {
    return FlixStreamsStreamParser;
  }

  static async getDynamicMetadata(): Promise<PresetMetadata> {
    const metadata = this.METADATA;
    const remoteProviderMetadata = await this.getRemoteProviderMetadata();
    if (!remoteProviderMetadata) {
      return metadata;
    }

    return {
      ...metadata,
      OPTIONS: this.applyProviderMetadata(
        metadata.OPTIONS,
        remoteProviderMetadata
      ),
    };
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

  private static async getRemoteProviderMetadata(): Promise<FlixProviderMetadata | null> {
    const cached = this.remoteProviderMetadataCache;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const baseUrl = String(this.METADATA.URL).replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/configure`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        throw new Error(`Flix configure fetch failed: ${response.status}`);
      }
      const html = await response.text();
      const metadata = this.parseRemoteProviderMetadata(html);
      this.remoteProviderMetadataCache = {
        expiresAt: Date.now() + 10 * 60 * 1000,
        value: metadata,
      };
      return metadata;
    } catch {
      this.remoteProviderMetadataCache = {
        expiresAt: Date.now() + 60 * 1000,
        value: null,
      };
      return null;
    }
  }

  private static parseRemoteProviderMetadata(
    html: string
  ): FlixProviderMetadata | null {
    const defaultConfigMatch = html.match(
      /DEFAULT_CONFIG\s*=\s*(\{[\s\S]*?\});/
    );
    if (!defaultConfigMatch) {
      return null;
    }

    const defaultConfig = JSON.parse(defaultConfigMatch[1]) as Record<
      string,
      any
    >;
    const providerOrder = Array.isArray(defaultConfig.provider_order)
      ? defaultConfig.provider_order.filter(
          (value): value is string =>
            typeof value === 'string' && value.startsWith('enable_')
        )
      : [];
    if (providerOrder.length === 0) {
      return null;
    }

    const liveStartIndex = providerOrder.indexOf('enable_box13_emby_live_tv');
    const firstLiveIndex =
      liveStartIndex >= 0 ? liveStartIndex : providerOrder.length;
    const providerIds = providerOrder.slice(0, firstLiveIndex);
    const liveTvProviderIds = providerOrder.slice(firstLiveIndex);

    const toOption = (id: string) => ({
      value: id,
      label: this.findProviderLabel(html, id) || this.labelFromProviderId(id),
    });

    return {
      providerOptions: providerIds.map(toOption),
      liveTvProviderOptions: liveTvProviderIds.map(toOption),
      defaultProviderSelection: providerIds.filter(
        (id) => defaultConfig[id] === true
      ),
      defaultLiveTvProviderSelection: liveTvProviderIds.filter(
        (id) => defaultConfig[id] === true
      ),
    };
  }

  private static applyProviderMetadata(
    options: Option[],
    providerMetadata: FlixProviderMetadata
  ): Option[] {
    return options.map((option) => {
      if (option.id === 'providers' && option.subOptions) {
        return {
          ...option,
          subOptions: option.subOptions.map((subOption) =>
            subOption.id === 'selectedProviders'
              ? {
                  ...subOption,
                  options: providerMetadata.providerOptions,
                  default: providerMetadata.defaultProviderSelection,
                }
              : subOption
          ),
        };
      }
      if (option.id === 'liveTv' && option.subOptions) {
        return {
          ...option,
          subOptions: option.subOptions.map((subOption) =>
            subOption.id === 'selectedLiveTvProviders'
              ? {
                  ...subOption,
                  options: providerMetadata.liveTvProviderOptions,
                  default: providerMetadata.defaultLiveTvProviderSelection,
                }
              : subOption
          ),
        };
      }
      return option;
    });
  }

  private static findProviderLabel(html: string, id: string): string | null {
    const inputIndex = html.indexOf(`id="${id}"`);
    if (inputIndex === -1) {
      return null;
    }

    const nearbyHtml = html.slice(inputIndex, inputIndex + 2500);
    const copyMatch = nearbyHtml.match(
      /<span class="provider-copy-text">([\s\S]*?)<\/span>/
    );
    if (!copyMatch) {
      return null;
    }

    return this.cleanHtmlLabel(copyMatch[1])
      .replace(/^Enable\s+/i, '')
      .replace(/\s*\*$/, '')
      .trim();
  }

  private static cleanHtmlLabel(value: string): string {
    return value
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#9733;/g, '*')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static labelFromProviderId(id: string): string {
    return id
      .replace(/^enable_/, '')
      .split('_')
      .map((part) =>
        part.length <= 3
          ? part.toUpperCase()
          : part.charAt(0).toUpperCase() + part.slice(1)
      )
      .join(' ');
  }

  private static buildConfig(
    options: Record<string, any>
  ): Record<string, any> {
    const providers = options.providers || {};
    const liveTv = options.liveTv || {};
    const selectedProviders = this.resolveProviderSelection(
      providers,
      options,
      'selectedProviders',
      providerIds,
      defaultProviderSelection
    );
    const selectedLiveTvProviders = this.resolveProviderSelection(
      liveTv,
      options,
      'selectedLiveTvProviders',
      liveTvProviderIds,
      defaultLiveTvProviderSelection
    );
    const wyzie = {
      ...(options.wyzie || {}),
      wyzie_formats: this.normaliseCsvOrArray(
        options.wyzie?.wyzie_formats,
        marketplaceDefaults.wyzie_formats
      ),
    };

    const config: Record<string, any> = {
      ...marketplaceDefaults,
      supporter_token: options.supporter_token,
      enable_live_tv_catalog:
        liveTv.enable_live_tv_catalog ??
        options.enable_live_tv_catalog ??
        marketplaceDefaults.enable_live_tv_catalog,
      provider_min_quality:
        providers.provider_min_quality ??
        options.provider_min_quality ??
        marketplaceDefaults.provider_min_quality,
      showbox_febbox_cookie:
        providers.showbox_febbox_cookie ??
        options.showbox_febbox_cookie ??
        marketplaceDefaults.showbox_febbox_cookie,
      telegram_language_filter:
        providers.telegram_language_filter ??
        options.telegram_language_filter ??
        marketplaceDefaults.telegram_language_filter,
      ...wyzie,
    };

    delete config.supporter_email;
    delete config.selectedProviders;
    delete config.selectedLiveTvProviders;

    for (const id of allProviderIds) {
      config[id] = false;
    }
    for (const id of [...selectedProviders, ...selectedLiveTvProviders]) {
      config[id] = true;
    }

    config.enable_jellyfin_live_tv = false;
    config.telegram_server = 'master';

    if (config.enable_live_tv_catalog) {
      config.famelack_countries = ['us'];
    } else {
      delete config.famelack_countries;
    }

    return config;
  }

  private static resolveProviderSelection(
    sectionOptions: Record<string, any>,
    rootOptions: Record<string, any>,
    selectionKey: string,
    allowedIds: readonly string[],
    defaultSelection: readonly string[]
  ): string[] {
    const explicitSelection =
      sectionOptions[selectionKey] ?? rootOptions[selectionKey];
    if (Array.isArray(explicitSelection)) {
      return this.filterKnownProviderIds(explicitSelection, allowedIds);
    }

    const legacyEnabled = allowedIds.filter(
      (id) => sectionOptions[id] === true || rootOptions[id] === true
    );
    const legacyDisabled = allowedIds.some(
      (id) => sectionOptions[id] === false || rootOptions[id] === false
    );
    if (legacyEnabled.length > 0 || legacyDisabled) {
      return legacyEnabled;
    }

    return [...defaultSelection];
  }

  private static filterKnownProviderIds(
    value: unknown[],
    allowedIds: readonly string[]
  ): string[] {
    const allowed = new Set(allowedIds);
    return value.filter(
      (item): item is string =>
        typeof item === 'string' &&
        (allowed.has(item) || /^enable_[a-z0-9_]+$/i.test(item))
    );
  }

  private static normaliseCsvOrArray(
    value: unknown,
    fallback: readonly string[]
  ): string[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [...fallback];
  }
}
