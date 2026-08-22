type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

type Endpoint = `${Method} /${string}` | `/${string}`;

type RequestOptions = Omit<RequestInit, 'body' | 'method'> & {
  body?: Record<string, unknown> | FormData | string;
  query?: Record<
    string,
    string | number | boolean | string[] | number[] | boolean[] | undefined
  >;
};

interface APIResponse<T> {
  success: boolean;
  detail: string | null;
  data: T | null;
  error: {
    code: string;
    message: string;
    issues?: any;
  } | null;
}

interface AIOStreamsSource {
  [key: string]: unknown;
}

interface AIOStreamsSubtitle {
  [key: string]: unknown;
}

interface AIOStreamsParsedFile {
  resolution?: string;
  episodes?: number[];
  releaseGroup?: string;
  seasonPack?: boolean;
  [key: string]: unknown;
}

interface AIOStreamsSearchApiResult {
  infoHash: string | null;
  seeders: number | null;
  age: number | null;
  sources: string[] | null;
  ytId: string | null;
  externalUrl: string | null;
  fileIdx: number | null;
  url: string | null;
  nzbUrl: string | null;
  rarUrls: AIOStreamsSource[] | null;
  '7zipUrls': AIOStreamsSource[] | null;
  zipUrls: AIOStreamsSource[] | null;
  tarUrls: AIOStreamsSource[] | null;
  tgzUrls: AIOStreamsSource[] | null;
  proxied: boolean;
  filename: string | null;
  folderName: string | null;
  size: number | null;
  folderSize: number | null;
  message: string | null;
  library: boolean;
  type: 'http' | 'usenet' | 'debrid' | 'live' | 'info' | 'p2p' | 'external';
  indexer: string | null;
  addon: string | null;
  duration: number | null;
  bitrate: number | null;
  videoHash: string | null;
  subtitles: AIOStreamsSubtitle[];
  countryWhitelist: string[];
  requestHeaders: Partial<Record<string, string>>;
  responseHeaders: Partial<Record<string, string>>;
  parsedFile?: AIOStreamsParsedFile;
  service: string | null;
  cached: boolean | null;
  servers: string[] | null;
  notWebReady: boolean | null;
  bingeGroup: string | null;
  private: boolean | null;
  seadexBest: boolean | null;
  seadex: boolean | null;
  name: string | null;
  description: string | null;
}

interface SearchApiResponse {
  errors: {
    description: string;
    title: string;
  }[];
  statistics?: {
    title: string;
    description: string;
  }[];
  results: AIOStreamsSearchApiResult[];
}

enum AnimeType {
  TV = 'TV',
  SPECIAL = 'SPECIAL',
  OVA = 'OVA',
  MOVIE = 'MOVIE',
  ONA = 'ONA',
  UNKNOWN = 'UNKNOWN',
}

enum AnimeSeason {
  WINTER = 'WINTER',
  SPRING = 'SPRING',
  SUMMER = 'SUMMER',
  FALL = 'FALL',
  UNDEFINED = 'UNDEFINED',
}

interface AnimeListMapping {
  anidbSeason: number;
  tvdbSeason?: number;
  tmdbSeason?: number;
  start?: number;
  end?: number;
  offset?: number;
  episodes?: string;
}

const ID_TYPES = [
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
  'stremioId',
] as const;

type IdType = (typeof ID_TYPES)[number];

interface ParsedId {
  type: IdType;
  value: string | number;
  season?: number;
  episode?: number;
}

