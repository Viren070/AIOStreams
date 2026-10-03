import { z } from 'zod';
import { seconds } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

const nullableString = z.string().nullable();

export const metadataSchema = {
  tmdb: {
    accessToken: {
      schema: nullableString,
      default: null,
      label: 'TMDB Read Access Token',
      description: 'TMDB Read Access Token used for strict title matching.',
      env: 'TMDB_ACCESS_TOKEN',
      requiresRestart: false,
      secret: true,
    },
    apiKey: {
      schema: nullableString,
      default: null,
      label: 'TMDB API key',
      description: 'TMDB API key used for strict title matching.',
      env: 'TMDB_API_KEY',
      requiresRestart: false,
      secret: true,
    },
  },
  tvdb: {
    apiKey: {
      schema: nullableString,
      default: null,
      label: 'TVDB API key',
      description: 'TVDB API key used for fetching metadata.',
      env: 'TVDB_API_KEY',
      requiresRestart: false,
      secret: true,
    },
  },
  trakt: {
    clientId: {
      schema: nullableString,
      default: null,
      label: 'Trakt client ID',
      description: 'Trakt client ID used for fetching aliases.',
      env: 'TRAKT_CLIENT_ID',
      requiresRestart: false,
      secret: false,
    },
    fetchAliases: {
      schema: z.boolean(),
      default: false,
      label: 'Fetch Trakt aliases',
      description: 'Enable fetching aliases from Trakt. Requires a client ID.',
      env: 'FETCH_TRAKT_ALIASES',
      requiresRestart: false,
      secret: false,
    },
  },
  idMappings: {
    enabled: {
      schema: z.boolean(),
      default: true,
      label: 'ID mappings',
      description:
        'Fetch a keyless cross-provider (imdb/tvdb/tmdb) ID mapping dataset used to fill missing ids without extra API calls and to enable the keyless metadata fallback.',
      env: 'ID_MAPPINGS_ENABLED',
      requiresRestart: true,
      secret: false,
    },
    tvUrl: {
      schema: z.string(),
      default:
        'https://raw.githubusercontent.com/0xConstant1/Wikidata-Fetcher/main/data/tv_mappings.csv',
      label: 'ID mappings TV URL',
      description: 'URL of the TV ID mapping CSV.',
      env: 'ID_MAPPINGS_TV_URL',
      requiresRestart: true,
      secret: false,
    },
    movieUrl: {
      schema: z.string(),
      default:
        'https://raw.githubusercontent.com/0xConstant1/Wikidata-Fetcher/main/data/movie_mappings.csv',
      label: 'ID mappings movie URL',
      description: 'URL of the movie ID mapping CSV.',
      env: 'ID_MAPPINGS_MOVIE_URL',
      requiresRestart: true,
      secret: false,
    },
    refreshInterval: {
      schema: seconds,
      default: 1 * 24 * 60 * 60,
      label: 'ID mappings refresh interval (s)',
      description: 'Refresh interval for the ID mapping dataset.',
      env: 'ID_MAPPINGS_REFRESH_INTERVAL',
      requiresRestart: true,
      secret: false,
    },
  },
  titleConflicts: {
    enabled: {
      schema: z.boolean(),
      default: true,
      label: 'Title conflict detection',
      description:
        'Detect same-name series (reboots and country variants, e.g. The Office UK vs US) via TMDB/TVDB search so queries and matching filters can disambiguate results.',
      env: 'TITLE_CONFLICTS_ENABLED',
      requiresRestart: false,
      secret: false,
    },
  },
  sceneMappings: {
    enabled: {
      schema: z.boolean(),
      default: true,
      label: 'Scene mappings',
      description:
        'Fetch scene title mappings (e.g. "Stephen Colbert" for The Late Show) used for search queries and title matching.',
      env: 'SCENE_MAPPINGS_ENABLED',
      requiresRestart: true,
      secret: false,
    },
    url: {
      schema: z.string(),
      default: 'https://services.sonarr.tv/v1/scenemapping',
      label: 'Scene mappings URL',
      description: 'URL of the scene mapping list.',
      env: 'SCENE_MAPPINGS_URL',
      requiresRestart: true,
      secret: false,
    },
    refreshInterval: {
      schema: seconds,
      default: 86400,
      label: 'Scene mappings refresh interval (s)',
      description: 'Refresh interval for the scene mapping list.',
      env: 'SCENE_MAPPINGS_REFRESH_INTERVAL',
      requiresRestart: true,
      secret: false,
    },
  },
  animeDb: {
    levelOfDetail: {
      schema: z.enum(['none', 'required', 'full']),
      default: 'required',
      label: 'Anime DB level of detail',
      description:
        '"none" disables the anime DB; "required" loads only required mappings; "full" loads everything.',
      env: 'ANIME_DB_LEVEL_OF_DETAIL',
      requiresRestart: true,
      secret: false,
    },
    suppressSiblingAliases: {
      schema: z.boolean(),
      default: false,
      label: 'Suppress cross-season anime aliases',
      description:
        'When multiple anime seasons/cours share an external ID, suppress broad show aliases from TMDB/TVDB/Trakt so they do not leak across seasons.',
      env: 'ANIME_DB_SUPPRESS_SIBLING_ALIASES',
      requiresRestart: false,
      secret: false,
    },
    refresh: {
      fribbMappings: {
        schema: seconds,
        default: 86400,
        label: 'Fribb mappings refresh interval (s)',
        description:
          'Refresh interval for the Fribb anime mappings (seconds; accepts e.g. "1d").',
        env: 'ANIME_DB_FRIBB_MAPPINGS_REFRESH_INTERVAL',
        requiresRestart: true,
        secret: false,
      },
      manamiDb: {
        schema: seconds,
        default: 7 * 86400,
        label: 'Anime offline DB refresh interval (s)',
        description:
          'Refresh interval for the anime offline database (cedya77 continuation of the Manami project).',
        env: 'ANIME_DB_MANAMI_DB_REFRESH_INTERVAL',
        requiresRestart: true,
        secret: false,
      },
      kitsuImdbMapping: {
        schema: seconds,
        default: 86400,
        label: 'Kitsu↔IMDB mapping refresh (s)',
        description: 'Refresh interval for the Kitsu↔IMDB mapping.',
        env: 'ANIME_DB_KITSU_IMDB_MAPPING_REFRESH_INTERVAL',
        requiresRestart: true,
        secret: false,
      },
      extendedAnitraktMovies: {
        schema: seconds,
        default: 86400,
        label: 'Extended Anitrakt movies refresh (s)',
        description:
          'Refresh interval for the Extended Anitrakt movies dataset.',
        env: 'ANIME_DB_EXTENDED_ANITRAKT_MOVIES_REFRESH_INTERVAL',
        requiresRestart: true,
        secret: false,
      },
      extendedAnitraktTv: {
        schema: seconds,
        default: 86400,
        label: 'Extended Anitrakt TV refresh (s)',
        description: 'Refresh interval for the Extended Anitrakt TV dataset.',
        env: 'ANIME_DB_EXTENDED_ANITRAKT_TV_REFRESH_INTERVAL',
        requiresRestart: true,
        secret: false,
      },
      animeList: {
        schema: seconds,
        default: 7 * 86400,
        label: 'Anime list refresh (s)',
        description: 'Refresh interval for the Anime List XML dataset.',
        env: 'ANIME_DB_ANIME_LIST_REFRESH_INTERVAL',
        requiresRestart: true,
        secret: false,
      },
      animeApi: {
        schema: seconds,
        default: 86400,
        label: 'AnimeApi refresh (s)',
        description:
          'Refresh interval for the nattadasu/animeApi dataset (anidb/anilist/mal/kitsu/imdb/tmdb/tvdb/trakt mappings).',
        env: 'ANIME_DB_ANIMEAPI_REFRESH_INTERVAL',
        requiresRestart: true,
        secret: false,
      },
    },
  },
} as const satisfies RuntimeConfigSection;
