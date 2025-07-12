import { Addon, Option, UserData } from '../db';
import { Preset, baseOptions } from './preset';
import { constants, Env, FULL_LANGUAGE_MAPPING } from '../utils';
import { debridioSocialOption } from './debridio';

export class DebridioTmdbPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Debridio TMDB',
        supportedResources,
        Env.DEFAULT_DEBRIDIO_TMDB_TIMEOUT
      ),
      {
        id: 'debridioApiKey',
        name: 'Debridio API Key',
        description:
          'Your Debridio API Key, located at your [account settings](https://debridio.com/account)',
        type: 'password',
        required: true,
      },
      {
        id: 'language',
        name: 'Language',
        description: 'The language of the catalogs',
        type: 'select',
        default: 'en-US',
        options: FULL_LANGUAGE_MAPPING.sort((a, b) =>
          a.english_name.localeCompare(b.english_name)
        ).map((language) => ({
          label: language.english_name,
          value: `${language.iso_639_1}-${language.iso_3166_1}`,
        })),
        required: false,
      },
      {
        id: 'alert',
        name: '',
        description:
          'The language selector above will not work for some languages due to the option values not being consistent. In which case, you can override the URL with a preconfigured Manifest URL.',
        type: 'alert',
      },
      debridioSocialOption,
    ];

    return {
      ID: 'debridio-tmdb',
      NAME: 'Debridio TMDB',
      LOGO: 'https://res.cloudinary.com/adobotec/image/upload/w_120,h_120/v1735925306/debridio/logo.png.png',
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
      presetType: this.METADATA.ID,
      presetInstanceId: '',
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }
}