interface AIOStreamsAnimeEntry {
  mappings?: {
    animePlanetId?: string | number;
    animecountdownId?: number;
    anidbId?: number;
    anilistId?: number;
    anisearchId?: number;
    imdbId?: string | null;
    kitsuId?: number;
    livechartId?: number;
    malId?: number;
    notifyMoeId?: string;
    simklId?: number;
    themoviedbId?: number;
    thetvdbId?: number | null;
    traktId?: number;
    season?:
      | {
          tvdb?: number;
          tmdb?: number;
        }
      | undefined;
  };
  type: AnimeType;
  imdb?: {
    seasonNumber?: number;
    fromEpisode?: number;
    nonImdbEpisodes?: number[];
    title?: string;
  } | null;
  fanart?: {
    logoId: number;
  } | null;
  trakt?: {
    title: string;
    slug: string;
    isSplitCour?: boolean;
    seasonId?: number | null;
    seasonNumber?: number | null;
  } | null;
  tmdb: {
    seasonNumber: number | null;
    seasonId: number | null;
    fromEpisode?: number | null; // Episode offset from AnimeList
  };
  tvdb: {
    seasonNumber: number | null;
    seasonId: number | null;
    fromEpisode?: number | null; // Episode offset from AnimeList
  };
  title?: string;
  animeSeason?: {
    season: AnimeSeason;
    year: number | null;
  };
  synonyms?: string[];
  episodeMappings?: AnimeListMapping[];
}

/**
 * API Error thrown when the server returns an error response
 */
class APIError extends Error {
  status: number;
  code: string;
  detail: string | null;
  issues?: any;

  constructor(
    status: number,
    code: string,
    message: string,
    detail: string | null = null,
    issues?: any
  ) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.issues = issues;
  }

  /**
   * Check if this is a specific error code
   */
  is(code: string): boolean {
    return this.code === code;
  }
}

class AIOStreamsAPI {
  private baseUrl: string;
  constructor(
    baseUrl: string,
    private uuid: string,
    private password: string,
    readonly variants: string[] = []
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async search(
    type: string,
    id: string,
    season?: number,
    episode?: number
  ): Promise<SearchApiResponse> {
    const fullId = `${id}${season !== undefined ? `:${season}` : ''}${episode !== undefined ? `:${episode}` : ''}`;

    return this.request<SearchApiResponse>('/search', {
      query: {
        type,
        id: fullId,
        format: true,
        // Comma separated in one param: the server only reads the first `v`.
        [VARIANT_QUERY_PARAM]: this.variants.length
          ? this.variants.join(',')
          : undefined,
      },
    });
  }

  async anime(
    idType: IdType,
    idValue: string | number,
    season?: number,
    episode?: number
  ): Promise<AIOStreamsAnimeEntry | null> {
    return this.request<AIOStreamsAnimeEntry>('/anime', {
      query: {
        idType,
        idValue,
        season,
        episode,
      },
    });
  }

  private async request<T>(
    endpoint: Endpoint,
    options: RequestOptions = {}
  ): Promise<T> {
    const { body, query, ...fetchOptions } = options;

    // Parse endpoint for method and path
    const [method, path] = endpoint.includes(' /')
      ? (endpoint.split(' /') as [Method, string])
      : (['GET', endpoint.slice(1)] as [Method, string]);

    let queryString = '';
    if (query) {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(query)) {
        const encodedKey = encodeURIComponent(key);
        if (Array.isArray(value)) {
          value.forEach((v) => {
            parts.push(`${encodedKey}=${encodeURIComponent(String(v))}`);
          });
        } else if (value !== undefined) {
          parts.push(`${encodedKey}=${encodeURIComponent(String(value))}`);
        }
      }
      if (parts.length > 0) {
        queryString = `?${parts.join('&')}`;
      }
    }

    const apiPath = `/api/v1/${path}${queryString}`;
    const url = `${this.baseUrl}${apiPath}`;

    const headers: Record<string, string> = {
      ...((fetchOptions.headers as Record<string, string> | undefined) ?? {}),
    };

    const authString = `${this.uuid}:${this.password}`;
    const encodedAuth = CryptoJS.enc.Base64.stringify(
      CryptoJS.enc.Utf8.parse(authString)
    );
    headers['Authorization'] = `Basic ${encodedAuth}`;

    const request: RequestInit = {
      method,
      credentials: 'include',
      ...fetchOptions,
      headers,
    };

    if (body !== undefined) {
      if (body instanceof FormData) {
        request.body = body;
      } else if (typeof body === 'string') {
        request.body = body;
      } else {
        headers['Content-Type'] = 'application/json';
        request.body = JSON.stringify(body);
      }
    }

    const response = await fetch(url, request);

    if (response.status === 204) {
      return null as T;
    }

    let contentType = '';
    const responseHeaders = response.headers as unknown;
    if (
      typeof responseHeaders === 'object' &&
      responseHeaders !== null &&
      'get' in (responseHeaders as { get?: unknown }) &&
      typeof (responseHeaders as { get?: unknown }).get === 'function'
    ) {
      contentType =
        (responseHeaders as { get: (name: string) => string | null }).get(
          'Content-Type'
        ) ?? '';
    } else {
      const h = responseHeaders as Record<string, string>;
      contentType = h['Content-Type'] ?? h['content-type'] ?? '';
    }
    if (!contentType.includes('application/json')) {
      throw new Error(
        `Expected JSON response but got ${contentType} response of ${response.status} ${response.statusText}`
      );
    }

    const json = (await response.json()) as APIResponse<T>;

    if (!json.success) {
      const errorCode = json.error?.code || 'UNKNOWN_ERROR';
      const errorMessage = json.error?.message || 'An unknown error occurred';
      const detail = json.detail;
      const issues = json.error?.issues;

      throw new APIError(
        response.status,
        errorCode,
        errorMessage,
        detail,
        issues
      );
    }

    return json.data as T;
  }
}

