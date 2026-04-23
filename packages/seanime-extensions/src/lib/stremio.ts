type StremioMethod = 'GET';

type StremioEndpoint = `${StremioMethod} /${string}` | `/${string}`;

type StremioRequestOptions = Omit<RequestInit, 'body' | 'method'> & {
  body?: Record<string, unknown> | FormData | string;
  query?: Record<
    string,
    string | number | boolean | string[] | number[] | boolean[] | undefined
  >;
};

export interface ManifestResource {
  name: string;
  types: string[];
  idPrefixes?: string[] | null;
}

export interface ManifestExtra {
  name: string;
  isRequired?: boolean;
  options?: Array<string | null> | null;
  optionsLimit?: number;
}

export interface ManifestCatalog {
  type: string;
  id: string;
  name: string;
  extra?: ManifestExtra[];
  [key: string]: unknown;
}

export interface AddonCatalogDefinition {
  type: string;
  id: string;
  name: string;
}

export interface Manifest {
  id: string;
  name: string;
  description?: string;
  version: string;
  types: string[];
  idPrefixes?: string[] | null;
  resources: Array<string | ManifestResource>;
  catalogs?: ManifestCatalog[];
  addonCatalogs?: AddonCatalogDefinition[];
  background?: string | null;
  logo?: string | null;
  contactEmail?: string | null;
  behaviorHints?: {
    adult?: boolean;
    p2p?: boolean;
    configurable?: boolean;
    configurationRequired?: boolean;
  };
  stremioAddonsConfig?: {
    issuer: string;
    signature: string;
  };
  [key: string]: unknown;
}

export interface Subtitle {
  id: string;
  url: string;
  lang: string;
  [key: string]: unknown;
}

export interface SubtitleResponse {
  subtitles: Subtitle[];
}

export interface Source {
  url: string;
  bytes?: number | null;
}

