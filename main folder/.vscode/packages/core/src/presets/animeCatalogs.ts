import { Addon, Option, UserData } from '../db';
import { Preset, baseOptions } from './preset';
import { constants, Env } from '../utils';

export class AnimeCatalogsPreset extends Preset {
  private static malCatalogs = [
    {
      label: 'Top All Time',
      value: 'myanimelist_top-all-time',
    },
    {
      label: 'Top Airing',
      value: 'myanimelist_top-airing',
    },
    {
      label: 'Top Series',
      value: 'myanimelist_top-series',
    },
    {
      label: 'Top Movies',
      value: 'myanimelist_top-movies',
    },
    {
      label: 'Popular',
      value: 'myanimelist_popular',
    },
    {
      label: 'Most Favorited',
      value: 'myanimelist_most-favorited',
    },
  ];

  private static anidbCatalogs = [
    {
      label: 'Popular',
      value: 'anidb_popular',
    },
    {
      label: 'Latest Started',
      value: 'anidb_latest-started',
    },
    {
      label: 'Latest Ended',
      value: 'anidb_latest-ended',
    },
    {
      label: 'Best of 10s',
      value: 'anidb_best-of-10s',
    },
    {
      label: 'Best of 00s',
      value: 'anidb_best-of-00s',
    },
    {
      label: 'Best of 90s',
      value: 'anidb_best-of-90s',
    },
    {
      label: 'Best of 80s',
      value: 'anidb_best-of-80s',
    },
  ];

  private static anilistCatalogs = [
    {
      label: 'Trending Now',
      value: 'anilist_trending-now',
    },
    {
      label: 'Popular This Season',
      value: 'anilist_popular-this-season',
    },
    {
      label: 'Upcoming Next Season',
      value: 'anilist_upcoming-next-season',
    },
    {
      label: 'All Time Popular',
      value: 'anilist_all-time-popular',
    },
    {
      label: 'Top Anime',
      value: 'anilist_top-anime',
    },
  ];

  private static kitsuCatalogs = [
    {
      label: 'Top Airing',
      value: 'kitsu_top-airing',
    },
    {
      label: 'Most Popular',
      value: 'kitsu_most-popular',
    },
    {
      label: 'Highest Rated',
      value: 'kitsu_highest-rated',
    },
    {
      label: 'Newest',
      value: 'kitsu_newest',
    },
  ];

  private static anisearchCatalogs = [
    {
      label: 'Top All Time',
      value: 'anisearch_top-all-time',
    },
    {
      label: 'Trending',
      value: 'anisearch_trending',
    },
    {
      label: 'Popular',
      value: 'anisearch_popular',
    },
  ];

  private static livechartCatalogs = [
    {
      label: 'Popular',
      value: 'livechart_popular',
    },
    {
      label: 'Top Rated',
      value: 'livechart_top-rated',
    },
  ];

  private static notifymoeCatalogs = [
    {
      label: 'Airing Now',
      value: 'notifymoe_airing-now',
    },
  ];