/** Query parameter, and path segment, that select config variants. */
const VARIANT_QUERY_PARAM = 'v';
const VARIANT_PATH_SEGMENT = 'v';

function collectVariants(list: string, into: string[]): void {
  for (const id of list.split(',')) {
    const trimmed = id.trim().toLowerCase();
    if (trimmed && into.indexOf(trimmed) === -1) into.push(trimmed);
  }
}

function parseQueryVariants(url: string): string[] {
  const query = url.split('#')[0].split('?')[1];
  if (!query) return [];

  const ids: string[] = [];
  for (const pair of query.split('&')) {
    const separator = pair.indexOf('=');
    if (separator === -1 || pair.slice(0, separator) !== VARIANT_QUERY_PARAM) {
      continue;
    }
    collectVariants(decodeURIComponent(pair.slice(separator + 1)), ids);
  }
  return ids;
}

// supports manifest URLs in the format of <baseUrl>/stremio/<uuid>/<encryptedPassword>[/v/<variants>]/manifest.json
function parseManifestUrl(url: string): {
  baseUrl: string;
  uuid: string;
  encryptedPassword: string;
  variants: string[];
} {
  const clean = url.trim();
  if (!clean) throw new Error('Manifest URL is required');

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(clean);
  } catch (error) {
    throw new Error(
      `Failed to parse manifest URL: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // if url is of alias format e.g <baseUrl>/stremio/u/<alias>/manifest.json
  // throw a more specific error.
  const aliasMatch = parsedUrl.pathname.match(
    /^\/stremio\/u\/([^/]+)(?:\/v\/[^/]+)?\/manifest\.json$/
  );
  if (aliasMatch) {
    const alias = aliasMatch[1];
    throw new Error(
      `Manifest URL is using alias format with alias "${alias}". Alias URLs are not supported, please use the full Manifest URL that contains your UUID. `
    );
  }

  // Expecting URL format // <baseUrl>/stremio/<uuid>/<encryptedPassword>/manifest.json
  const segments = parsedUrl.pathname.split('/').filter(Boolean);
  if (
    segments.length < 4 ||
    segments[0] !== 'stremio' ||
    segments[segments.length - 1] !== 'manifest.json'
  ) {
    throw new Error('Invalid manifest URL format');
  }

  const uuid = decodeURIComponent(segments[1]);
  const encryptedPassword = decodeURIComponent(segments[2]);
  if (!uuid || !encryptedPassword) {
    throw new Error('Manifest URL is missing uuid or password token');
  }

  const variants = parseQueryVariants(clean);
  if (segments[3] === VARIANT_PATH_SEGMENT && segments[4]) {
    collectVariants(decodeURIComponent(segments[4]), variants);
  }

  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
  return { baseUrl, uuid, encryptedPassword, variants };
}

export {
  AIOStreamsAPI,
  parseManifestUrl,
  AIOStreamsAnimeEntry,
  SearchApiResponse,
  AIOStreamsSearchApiResult,
  APIError,
  IdType,
  ParsedId,
};
