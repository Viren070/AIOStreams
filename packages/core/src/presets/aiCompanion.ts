import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import {
  Cache,
  constants,
  Env,
  formatZodError,
  getSimpleTextHash,
  makeRequest,
} from '../utils/index.js';
import { z } from 'zod';
import { FormData } from 'undici';

const manifestCache = Cache.getInstance<string, string>(
  'ai-companion-manifests'
);

export class AICompanionPreset extends Preset {
  private static languages = [
    { label: 'English', value: 'en-US' },
    { label: 'Portuguese (Brazil)', value: 'pt-BR' },
    { label: 'Portuguese (Portugal)', value: 'pt-PT' },
    { label: 'Spanish', value: 'es' },
    { label: 'French', value: 'fr' },
    { label: 'German', value: 'de' },
    { label: 'Italian', value: 'it' },
    { label: 'Japanese', value: 'ja' },
    { label: 'Mandarin', value: 'zh' },
    { label: 'Korean', value: 'ko' },
    { label: 'Russian', value: 'ru' },
    { label: 'Arabic', value: 'ar' },
    { label: 'Dutch', value: 'nl' },
    { label: 'Swedish', value: 'sv' },
    { label: 'Turkish', value: 'tr' },
    { label: 'Polish', value: 'pl' },
    { label: 'Hindi', value: 'hi' },
  ];
  private static catalogs = [
    {
      label: "Critic's Picks",
      value: 'critics_picks',
    },
    {
      label: 'Hidden Gems',
      value: 'hidden_gems',
    },
    {
      label: 'New Releases',
      value: 'new_releases',
    },
    {
      label: 'Trending This Week',
      value: 'trending',
    },
  ];
  static override get METADATA() {
    const supportedResources = [constants.CATALOG_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'AI Companion',
        supportedResources,
        Env.DEFAULT_AI_COMPANION_TIMEOUT
      ),
      {
        id: 'providerBaseUrl',
        name: 'LLM Provider',
        description: 'Choose the LLM Provider to use.',
        type: 'select-with-custom',
        default: 'https://openrouter.ai/api/v1',
        required: true,
        options: [
          {
            label: 'OpenRouter',
            value: 'https://openrouter.ai/api/v1',
          },
          {
            label: 'OpenAI',
            value: 'https://api.openai.com/v1',
          },
          {
            label: 'Anthropic',
            value: 'https://api.anthropic.com/v1',
          },
          {
            label: 'Gemini (OpenAI Compatible)',
            value: 'https://generativelanguage.googleapis.com/v1beta/openai',
          },
        ],
      },

      {
        id: 'providerApiKey',
        name: 'LLM Provider API Key',
        description: 'Enter your LLM provider API key here. This is required.',
        type: 'password',
        required: true,
      },
      {
        id: 'language',
        name: 'Preferred Search Language',
        description:
          'Select your preferred language for search queries. This impacts the language for metadata extraction.',
        type: 'select',
        required: false,
        default: 'en-US',
        options: AICompanionPreset.languages,
      },
      {
        id: 'model',
        name: 'Model Name',
        description: 'The model to use.',
        type: 'string',
        default: 'openai/gpt-5-mini:online',
      },
      {
        id: 'maxResults',
        type: 'number',
        name: 'Maximum Results',
        description: 'Maximum number of results per search (1-30) ',
        default: 10,
        constraints: {
          min: 1,
          max: 30,
          forceInUi: true,
        },
        required: true,
      },
      {
        id: 'movieFeedCatalogs',
        name: 'Movie Feed Catalogs',
        description:
          'The catalogs to use for movie feeds. You can select multiple catalogs.',
        type: 'multi-select',
        required: false,
        options: AICompanionPreset.catalogs,
        default: AICompanionPreset.catalogs.map((c) => c.value),
      },
      {
        id: 'seriesFeedCatalogs',
        name: 'Series Feed Catalogs',
        description:
          'The catalogs to use for series feeds. You can select multiple catalogs.',
        type: 'multi-select',
        required: false,
        options: AICompanionPreset.catalogs,
        default: AICompanionPreset.catalogs.map((c) => c.value),
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'github',
            url: 'https://github.com/willtho89/stremio-ai-companion',
          },
          {
            id: 'buymeacoffee',
            url: 'https://buymeacoffee.com/willtho89',
          },
        ],
      },
    ];

    return {
      ID: 'ai-companion',
      NAME: 'AI Companion',
      LOGO: `https://raw.githubusercontent.com/willtho89/stremio-ai-companion/refs/heads/main/.assets/logo2_256.png`,
      URL: Env.AI_COMPANION_URL,
      TIMEOUT: Env.DEFAULT_AI_COMPANION_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_AI_COMPANION_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Your AI-powered movie and series recommendations.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    if (!userData.tmdbAccessToken && !Env.TMDB_ACCESS_TOKEN) {
      throw new Error(
        `${this.METADATA.NAME} requires a TMDB access token to function. Please provide a valid TMDB access token in the services menu.`
      );
    }
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

    const providerBaseUrl =
      options.providerBaseUrl === 'custom'
        ? options.customBaseUrl
        : options.providerBaseUrl;

    if (!providerBaseUrl) {
      throw new Error(
        `Provider base URL is required. If you selected "Custom LLM Provider", please provide the base URL.`
      );
    }

    const movieFeedCatalogs: string[] = (options.movieFeedCatalogs || []).sort(
      (a: string, b: string) =>
        AICompanionPreset.catalogs.findIndex((c) => c.value === a) -
        AICompanionPreset.catalogs.findIndex((c) => c.value === b)
    );
    const seriesFeedCatalogs: string[] = (
      options.seriesFeedCatalogs || []
    ).sort(
      (a: string, b: string) =>
        AICompanionPreset.catalogs.findIndex((c) => c.value === a) -
        AICompanionPreset.catalogs.findIndex((c) => c.value === b)
    );

    const cacheKey = getSimpleTextHash(
      `${url}-${providerBaseUrl}-${options.providerApiKey}-${options.model}-${options.language}-${options.maxResults}-${movieFeedCatalogs}-${seriesFeedCatalogs}`
    );
    const form = new FormData();
    form.append('openai_base_url', providerBaseUrl);
    form.append('openai_api_key', options.providerApiKey);
    form.append('model_name', options.model);
    form.append('language', options.language || 'en-US');
    form.append(
      'tmdb_read_access_token',
      userData.tmdbAccessToken || Env.TMDB_ACCESS_TOKEN
    );
    form.append('max_results', options.maxResults.toString());

    const defaultCatalogs = AICompanionPreset.catalogs.map((c) => c.value);
    const changedCatalogs =
      movieFeedCatalogs !== defaultCatalogs ||
      seriesFeedCatalogs !== defaultCatalogs;
    form.append('changed_catalogs', changedCatalogs ? 'true' : 'false');
    movieFeedCatalogs.forEach((catalog: string) =>
      form.append('include_catalogs_movies', catalog)
    );
    seriesFeedCatalogs.forEach((catalog: string) =>
      form.append('include_catalogs_series', catalog)
    );

    form.append('include_catalogs_movies', movieFeedCatalogs.join(','));
    form.append('include_catalogs_series', seriesFeedCatalogs.join(','));

    let manifestUrl: string | undefined = await manifestCache.get(cacheKey);
    if (manifestUrl) {
      return manifestUrl;
    }
    let response;
    try {
      response = await makeRequest(`${url}/save-config`, {
        timeout: this.METADATA.TIMEOUT,
        method: 'POST',
        body: form,
      });

      const data = await response.json();

      const schema = z.union([
        z.object({
          success: z.literal(true),
          manifest_url: z.string().url(),
          manifest_urls: z.object({
            combined: z.string().url(),
            movie: z.string().url(),
            series: z.string().url(),
          }),
          preview_url: z.string().url().optional(),
          detail: z.string().optional(),
        }),
        z.object({
          success: z.literal(false),
          detail: z.string().optional(),
        }),
      ]);
      const parseResult = schema.safeParse(data);
      if (!parseResult.success) {
        throw new Error(
          `Invalid response from server (${response.status} - ${response.statusText}): Got ${JSON.stringify(data)}, errors: ${formatZodError(parseResult.error)}`
        );
      }

      const result = parseResult.data;
      if (!result.success || !result.manifest_url) {
        throw new Error(result.detail || 'Unknown error');
      }
      await manifestCache.set(
        cacheKey,
        result.manifest_url,
        365 * 24 * 60 * 60
      );
      return result.manifest_url;
    } catch (error) {
      throw new Error(
        `Failed to generate manifest URL for AI Companion: ${error}`
      );
    }
  }
}
