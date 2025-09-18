import { Addon, Option, ParsedStream, Stream, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import {
  Cache,
  constants,
  Env,
  getSimpleTextHash,
  makeRequest,
} from '../utils/index.js';
import { StreamParser } from '../parser/index.js';

const moreLikeThisManifests = Cache.getInstance<string, string>(
  'moreLikeThisManifests'
);

class MoreLikeThisStreamParser extends StreamParser {
  protected getFilename(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return undefined;
  }
  protected getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return stream.description || undefined;
  }
}

export class MoreLikeThisPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return MoreLikeThisStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'More Like This',
        supportedResources,
        Env.DEFAULT_MORE_LIKE_THIS_TIMEOUT
      ),
      // @deprecated TMDB API Key is now handled in the services menu
      // {
      //   id: 'tmdbApiKey',
      //   name: 'TMDB API Key',
      //   description:
      //     'Get a free key from [TMDB](https://www.themoviedb.org/settings/api)',
      //   type: 'password',
      //   constraints: {
      //     min: 10,
      //   },
      // },
      {
        id: 'traktApiKey',
        name: 'Trakt API Key',
        description:
          'Get a free key from [Trakt](https://trakt.tv/oauth/applications)',
        type: 'password',
      },
      {
        id: 'geminiApiKey',
        name: 'Gemini API Key',
        description:
          'Get a free key from [Google AI Studio](https://makersuite.google.com/app/apikey)',
        type: 'password',
      },
      {
        id: 'tasteDiveApiKey',
        name: 'TasteDive API Key',
        description:
          'Get a free key from [TasteDive](https://tastedive.com/account/api_access)',
        type: 'password',
      },
      {
        id: 'watchmodeApiKey',
        name: 'Watchmode API Key',
        description:
          'Get a free key from [Watchmode](https://api.watchmode.com/requestApiKey/)',
        type: 'password',
      },
      {
        id: 'simklRecomendations',
        name: 'Simkl Recomendations',
        description: 'Enable Simkl Recomendations',
        type: 'boolean',
        default: true,
      },
      {
        id: 'combineCatalogs',
        name: 'Combine Catalogs',
        description:
          'Combine recommendations from all sources into a single catalog, instead of showing them separately. Can slow down catalog response.',
        type: 'boolean',
        default: false,
      },
      {
        id: 'metadataSource',
        name: 'Metadata Source',
        description: 'The source of metadata to use for recommendations.',
        type: 'select',
        options: [
          { label: 'TMDB', value: 'tmdb' },
          { label: 'Cinemeta', value: 'cinemeta' },
        ],
        default: 'cinemeta',
      },
      {
        id: 'language',
        name: 'Language',
        description:
          'The language to use for recommendations. Note: Requires a TMDB API key and the metadata source to be set to TMDB.',
        type: 'select',
        options: [
          { label: 'English', value: 'en' },
          { label: 'Abkhazian', value: 'ab' },
          { label: 'Afar', value: 'aa' },
          { label: 'Afrikaans', value: 'af' },
          { label: 'Akan', value: 'ak' },
          { label: 'shqip (Albanian)', value: 'sq' },
          { label: 'Amharic', value: 'am' },
          { label: 'العربية (Arabic)', value: 'ar' },
          { label: 'Aragonese', value: 'an' },
          { label: 'Armenian', value: 'hy' },
          { label: 'Assamese', value: 'as' },
          { label: 'Avaric', value: 'av' },
          { label: 'Avestan', value: 'ae' },
          { label: 'Aymara', value: 'ay' },
          { label: 'Azərbaycan (Azerbaijani)', value: 'az' },
          { label: 'Bamanankan (Bambara)', value: 'bm' },
          { label: 'Bashkir', value: 'ba' },
          { label: 'euskera (Basque)', value: 'eu' },
          { label: 'беларуская мова (Belarusian)', value: 'be' },
          { label: 'বাংলা (Bengali)', value: 'bn' },
          { label: 'Bislama', value: 'bi' },
          { label: 'Bosanski (Bosnian)', value: 'bs' },
          { label: 'Breton', value: 'br' },
          { label: 'български език (Bulgarian)', value: 'bg' },
          { label: 'Burmese', value: 'my' },
          { label: '广州话 / 廣州話 (Cantonese)', value: 'cn' },
          { label: 'Català (Catalan)', value: 'ca' },
          { label: "Finu' Chamorro (Chamorro)", value: 'ch' },
          { label: 'Chechen', value: 'ce' },
          { label: 'Chichewa; Nyanja', value: 'ny' },
          { label: 'Chuvash', value: 'cv' },
          { label: 'Cornish', value: 'kw' },
          { label: 'Corsican', value: 'co' },
          { label: 'Cree', value: 'cr' },
          { label: 'Hrvatski (Croatian)', value: 'hr' },
          { label: 'Český (Czech)', value: 'cs' },
          { label: 'Dansk (Danish)', value: 'da' },
          { label: 'Divehi', value: 'dv' },
          { label: 'Nederlands (Dutch)', value: 'nl' },
          { label: 'Dzongkha', value: 'dz' },
          { label: 'Esperanto', value: 'eo' },
          { label: 'Eesti (Estonian)', value: 'et' },
          { label: 'Èʋegbe (Ewe)', value: 'ee' },
          { label: 'Faroese', value: 'fo' },
          { label: 'Fijian', value: 'fj' },
          { label: 'suomi (Finnish)', value: 'fi' },
          { label: 'Français (French)', value: 'fr' },
          { label: 'Frisian', value: 'fy' },
          { label: 'Fulfulde (Fulah)', value: 'ff' },
          { label: 'Gaelic', value: 'gd' },
          { label: 'Galego (Galician)', value: 'gl' },
          { label: 'Ganda', value: 'lg' },
          { label: 'ქართული (Georgian)', value: 'ka' },
          { label: 'Deutsch (German)', value: 'de' },
          { label: 'ελληνικά (Greek)', value: 'el' },
          { label: 'Guarani', value: 'gn' },
          { label: 'Gujarati', value: 'gu' },
          { label: 'Haitian; Haitian Creole', value: 'ht' },
          { label: 'Hausa', value: 'ha' },
          { label: 'עִבְרִית (Hebrew)', value: 'he' },
          { label: 'Herero', value: 'hz' },
          { label: 'हिन्दी (Hindi)', value: 'hi' },
          { label: 'Hiri Motu', value: 'ho' },
          { label: 'Magyar (Hungarian)', value: 'hu' },
          { label: 'Íslenska (Icelandic)', value: 'is' },
          { label: 'Ido', value: 'io' },
          { label: 'Igbo', value: 'ig' },
          { label: 'Bahasa indonesia (Indonesian)', value: 'id' },
          { label: 'Interlingua', value: 'ia' },
          { label: 'Interlingue', value: 'ie' },
          { label: 'Inuktitut', value: 'iu' },
          { label: 'Inupiaq', value: 'ik' },
          { label: 'Gaeilge (Irish)', value: 'ga' },
          { label: 'Italiano (Italian)', value: 'it' },
          { label: '日本語 (Japanese)', value: 'ja' },
          { label: 'Javanese', value: 'jv' },
          { label: 'Kalaallisut', value: 'kl' },
          { label: 'Kannada', value: 'kn' },
          { label: 'Kanuri', value: 'kr' },
          { label: 'Kashmiri', value: 'ks' },
          { label: 'қазақ (Kazakh)', value: 'kk' },
          { label: 'Khmer', value: 'km' },
          { label: 'Kikuyu', value: 'ki' },
          { label: 'Kinyarwanda', value: 'rw' },
          { label: 'Kirghiz', value: 'ky' },
          { label: 'Komi', value: 'kv' },
          { label: 'Kongo', value: 'kg' },
          { label: '한국어/조선말 (Korean)', value: 'ko' },
          { label: 'Kuanyama', value: 'kj' },
          { label: 'Kurdish', value: 'ku' },
          { label: 'Lao', value: 'lo' },
          { label: 'Latin', value: 'la' },
          { label: 'Latviešu (Latvian)', value: 'lv' },
          { label: 'Letzeburgesch', value: 'lb' },
          { label: 'Limburgish', value: 'li' },
          { label: 'Lingala', value: 'ln' },
          { label: 'Lietuvių (Lithuanian)', value: 'lt' },
          { label: 'Luba-Katanga', value: 'lu' },
          { label: 'Macedonian', value: 'mk' },
          { label: 'Malagasy', value: 'mg' },
          { label: 'Bahasa melayu (Malay)', value: 'ms' },
          { label: 'Malayalam', value: 'ml' },
          { label: 'Malti (Maltese)', value: 'mt' },
          { label: '普通话 (Mandarin)', value: 'zh' },
          { label: 'Manx', value: 'gv' },
          { label: 'Maori', value: 'mi' },
          { label: 'Marathi', value: 'mr' },
          { label: 'Marshall', value: 'mh' },
          { label: 'Moldavian', value: 'mo' },
          { label: 'Mongolian', value: 'mn' },
          { label: 'Nauru', value: 'na' },
          { label: 'Navajo', value: 'nv' },
          { label: 'Ndebele', value: 'nr' },
          { label: 'Ndebele', value: 'nd' },
          { label: 'Ndonga', value: 'ng' },
          { label: 'Nepali', value: 'ne' },
          { label: 'No Language', value: 'xx' },
          { label: 'Northern Sami', value: 'se' },
          { label: 'Norsk (Norwegian)', value: 'no' },
          { label: 'Bokmål (Norwegian Bokmål)', value: 'nb' },
          { label: 'Norwegian Nynorsk', value: 'nn' },
          { label: 'Occitan', value: 'oc' },
          { label: 'Ojibwa', value: 'oj' },
          { label: 'Oriya', value: 'or' },
          { label: 'Oromo', value: 'om' },
          { label: 'Ossetian; Ossetic', value: 'os' },
          { label: 'Pali', value: 'pi' },
          { label: 'فارسی (Persian)', value: 'fa' },
          { label: 'Polski (Polish)', value: 'pl' },
          { label: 'Português (Portuguese)', value: 'pt' },
          { label: 'ਪੰਜਾਬੀ (Punjabi)', value: 'pa' },
          { label: 'پښتو (Pushto)', value: 'ps' },
          { label: 'Quechua', value: 'qu' },
          { label: 'Raeto-Romance', value: 'rm' },
          { label: 'Română (Romanian)', value: 'ro' },
          { label: 'Kirundi (Rundi)', value: 'rn' },
          { label: 'Pусский (Russian)', value: 'ru' },
          { label: 'Samoan', value: 'sm' },
          { label: 'Sango', value: 'sg' },
          { label: 'Sanskrit', value: 'sa' },
          { label: 'Sardinian', value: 'sc' },
          { label: 'Srpski (Serbian)', value: 'sr' },
          { label: 'Serbo-Croatian', value: 'sh' },
          { label: 'Shona', value: 'sn' },
          { label: 'Sindhi', value: 'sd' },
          { label: 'සිංහල (Sinhalese)', value: 'si' },
          { label: 'Slavic', value: 'cu' },
          { label: 'Slovenčina (Slovak)', value: 'sk' },
          { label: 'Slovenščina (Slovenian)', value: 'sl' },
          { label: 'Somali', value: 'so' },
          { label: 'Sotho', value: 'st' },
          { label: 'Español (Spanish)', value: 'es' },
          { label: 'Sundanese', value: 'su' },
          { label: 'Kiswahili (Swahili)', value: 'sw' },
          { label: 'Swati', value: 'ss' },
          { label: 'svenska (Swedish)', value: 'sv' },
          { label: 'Tagalog', value: 'tl' },
          { label: 'Tahitian', value: 'ty' },
          { label: 'Tajik', value: 'tg' },
          { label: 'தமிழ் (Tamil)', value: 'ta' },
          { label: 'Tatar', value: 'tt' },
          { label: 'తెలుగు (Telugu)', value: 'te' },
          { label: 'ภาษาไทย (Thai)', value: 'th' },
          { label: 'Tibetan', value: 'bo' },
          { label: 'Tigrinya', value: 'ti' },
          { label: 'Tonga', value: 'to' },
          { label: 'Tsonga', value: 'ts' },
          { label: 'Tswana', value: 'tn' },
          { label: 'Türkçe (Turkish)', value: 'tr' },
          { label: 'Turkmen', value: 'tk' },
          { label: 'Twi', value: 'tw' },
          { label: 'Uighur', value: 'ug' },
          { label: 'Український (Ukrainian)', value: 'uk' },
          { label: 'اردو (Urdu)', value: 'ur' },
          { label: 'ozbek (Uzbek)', value: 'uz' },
          { label: 'Venda', value: 've' },
          { label: 'Tiếng Việt (Vietnamese)', value: 'vi' },
          { label: 'Volapük', value: 'vo' },
          { label: 'Walloon', value: 'wa' },
          { label: 'Cymraeg (Welsh)', value: 'cy' },
          { label: 'Wolof', value: 'wo' },
          { label: 'Xhosa', value: 'xh' },
          { label: 'Yi', value: 'ii' },
          { label: 'Yiddish', value: 'yi' },
          { label: 'Èdè Yorùbá (Yoruba)', value: 'yo' },
          { label: 'Zhuang', value: 'za' },
          { label: 'isiZulu (Zulu)', value: 'zu' },
        ],
        default: 'en',
      },
      {
        id: 'streamButtons',
        name: 'Stream Button Platform',
        description:
          "This addon provides a set of streams in Stremio that act as buttons for easier access. Disable any you don't need.",
        type: 'multi-select',
        options: [
          { label: 'Go to detail page', value: 'details' },
          { label: 'Show recommendations', value: 'recs' },
          { label: 'App', value: 'app' },
          { label: 'Web', value: 'web' },
        ],
        default: ['details', 'recs', 'app', 'web'],
      },
      {
        id: 'includeTmdbCollection',
        name: 'Include TMDB Collection',
        description:
          'TMDB groups related movies—like sequels and series—into "collections." These movies are not always included in TMDB\'s default recommendations. Enable this setting to add collection movies to the start of the TMDB recommendation list.',
        type: 'boolean',
        default: true,
      },
      {
        id: 'enableTitleSearching',
        name: 'Enable Title Searching',
        description:
          'Enable to find recommendations based on movie or show titles too. ',
        type: 'boolean',
        default: true,
      },
      {
        id: 'forceToTop',
        name: 'Force To Top',
        description:
          'Force streams from this addon to be pushed to the top of the stream list.',
        type: 'boolean',
        default: true,
        required: false,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'github',
            url: 'https://github.com/rama1997/More-Like-This',
          },
        ],
      },
    ];

    return {
      ID: 'more-like-this',
      NAME: 'More Like This',
      LOGO: `https://raw.githubusercontent.com/rama1997/More-Like-This/refs/heads/main/assets/images/logo.jpg`,
      URL: Env.MORE_LIKE_THIS_URL,
      TIMEOUT: Env.DEFAULT_MORE_LIKE_THIS_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_MORE_LIKE_THIS_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Shows recommendations from various sources',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [await this.generateAddon(userData, options)];
  }

  private static async generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon> {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: await this.generateManifestUrl(userData, options),
      enabled: true,
      library: false,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      forceToTop: options.forceToTop ?? true,
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

  private static async generateManifestUrl(
    userData: UserData,
    options: Record<string, any>
  ): Promise<string> {
    let url = (options.url || this.METADATA.URL).replace(/\/$/, '');
    if (url.endsWith('/manifest.json')) {
      return url;
    }

    const tmdbApiKey =
      options.tmdbApiKey || userData.tmdbApiKey || Env.TMDB_API_KEY;

    const isKeyValid = (key: string): string =>
      typeof key === 'string' && key.length > 0 ? 'true' : '';
    const streamButtons = options.streamButtons
      ? options.streamButtons.join(',')
      : ['details', 'recs', 'app', 'web'];
    const config: Record<string, string> = {
      tmdbApiKey: tmdbApiKey ?? '',
      validatedTmdbApiKey: isKeyValid(tmdbApiKey ?? ''),
      includeTmdbCollection: options.includeTmdbCollection ? 'on' : '',
      traktApiKey: options.traktApiKey ?? '',
      validatedTraktApiKey: isKeyValid(options.traktApiKey ?? ''),
      geminiApiKey: options.geminiApiKey ?? '',
      validatedGeminiApiKey: isKeyValid(options.geminiApiKey ?? ''),
      tasteDiveApiKey: options.tasteDiveApiKey ?? '',
      validatedTasteDiveApiKey: isKeyValid(options.tasteDiveApiKey ?? ''),
      simkl: options.simklRecomendations ? 'on' : '',
      catalogOrder: 'TMDB,Trakt,Simkl,Gemini+AI,TasteDive,Watchmode',
      metadataSource: options.metadataSource,
      language: options.language,
      enableTitleSearching: options.enableTitleSearching ? 'on' : '',
      streamDetailEnabled: streamButtons.includes('details') ? 'on' : '',
      streamRecEnabled: streamButtons.includes('recs') ? 'on' : '',
      streamAppEnabled: streamButtons.includes('app') ? 'on' : '',
      streamWebEnabled: streamButtons.includes('web') ? 'on' : '',
      combineCatalogs: options.combineCatalogs ? 'on' : '',
      streamOrder: streamButtons,
      rpdbApiKey: '',
      validatedRpdbApiKey: 'true',
      forCopy: 'true',
    };

    const cachedManifest = await moreLikeThisManifests.get(
      getSimpleTextHash(`${url}?${JSON.stringify(config)}`)
    );
    if (cachedManifest) {
      return cachedManifest;
    }

    const formData = new URLSearchParams();
    Object.entries(config).forEach(([key, value]) => {
      formData.append(key, value);
    });

    try {
      const response = await makeRequest(`${url}/saveConfig`, {
        method: 'POST',
        timeout: 1000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.METADATA.USER_AGENT,
        },
        rawOptions: {
          redirect: 'manual',
        },
        body: formData.toString(),
      });

      let manifestUrl = response.headers.get('Location');
      if (response.status < 300 || response.status >= 400) {
        throw new Error(
          `${response.status} - ${response.statusText}: ${await response.text()}`
        );
      }
      if (!manifestUrl) {
        throw new Error('Manifest URL not present in redirect');
      }

      if (url.startsWith('https://') && manifestUrl.startsWith('http://')) {
        manifestUrl = manifestUrl.replace('http://', 'https://');
      }

      moreLikeThisManifests.set(
        getSimpleTextHash(`${url}?${JSON.stringify(config)}`),
        manifestUrl,
        30 * 24 * 60 * 60
      );
      return manifestUrl;
    } catch (error: any) {
      throw new Error(
        `Failed to generate ${this.METADATA.NAME} manifest: ${error.message}`
      );
    }
  }
}
