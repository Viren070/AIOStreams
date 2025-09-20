export const ID_TYPES = [
  'animePlanetId',
  'animecountdownId',
  'anidbId',
  'anilistId',
  'anisearchId',
  'imdbId',
  'kitsuId',
  'livechartId',
  'malId',
  'notifyMoeId',
  'simklId',
  'themoviedbId',
  'thetvdbId',
  'traktId',
] as const;

export type IdType = (typeof ID_TYPES)[number];

export type ExternalIdType =
  | 'anime-planet_id'
  | 'animecountdown_id'
  | 'anidb_id'
  | 'anilist_id'
  | 'anisearch_id'
  | 'imdb_id'
  | 'kitsu_id'
  | 'livechart_id'
  | 'mal_id'
  | 'notify.moe_id'
  | 'simkl_id'
  | 'themoviedb_id'
  | 'thetvdb_id';
export interface ParsedId {
  type: IdType;
  value: string | number;
  fullId: string;
  externalType: ExternalIdType;
  mediaType: string;
  season?: string;
  episode?: string;
  generator: (
    value: string | number,
    season?: string,
    episode?: string
  ) => string;
}

interface IdParserDefinition {
  type: IdType;
  externalType: ExternalIdType;
  prefixes: string[];
  // Regex should have named capture groups:
  // - id: the base ID (required)
  // - season: the season number (optional)
  // - episode: the episode number (optional)
  regex: RegExp;
  format: (id: string) => string | number;
  generator: (
    value: string | number,
    season?: string,
    episode?: string
  ) => string;
}

export class IdParser {
  private static readonly ID_PARSERS: IdParserDefinition[] = [
    {
      type: 'imdbId',
      externalType: 'imdb_id',
      prefixes: ['tt', 'imdb'],
      regex: /^(?:tt|imdb)[:-]?(?<id>\d+)(?::(?<season>\d+):(?<episode>\d+))?$/,
      format: (id) => `tt${id}`,
      generator: (value, season, episode) => `${value}:${season}:${episode}`,
    },
    {
      type: 'malId',
      externalType: 'mal_id',
      prefixes: ['mal'],
      regex: /^mal[:-]?(?<id>\d+)(?::(?<episode>\d+))?$/,
      format: (id) => Number(id),
      generator: (value, season, episode) => `mal:${value}:${episode}`,
    },
    {
      type: 'thetvdbId',
      externalType: 'thetvdb_id',
      prefixes: ['tvdb'],
      regex: /^tvdb[:-]?(?<id>\d+)(?::(?<season>\d+):(?<episode>\d+))?$/,
      format: (id) => Number(id),
      generator: (value, season, episode) =>
        `tvdb:${value}:${season}:${episode}`,
    },
    {
      type: 'themoviedbId',
      externalType: 'themoviedb_id',
      prefixes: ['tmdb'],
      regex: /^tmdb[:-]?(?<id>\d+)(?::(?<season>\d+):(?<episode>\d+))?$/,
      format: (id) => Number(id),
      generator: (value, season, episode) =>
        `tmdb:${value}:${season}:${episode}`,
    },
    {
      type: 'kitsuId',
      externalType: 'kitsu_id',
      prefixes: ['kitsu'],
      regex: /^kitsu[:-]?(?<id>\d+)(?::(?<episode>\d+))?$/,
      format: (id) => Number(id),
      generator: (value, season, episode) => `kitsu:${value}:${episode}`,
    },
    {
      type: 'anilistId',
      externalType: 'anilist_id',
      prefixes: ['anilist'],
      regex: /^anilist[:-]?(?<id>\d+)(?::(?<episode>\d+))?$/,
      format: (id) => Number(id),
      generator: (value, season, episode) => `anilist:${value}:${episode}`,
    },
    {
      type: 'anidbId',
      externalType: 'anidb_id',
      prefixes: ['anidb', 'anidb_id', 'anidbid'],
      regex: /^(?:anidb|anidb_id|anidbid)[:-]?(?<id>\d+)(?::(?<episode>\d+))?$/,
      format: (id) => Number(id),
      generator: (value, season, episode) => `anidb:${value}:${episode}`,
    },
    {
      type: 'animePlanetId',
      externalType: 'anime-planet_id',
      prefixes: ['animeplanet', 'ap'],
      regex: /^(?:animeplanet|ap)[:-]?(?<id>\d+)$/,
      format: (id) => Number(id),
      generator: (value, season, episode) => `animeplanet:${value}:${episode}`,
    },
    {
      type: 'animecountdownId',
      externalType: 'animecountdown_id',
      prefixes: ['acd'],
      regex: /^acd[:-]?(?<id>\d+)$/,
      format: (id) => Number(id),
      generator: (value, season, episode) => `acd:${value}:${episode}`,
    },
    {
      type: 'anisearchId',
      externalType: 'anisearch_id',
      prefixes: ['anisearch'],
      regex: /^anisearch[:-]?(?<id>\d+)$/,
      format: (id) => Number(id),
      generator: (value, season, episode) => `anisearch:${value}:${episode}`,
    },
    {
      type: 'notifyMoeId',
      externalType: 'notify.moe_id',
      prefixes: ['notifymoe', 'nm'],
      regex: /^(?:notifymoe|nm)[:-]?(?<id>[a-zA-Z0-9]+)$/,
      format: (id) => id,
      generator: (value, season, episode) => `notifymoe:${value}:${episode}`,
    },
    {
      type: 'simklId',
      externalType: 'simkl_id',
      prefixes: ['simkl'],
      regex: /^simkl[:-]?(?<id>\d+)$/,
      format: (id) => Number(id),
      generator: (value, season, episode) => `simkl:${value}:${episode}`,
    },
  ];

  constructor() {}

  public static getPrefixes(types: IdType[]): string[] {
    return IdParser.ID_PARSERS.filter((p) => types.includes(p.type)).flatMap(
      (p) => p.prefixes
    );
  }

  public static parse(stremioId: string, mediaType: string): ParsedId | null {
    for (const parser of IdParser.ID_PARSERS) {
      const match = stremioId.match(parser.regex);
      if (match?.groups) {
        const { id, season, episode } = match.groups;
        const parsedId: ParsedId = {
          type: parser.type,
          value: parser.format(id),
          fullId: stremioId,
          externalType: parser.externalType,
          mediaType,
          generator: parser.generator,
        };

        if (season) parsedId.season = season;
        if (episode) parsedId.episode = episode;

        return parsedId;
      }
    }

    return null;
  }
}