  static override get METADATA() {
    const supportedResources = [constants.CATALOG_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Anime Catalogs',
        supportedResources,
        Env.DEFAULT_ANIME_CATALOGS_TIMEOUT
      ).filter((option) => option.id !== 'url'),
      {
        id: 'dubbed',
        name: 'Show Dubbed content only',
        description: 'Only show items that have a dubbed version available',
        type: 'boolean',
        default: false,
      },
      {
        id: 'cinemeta',
        name: 'Use Cinemeta Ordering',
        description:
          'Order results using Cinemeta metadata rather than Kitsu (one entry for all seasons rather than one entry per season)',
        type: 'boolean',
        default: false,
      },
      {
        id: 'search',
        name: 'Enable Search',
        description: 'Enable searching for anime using Kitsu',
        type: 'boolean',
        default: true,
      },
      {
        id: 'mal_catalogs',
        name: 'MyAnimeList Catalogs',
        description: 'MyAnimeList catalog sections to include',
        type: 'multi-select',
        options: this.malCatalogs,
        default: [],
      },
      {
        id: 'anidb_catalogs',
        name: 'AniDB Catalogs',
        description: 'AniDB catalog sections to include',
        type: 'multi-select',
        options: this.anidbCatalogs,
        default: [],
      },
      {
        id: 'anilist_catalogs',
        name: 'AniList Catalogs',
        description: 'AniList catalog sections to include',
        type: 'multi-select',
        options: this.anilistCatalogs,
        default: [],
      },
      {
        id: 'kitsu_catalogs',
        name: 'Kitsu Catalogs',
        description: 'Kitsu catalog sections to include',
        type: 'multi-select',
        options: this.kitsuCatalogs,
        default: [],
      },
      {
        id: 'anisearch_catalogs',
        name: 'AniSearch Catalogs',
        description: 'AniSearch catalog sections to include',
        type: 'multi-select',
        options: this.anisearchCatalogs,
        default: [],
      },
      {
        id: 'livechart_catalogs',
        name: 'LiveChart Catalogs',
        description: 'LiveChart catalog sections to include',
        type: 'multi-select',
        options: this.livechartCatalogs,
        default: [],
      },
      {
        id: 'notifymoe_catalogs',
        name: 'Notify.moe Catalogs',
        description: 'Notify.moe catalog sections to include',
        type: 'multi-select',
        options: this.notifymoeCatalogs,
        default: [],
      },
    ];

    return {
      ID: 'anime-catalogs',
      NAME: 'Anime Catalogs',
      LOGO: `${Env.ANIME_CATALOGS_URL}/addon-logo.png`,
      URL: Env.ANIME_CATALOGS_URL,
      TIMEOUT: Env.DEFAULT_ANIME_CATALOGS_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_ANIME_CATALOGS_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Catalogs for your favourite anime from: MyAnimeList, AniDB, AniList, Kitsu, aniSearch, LiveChart.me, Notify.Moe',
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
    // generate a joint list of all catalogs
    const enabledCatalogs = [
      ...(options.mal_catalogs || []),
      ...(options.anidb_catalogs || []),
      ...(options.anilist_catalogs || []),
      ...(options.kitsu_catalogs || []),
      ...(options.anisearch_catalogs || []),
      ...(options.livechart_catalogs || []),
      ...(options.notifymoe_catalogs || []),
    ];
    // {"dubbed":"on","cinemeta":"on","search":"on","myanimelist_top-all-time":"on","myanimelist_top-airing":"on","myanimelist_top-series":"on","myanimelist_top-movies":"on","myanimelist_popular":"on","myanimelist_most-favorited":"on","anidb_popular":"on","anidb_latest-started":"on","anidb_latest-ended":"on","anidb_best-of-10s":"on","anidb_best-of-00s":"on","anidb_best-of-90s":"on","anidb_best-of-80s":"on","anilist_trending-now":"on","anilist_popular-this-season":"on","anilist_upcoming-next-season":"on","anilist_all-time-popular":"on","anilist_top-anime":"on","kitsu_top-airing":"on","kitsu_most-popular":"on","kitsu_highest-rated":"on","kitsu_newest":"on","anisearch_top-all-time":"on","anisearch_trending":"on","anisearch_popular":"on","livechart_popular":"on","livechart_top-rated":"on","notifymoe_airing-now":"on"}
    const config = this.urlEncodeJSON({
      dubbed: options.dubbed ? 'on' : undefined,
      cinemeta: options.cinemeta ? 'on' : undefined,
      search: options.search ? 'on' : undefined,
      ...enabledCatalogs.reduce((acc, catalog) => {
        acc[catalog] = 'on';
        return acc;
      }, {}),
    });
    return {
      name: options.name || this.METADATA.NAME,
      identifier: '',
      manifestUrl: `${Env.ANIME_CATALOGS_URL}/${config}/manifest.json`,
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
