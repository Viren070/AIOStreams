import { Addon, Option, UserData } from '../db';
import { Preset, baseOptions } from './preset';
import { constants, Env, FULL_LANGUAGE_MAPPING } from '../utils';

export class TmdbCollectionsPreset extends Preset {
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
        name: 'Discover and open collection from movie details page',
        description:
          'Adds a button to movies details page that links to its collection',
        type: 'boolean',
        default: false,
        required: false,
      },
      {
        id: 'language',
        name: 'Language',
        description: 'The language of the catalogs',
        type: 'select',
        default: 'en',
        options: FULL_LANGUAGE_MAPPING.sort((a, b) =>
          a.english_name.localeCompare(b.english_name)
        )
          .filter(
            (language, index, self) =>
              index ===
              self.findIndex((l) => l.iso_639_1 === language.iso_639_1)
          )
          .map((language) => ({
            label: language.english_name.split('(')[0].trim(),
            value: `${language.iso_639_1}`,
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
      presetType: this.METADATA.ID,
      presetInstanceId: '',
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