export interface Stream {
  url?: string | null;
  nzbUrl?: string | null;
  servers?: string[] | null;
  rarUrls?: Source[] | null;
  zipUrls?: Source[] | null;
  '7zipUrls'?: Source[] | null;
  tgzUrls?: Source[] | null;
  tarUrls?: Source[] | null;
  ytId?: string | null;
  infoHash?: string | null;
  fileIdx?: number | null;
  externalUrl?: string | null;
  name?: string | null;
  title?: string | null;
  description?: string | null;
  subtitles?: Subtitle[] | null;
  sources?: string[] | null;
  behaviorHints?: {
    countryWhitelist?: string[] | null;
    notWebReady?: boolean | null;
    bingeGroup?: string | null;
    proxyHeaders?: {
      request?: Record<string, string>;
      response?: Record<string, string>;
    };
    videoHash?: string | null;
    videoSize?: number | null;
    filename?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface StreamResponse {
  streams: Stream[];
}

export interface Trailer {
  source: string;
  type: 'Trailer' | 'Clip' | 'Teaser';
  [key: string]: unknown;
}

export interface MetaLink {
  name: string;
  category: string;
  url: string;
  [key: string]: unknown;
}

export interface MetaVideo {
  id: string;
  title?: string | null;
  name?: string | null;
  released?: string | null;
  thumbnail?: string | null;
  streams?: Stream[] | null;
  available?: boolean | null;
  episode?: number | null;
  season?: number | null;
  trailers?: Trailer[] | null;
  overview?: string | null;
  [key: string]: unknown;
}

export interface MetaPreview {
  id: string;
  imdb_id?: string;
  type: string;
  name?: string | null;
  poster?: string | null;
  posterShape?: 'square' | 'poster' | 'landscape' | 'regular';
  genres?: string[] | null;
  imdbRating?: string | number | null;
  releaseInfo?: string | number | null;
  director?: Array<string | null> | string | null;
  cast?: string[] | null;
  description?: string | null;
  trailers?: Trailer[] | null;
  links?: MetaLink[] | null;
  [key: string]: unknown;
}

export interface Meta extends MetaPreview {
  background?: string | null;
  logo?: string | null;
  videos?: MetaVideo[] | null;
  runtime?: string | null;
  language?: string | null;
  country?: string | null;
  awards?: string | null;
  website?: string | null;
  behaviorHints?: {
    defaultVideoId?: string | null;
    hasScheduledVideo?: boolean | null;
    [key: string]: unknown;
  };
}

export interface MetaResponse {
  meta: Meta;
}

export interface CatalogResponse {
  metas: MetaPreview[];
}

export interface AddonCatalog {
  transportName: 'http';
  transportUrl: string;
  manifest: Manifest;
  [key: string]: unknown;
}

export interface AddonCatalogResponse {
  addons: AddonCatalog[];
}

export interface Extras {
  skip?: number;
  genre?: string;
  search?: string;
  filename?: string;
  videoHash?: string;
  videoSize?: number;
  [key: string]: string | number | boolean | undefined;
}

export class Stremio {
  private readonly baseUrl: string;

  constructor(manifestUrl: string) {
    this.baseUrl = this.getBaseUrl(manifestUrl);
  }

  /**
   * Fetches metadata for a specific type and ID. This would be the same `id` and `type`
   * that appears in the MetaPreview item in a catalog response.
   *
   * @param type The type of the media (e.g., "anime", "movie").
   * @param id The unique identifier of the media.
   * @returns A promise that resolves to the metadata response.
   */
  async getMeta(type: string, id: string): Promise<MetaResponse> {
    return this.request<MetaResponse>(
      `/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`
    );
  }

  /**
   * Fetches a catalog for a specific type and ID. The `id` and `type` can be anything,
   * They can be obtained from the Manifest's `catalogs` field,
   *
   * @param type The type of the media (e.g., "anime", "movie").
   * @param id The unique identifier of the catalog.
   * @param extras Additional parameters for the catalog request.
   * @returns A promise that resolves to the catalog response.
   */
  async getCatalog(
    type: string,
    id: string,
    extras?: Extras
  ): Promise<CatalogResponse> {
    const extrasSegment = this.toExtrasSegment(extras);
    const suffix = extrasSegment ? `/${extrasSegment}` : '';

    return this.request<CatalogResponse>(
      `/catalog/${encodeURIComponent(type)}/${encodeURIComponent(id)}${suffix}.json`
    );
  }

  async getStreams(type: string, id: string): Promise<StreamResponse> {
    return this.request<StreamResponse>(
      `/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`
    );
  }

  async getSubtitles(
    type: string,
    id: string,
    extras: Extras
  ): Promise<SubtitleResponse> {
    const extrasSegment = this.toExtrasSegment(extras);
    const suffix = extrasSegment ? `/${extrasSegment}` : '';

    return this.request<SubtitleResponse>(
      `/subtitles/${encodeURIComponent(type)}/${encodeURIComponent(id)}${suffix}.json`
    );
  }

  async getAddonCatalog(
    type: string,
    id: string
  ): Promise<AddonCatalogResponse> {
    return this.request<AddonCatalogResponse>(
      `/addon_catalog/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`
    );
  }

  async getManifest(): Promise<Manifest> {
    return this.request<Manifest>('GET /manifest.json');
  }

  private getBaseUrl(manifestUrl: string): string {
    const clean = manifestUrl.trim().replace(/\/$/, '');

    if (clean.endsWith('/manifest.json')) {
      return clean.slice(0, -'/manifest.json'.length);
    }

    return clean;
  }

  private toExtrasSegment(extras?: Extras): string {
    if (!extras) return '';

    const parts: string[] = [];
    for (const [key, value] of Object.entries(extras)) {
      if (value === undefined || value === null) continue;
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
      );
    }

    return parts.join('&');
  }

  private async request<T>(
    endpoint: StremioEndpoint,
    options: StremioRequestOptions = {}
  ): Promise<T> {
    const { body, query, ...fetchOptions } = options;

    const [method, path] = endpoint.includes(' /')
      ? (endpoint.split(' /') as [StremioMethod, string])
      : (['GET', endpoint.slice(1)] as [StremioMethod, string]);

    const queryString = this.toQueryString(query);
    const url = `${this.baseUrl}/${path}${queryString}`;

    const headers: Record<string, string> = {
      ...((fetchOptions.headers as Record<string, string> | undefined) ?? {}),
    };

    const request: RequestInit = {
      method,
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

    if (!response.ok) {
      throw new Error(
        `Request failed: ${response.status} ${response.statusText}`
      );
    }

    if (response.status === 204) {
      return null as T;
    }

    return (await response.json()) as T;
  }

  private toQueryString(query?: StremioRequestOptions['query']): string {
    if (!query) return '';

    const parts: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      const encodedKey = encodeURIComponent(key);

      if (Array.isArray(value)) {
        value.forEach((entry) => {
          parts.push(`${encodedKey}=${encodeURIComponent(String(entry))}`);
        });
      } else if (value !== undefined) {
        parts.push(`${encodedKey}=${encodeURIComponent(String(value))}`);
      }
    }

    return parts.length > 0 ? `?${parts.join('&')}` : '';
  }
}
