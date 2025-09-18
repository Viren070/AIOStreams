import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { Cache, constants, Env, makeRequest } from '../utils/index.js';
import { z } from 'zod';

const configCache = Cache.getInstance<string, string>('ai-search-config');

export class AISearchPreset extends Preset {
  private static languages = [
    { label: 'Afrikaans (South Africa)', value: 'af-ZA' },
    { label: 'Arabic (UAE)', value: 'ar-AE' },
    { label: 'Arabic (Saudi Arabia)', value: 'ar-SA' },
    { label: 'Belarusian (Belarus)', value: 'be-BY' },
    { label: 'Bulgarian (Bulgaria)', value: 'bg-BG' },
    { label: 'Bengali (Bangladesh)', value: 'bn-BD' },
    { label: 'Catalan (Spain)', value: 'ca-ES' },
    { label: 'Chamorro (Guam)', value: 'ch-GU' },
    { label: 'Czech (Czech Republic)', value: 'cs-CZ' },
    { label: 'Welsh (United Kingdom)', value: 'cy-GB' },
    { label: 'Danish (Denmark)', value: 'da-DK' },
    { label: 'German (Austria)', value: 'de-AT' },
    { label: 'German (Switzerland)', value: 'de-CH' },
    { label: 'German (Germany)', value: 'de-DE' },
    { label: 'Greek (Greece)', value: 'el-GR' },
    { label: 'English (Australia)', value: 'en-AU' },
    { label: 'English (Canada)', value: 'en-CA' },
    { label: 'English (United Kingdom)', value: 'en-GB' },
    { label: 'English (Ireland)', value: 'en-IE' },
    { label: 'English (New Zealand)', value: 'en-NZ' },
    { label: 'English (United States)', value: 'en-US' },
    { label: 'Esperanto', value: 'eo-EO' },
    { label: 'Spanish (Spain)', value: 'es-ES' },
    { label: 'Spanish (Mexico)', value: 'es-MX' },
    { label: 'Estonian (Estonia)', value: 'et-EE' },
    { label: 'Basque (Spain)', value: 'eu-ES' },
    { label: 'Persian (Iran)', value: 'fa-IR' },
    { label: 'Finnish (Finland)', value: 'fi-FI' },
    { label: 'French (Canada)', value: 'fr-CA' },
    { label: 'French (France)', value: 'fr-FR' },
    { label: 'Irish (Ireland)', value: 'ga-IE' },
    { label: 'Galician (Spain)', value: 'gl-ES' },
    { label: 'Hebrew (Israel)', value: 'he-IL' },
    { label: 'Hindi (India)', value: 'hi-IN' },
    { label: 'Croatian (Croatia)', value: 'hr-HR' },
    { label: 'Hungarian (Hungary)', value: 'hu-HU' },
    { label: 'Indonesian (Indonesia)', value: 'id-ID' },
    { label: 'Icelandic (Iceland)', value: 'is-IS' },
    { label: 'Italian (Italy)', value: 'it-IT' },
    { label: 'Japanese (Japan)', value: 'ja-JP' },
    { label: 'Georgian (Georgia)', value: 'ka-GE' },
    { label: 'Kazakh (Kazakhstan)', value: 'kk-KZ' },
    { label: 'Kannada (India)', value: 'kn-IN' },
    { label: 'Korean (South Korea)', value: 'ko-KR' },
    { label: 'Kyrgyz (Kyrgyzstan)', value: 'ky-KG' },
    { label: 'Lithuanian (Lithuania)', value: 'lt-LT' },
    { label: 'Latvian (Latvia)', value: 'lv-LV' },
    { label: 'Malayalam (India)', value: 'ml-IN' },
    { label: 'Marathi (India)', value: 'mr-IN' },
    { label: 'Malay (Malaysia)', value: 'ms-MY' },
    { label: 'Norwegian Bokmål (Norway)', value: 'nb-NO' },
    { label: 'Dutch (Belgium)', value: 'nl-BE' },
    { label: 'Dutch (Netherlands)', value: 'nl-NL' },
    { label: 'Norwegian (Norway)', value: 'no-NO' },
    { label: 'Punjabi (India)', value: 'pa-IN' },
    { label: 'Polish (Poland)', value: 'pl-PL' },
    { label: 'Portuguese (Brazil)', value: 'pt-BR' },
    { label: 'Portuguese (Portugal)', value: 'pt-PT' },
    { label: 'Romanian (Romania)', value: 'ro-RO' },
    { label: 'Russian (Russia)', value: 'ru-RU' },
    { label: 'Sinhala (Sri Lanka)', value: 'si-LK' },
    { label: 'Slovak (Slovakia)', value: 'sk-SK' },
    { label: 'Slovenian (Slovenia)', value: 'sl-SI' },
    { label: 'Albanian (Albania)', value: 'sq-AL' },
    { label: 'Serbian (Serbia)', value: 'sr-RS' },
    { label: 'Swedish (Sweden)', value: 'sv-SE' },
    { label: 'Tamil (India)', value: 'ta-IN' },
    { label: 'Telugu (India)', value: 'te-IN' },
    { label: 'Thai (Thailand)', value: 'th-TH' },
    { label: 'Tagalog (Philippines)', value: 'tl-PH' },
    { label: 'Turkish (Turkey)', value: 'tr-TR' },
    { label: 'Ukrainian (Ukraine)', value: 'uk-UA' },
    { label: 'Vietnamese (Vietnam)', value: 'vi-VN' },
    { label: 'Chinese (China)', value: 'zh-CN' },
    { label: 'Chinese (Hong Kong)', value: 'zh-HK' },
    { label: 'Chinese (Taiwan)', value: 'zh-TW' },
    { label: 'Zulu (South Africa)', value: 'zu-ZA' },
  ];
  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'AI Search',
        supportedResources,
        Env.DEFAULT_AI_SEARCH_TIMEOUT
      ),
      {
        id: 'limitedConfig',
        name: 'Limited Configuration',
        description:
          'To use Trakt-based recommendations, manually configure the AI Search addon and paste its Manifest/Installation URL above. The options below will not enable this feature.',
        type: 'alert',
        intent: 'warning-basic',
      },
      {
        id: 'geminiApiKey',
        name: 'Gemini API Key',
        description:
          'Get a free key from [Google AI Studio](https://makersuite.google.com/app/apikey)',
        type: 'password',
        required: true,
        constraints: {
          min: 10,
        },
      },
      // @deprecated TMDB API Key is now handled in the services menu
      // {
      //   id: 'tmdbApiKey',
      //   name: 'TMDB API Key',
      //   description:
      //     'Get a free key from [TMDB](https://www.themoviedb.org/settings/api)',
      //   type: 'password',
      //   required: true,
      //   constraints: {
      //     min: 10,
      //   },
      // },
      {
        id: 'AiResponseCaching',
        name: 'AI Response Caching',
        description: 'Enable AI response caching',
        type: 'boolean',
        default: true,
        showInNoobMode: false,
      },
      {
        id: 'rpdbApiKey',
        name: 'RPDB API Key (Optional)',
        description: 'Optionally provide an RPDB API Key to use for posters',
        type: 'password',
        required: false,
        showInNoobMode: false,
      },
      {
        id: 'language',
        name: 'Language',
        description: 'The language to use for AI Search',
        type: 'select',
        options: this.languages,
        default: 'en-US',
        showInNoobMode: false,
      },
      {
        id: 'model',
        name: 'Gemini Model Name',
        description:
          'The Gemini model to use for AI Search. See available models at the [documentation](https://ai.google.dev/gemini-api/docs/models/gemini)',
        type: 'string',
        default: 'gemini-2.0-flash-lite',
        showInNoobMode: false,
      },
      {
        id: 'numberOfRecommendations',
        name: 'Number of Recommendations',
        description:
          'The number of recommendations to return. Higher values may increase the response time.',
        type: 'number',
        default: 20,
        constraints: {
          min: 1,
          max: 30,
        },
        showInNoobMode: false,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'buymeacoffee',
            url: 'https://buymeacoffee.com/itcon',
          },
        ],
      },
    ];

    return {
      ID: 'ai-search',
      NAME: 'AI Search',
      LOGO: `https://raw.githubusercontent.com/itcon-pty-au/stremio-ai-search/refs/heads/main/public/logo.png`,
      URL: Env.AI_SEARCH_URL,
      TIMEOUT: Env.DEFAULT_AI_SEARCH_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_AI_SEARCH_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'AI-powered movie and series recommendations. Powered by Gemini.',
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
    if (!tmdbApiKey) {
      throw new Error(
        `${this.METADATA.NAME} requires a TMDB API Key to function. Please provide it in the services menu.`
      );
    }

    let config = {
      GeminiApiKey: options.geminiApiKey,
      TmdbApiKey: tmdbApiKey,
      RpdbApiKey: options.rpdbApiKey,
      RpdbPosterType: options.rpdbApiKey ? 'poster-default' : undefined,
      EnableRpdb: options.rpdbApiKey ? true : false,
      EnableAiCache: options.AiResponseCaching,
      TmdbLanguage: options.language,
      GeminiModel: options.model,
    };

    // request to /aisearch/encrypt with cache and config as body
    const cacheKey = `${JSON.stringify(config)}`;
    let configId: string | undefined = await configCache.get(cacheKey);
    if (configId) {
      return `${url}/aisearch/${configId}/manifest.json`;
    }
    let response;
    try {
      response = await makeRequest(`${url}/aisearch/encrypt`, {
        timeout: this.METADATA.TIMEOUT,
        method: 'POST',
        headers: {
          'User-Agent': this.METADATA.USER_AGENT,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          configData: config,
        }),
      });
      if (!response.ok) {
        const error = z
          .object({
            error: z.string(),
          })
          .safeParse(await response.json());
        throw new Error(
          `${error.data?.error} (${response.status} - ${response.statusText})`
        );
      }
      const data = await response.json();
      const schema = z.object({
        encryptedConfig: z.string(),
      });
      const result = schema.parse(data);
      configId = result.encryptedConfig;
      await configCache.set(cacheKey, configId, 365 * 24 * 60 * 60);
      return `${url}/aisearch/${configId}/manifest.json`;
    } catch (error) {
      throw new Error(
        `Failed to generate manifest URL for AI Search: ${error}`
      );
    }
  }
}
