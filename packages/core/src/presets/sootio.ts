import {
  Addon,
  Option,
  UserData,
  Resource,
  Stream,
  ParsedStream,
} from '../db/index.js';
import { baseOptions, Preset } from './preset.js';
import { createLogger, Env, getSimpleTextHash } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';

class SootioStreamParser extends StreamParser {
  protected override getInLibrary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): boolean {
    return stream.description?.includes('[Cloud]') ?? false;
  }
  protected override getIndexer(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return /[☁️💾][^|]*\|\s*(.*)$/s.exec(stream.description || '')?.[1];
  }
}

export class SootioPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return SootioStreamParser;
  }

  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.TORBOX_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.ALLDEBRID_SERVICE,
      constants.OFFCLOUD_SERVICE,
      constants.DEBRIDER_SERVICE,
      constants.EASYNEWS_SERVICE,
    ];

    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.CATALOG_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Sootio',
        supportedResources,
        Env.DEFAULT_SOOTIO_TIMEOUT,
        Env.SOOTIO_URL
      ),
      {
        id: 'httpProviders',
        name: 'HTTP Stream Providers',
        description: 'The HTTP stream providers to use for the addon.',
        type: 'multi-select',
        options: [
          { label: '4KHDHub', value: 'http4khdhub' },
          { label: 'HDHub4u', value: 'httpHDHub4u' },
          { label: 'UHDMovies', value: 'httpUHDMovies' },
          { label: 'MoviesDrive', value: 'httpMoviesDrive' },
          { label: 'MKVCinemas', value: 'httpMKVCinemas' },
          { label: 'MKVDrama', value: 'httpMkvDrama' },
          { label: 'MalluMv', value: 'httpMalluMv' },
          { label: 'CineDoze', value: 'httpCineDoze' },
          { label: 'VixSrc (HLS)', value: 'httpVixSrc' },
          { label: 'NetflixMirror (HLS)', value: 'httpNetflixMirror' },
        ],
        default: [],
      },
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: supportedServices.map((service) => ({
          value: service,
          label: constants.SERVICE_DETAILS[service].name,
        })),
        default: undefined,
        emptyIsUndefined: true,
      },
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: [
          { label: 'Movie', value: 'movie' },
          { label: 'Series', value: 'series' },
          { label: 'Anime', value: 'anime' },
        ],
        default: [],
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'Sootio supports multiple services in one instance of the addon - which is used by default. If this is enabled, then the addon will be created for each service.',
        type: 'boolean',
        required: false,
        showInSimpleMode: false,
        default: false,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'github',
            url: 'https://github.com/sooti/stremio-addon-debrid-search',
          },
        ],
      },
    ];

    return {
      ID: 'sootio',
      NAME: 'Sootio',
      LOGO: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cdefs%3E%3ClinearGradient id='grad' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%2364ffda;stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:%2300A7B5;stop-opacity:1' /%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath fill='url(%23grad)' d='M50,5 C74.85,5 95,25.15 95,50 C95,74.85 74.85,95 50,95 C35,95 22.33,87.6 15,76 C25,85 40,85 50,80 C60,75 65,65 65,50 C65,35 55,25 40,25 C25,25 15,40 15,50 C15,55 16,60 18,64 C8.5,58 5,45 5,50 C5,25.15 25.15,5 50,5 Z'/%3E%3C/svg%3E`,
      URL: Env.SOOTIO_URL[0],
      TIMEOUT: Env.DEFAULT_SOOTIO_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_SOOTIO_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION: 'Debrid addon.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.DEBRID_STREAM_TYPE,
        constants.HTTP_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    if (options?.url?.endsWith('/manifest.json')) {
      return [this.generateAddon(userData, options, undefined)];
    }

    const usableServices = this.getUsableServices(userData, options.services);

    if (
      (!options.httpProviders || options.httpProviders.length === 0) &&
      (!usableServices || usableServices.length === 0)
    ) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one usable service or HTTP stream provider, but none were found. Please enable at least one of the following services or HTTP stream providers: ${this.METADATA.SUPPORTED_SERVICES.join(
          ', '
        )}`
      );
    }

    if (
      options.useMultipleInstances &&
      usableServices &&
      usableServices.length > 0
    ) {
      let httpProvidersAdded: boolean = false;
      return usableServices.map((service) => {
        const newOptions = { ...options, httpProviders: [] };
        if (options.httpProviders && !httpProvidersAdded) {
          newOptions.httpProviders = options.httpProviders;
          httpProvidersAdded = true;
        }
        return this.generateAddon(userData, newOptions, [service.id]);
      });
    }

    return [
      this.generateAddon(
        userData,
        options,
        usableServices?.map((service) => service.id)
      ),
    ];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    serviceIds?: ServiceId[]
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      identifier:
        serviceIds && serviceIds.length > 1
          ? 'multi'
          : serviceIds && serviceIds.length > 0
            ? constants.SERVICE_DETAILS[serviceIds[0]].shortName
            : undefined,
      displayIdentifier:
        serviceIds && serviceIds.length > 0
          ? serviceIds
              .map((id) => constants.SERVICE_DETAILS[id].shortName)
              .join(' | ') +
            (options.httpProviders && options.httpProviders.length > 0
              ? ` | HTTP`
              : '')
          : options.httpProviders && options.httpProviders.length > 0
            ? `HTTP`
            : undefined,
      manifestUrl: this.generateManifestUrl(userData, options, serviceIds),
      enabled: true,
      mediaTypes: options.mediaTypes || [],
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

  private static generateManifestUrl(
    userData: UserData,
    options: Record<string, any>,
    serviceIds?: ServiceId[]
  ) {
    const url = (options.url || this.METADATA.URL).replace(/\/$/, '');
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    if (
      !serviceIds?.length &&
      (!options.httpProviders || options.httpProviders.length === 0)
    ) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one usable service, but none were found. Please enable at least one of the following services: ${this.METADATA.SUPPORTED_SERVICES.join(
          ', '
        )}`
      );
    }

    const serviceNameMap: Partial<Record<ServiceId, string>> = {
      realdebrid: 'RealDebrid',
      offcloud: 'OffCloud',
      torbox: 'TorBox',
      alldebrid: 'AllDebrid',
      debrider: 'DebriderApp',
      premiumize: 'Premiumize',
      easynews: 'Easynews',
    };

    const debridProviders = (serviceIds || []).map((id) => {
      if (id === constants.EASYNEWS_SERVICE) {
        const credential = this.getServiceCredential(id, userData);
        return {
          provider: serviceNameMap[id],
          username: credential.username,
          password: credential.password,
        };
      } else {
        return {
          provider: serviceNameMap[id],
          apiKey: this.getServiceCredential(id, userData),
        };
      }
    });

    const httpProviders =
      options.httpProviders && options.httpProviders.length > 0
        ? {
            provider: 'httpstreaming',
            http4khdhub: options.httpProviders.includes('http4khdhub'),
            httpHDHub4u: options.httpProviders.includes('httpHDHub4u'),
            httpUHDMovies: options.httpProviders.includes('httpUHDMovies'),
            httpMoviesDrive: options.httpProviders.includes('httpMoviesDrive'),
            httpMKVCinemas: options.httpProviders.includes('httpMKVCinemas'),
            httpMkvDrama: options.httpProviders.includes('httpMkvDrama'),
            httpMalluMv: options.httpProviders.includes('httpMalluMv'),
            httpCineDoze: options.httpProviders.includes('httpCineDoze'),
            httpVixSrc: options.httpProviders.includes('httpVixSrc'),
            httpNetflixMirror:
              options.httpProviders.includes('httpNetflixMirror'),
          }
        : undefined;

    const finalProviders = httpProviders
      ? [httpProviders, ...debridProviders]
      : debridProviders;

    const config = {
      DebridProvider:
        serviceIds && serviceIds.length > 0
          ? serviceNameMap[serviceIds[0]]
          : 'httpstreaming',
      DebridApiKey:
        serviceIds && serviceIds.length > 0
          ? this.getServiceCredential(serviceIds[0], userData)
          : undefined,
      DebridServices: finalProviders,
      ShowCatalog: true,
      Languages: [],
    };

    return `${url}/${this.urlEncodeJSON(config)}/manifest.json`;
  }
}
