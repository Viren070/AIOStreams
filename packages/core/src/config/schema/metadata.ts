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
      default: true,
      label: 'Fetch Trakt aliases',
      description: 'Enable fetching aliases from Trakt.',
      env: 'FETCH_TRAKT_ALIASES',
      requiresRestart: false,
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
        label: 'Manami offline DB refresh interval (s)',
        description: 'Refresh interval for the Manami anime offline database.',
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
    },
  },
} as const satisfies RuntimeConfigSection;
