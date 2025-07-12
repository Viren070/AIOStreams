import { Preset, baseOptions } from './preset';
import { constants, Env, FULL_LANGUAGE_MAPPING } from '../utils';
import { Addon, Option, UserData } from '../db';

export class TMDBAddonPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'The Movie Database',
        supportedResources,
        Env.DEFAULT_TMDB_ADDON_TIMEOUT
      ),
      {
        id: 'Enable Adult Content',
        name: 'Enable Adult Content',
        description: 'Enable adult content',
        type: 'boolean',
        default: false,
        required: false,
      },
      {
        id: 'hideEpisodeThumbnails',
        name: 'Hide Episode Thumbnails',
        description: 'Avoid spoilers by hiding episode preview images',
        type: 'boolean',
        default: false,
        required: false,
      },
      {
        id: 'provideImdbId',
        name: 'Provide IMDB IDs',
        description:
          'Provide IMDB IDs in metadata responses for improved compatability with other addons.',
        type: 'boolean',
        default: false,
        required: false,
      },
      {
        id: 'ageRating',
        name: 'Age Rating',
        description: 'The age rating of the catalogs',
        type: 'select',
        options: [
          { label: 'All', value: undefined },
          { label: 'General Audiences', value: 'G' },
          { label: 'Parental Guidance Suggested', value: 'PG' },
          { label: 'Parents Strongly Cautioned', value: 'PG-13' },
          { label: 'Restricted', value: 'R' },
          { label: 'Adults Only', value: 'NC-17' },
        ],
        required: false,
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
    ];

    return {
      ID: 'tmdb-addon',
      NAME: 'The Movie Database',
      LOGO: 'https://raw.githubusercontent.com/mrcanelas/tmdb-addon/refs/heads/main/public/logo.png',
      URL: Env.TMDB_ADDON_URL,
      TIMEOUT: Env.DEFAULT_TMDB_ADDON_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_TMDB_ADDON_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Provides rich metadata for movies and TV shows from TMDB',
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

      const config = this.urlEncodeJSON({
        includeAdult: options.includeAdult ? 'true' : undefined,
        provideImdbId: options.provideImdbId ? 'true' : undefined,
        hideEpisodeThumbnails: options.hideEpisodeThumbnails
          ? 'true'
          : undefined,
        language: options.language || 'en-US',
        streaming: [],
        catalogs: [
          { id: 'tmdb.top', type: 'movie', name: 'Popular', showInHome: true },
          { id: 'tmdb.top', type: 'series', name: 'Popular', showInHome: true },
          { id: 'tmdb.year', type: 'movie', name: 'Year', showInHome: true },
          { id: 'tmdb.year', type: 'series', name: 'Year', showInHome: true },
          {
            id: 'tmdb.language',
            type: 'movie',
            name: 'Language',
            showInHome: true,
          },
          {
            id: 'tmdb.language',
            type: 'series',
            name: 'Language',
            showInHome: true,
          },
          {
            id: 'tmdb.trending',
            type: 'movie',
            name: 'Trending',
            showInHome: true,
          },
          {
            id: 'tmdb.trending',
            type: 'series',
            name: 'Trending',
            showInHome: true,
          },
        ],
        ageRating: options.ageRating,
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
