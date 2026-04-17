import {
  Addon,
  Option,
  UserData,
  Resource,
  ParsedStream,
  Stream,
  ParsedFile,
} from '../db/index.js';
import { baseOptions, Preset } from './preset.js';
import { Env } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';

class MeteorStreamParser extends StreamParser {
  protected getInLibrary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): boolean {
    return stream.name?.includes('📫') ?? false;
  }

  protected getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    const type = super.getStreamType(stream, service, currentParsedStream);
    if (currentParsedStream.indexer?.startsWith('Usenet')) {
      currentParsedStream.indexer = currentParsedStream.indexer
        .replace('Usenet:', '')
        .trim();
      return constants.USENET_STREAM_TYPE;
    }
    return type;
  }

  protected getParsedFileMergeOverrides(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): Partial<ParsedFile> {
    const overrides: Partial<ParsedFile> = {};

    // Matches one or more flag emojis (each is two regional indicator chars) after an indicator emoji
    const getFlagRegex = (indicator: string) =>
      new RegExp(`${indicator}\\s*((?:[\\u{1F1E6}-\\u{1F1FF}]{2}\\s*)+)`, 'u');
    const audioRegex = getFlagRegex('🌐');
    const subtitleRegex = getFlagRegex('💬');

    const audioMatch = stream.description?.match(audioRegex);
    const subtitleMatch = stream.description?.match(subtitleRegex);

    if (audioMatch) {
      const audioLangs = audioMatch[1]
        .split(' ')
        .map((part) => this.convertFlagToLanguage(part.trim()))
        .filter((lang) => lang !== undefined) as string[];
      if (audioLangs.length > 0) {
        overrides.languages = audioLangs;
      }
    }

    if (subtitleMatch) {
      const subtitleLangs = subtitleMatch[1]
        .split(' ')
        .map((part) => this.convertFlagToLanguage(part.trim()))
        .filter((lang) => lang !== undefined) as string[];
      if (subtitleLangs.length > 0) {
        overrides.subtitles = subtitleLangs;
      }
    }

    return overrides;
  }
}

export class MeteorPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return MeteorStreamParser;
  }
  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.ALLDEBRID_SERVICE,
      constants.TORBOX_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.DEBRIDLINK_SERVICE,
      constants.DEBRIDER_SERVICE,
      constants.EASYDEBRID_SERVICE,
      constants.OFFCLOUD_SERVICE,
    ];

    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.META_RESOURCE,
      constants.CATALOG_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Meteor',
        supportedResources,
        Env.DEFAULT_METEOR_TIMEOUT,
        Env.METEOR_URL
      ),
      {
        id: 'services',
        name: 'Services',
        showInSimpleMode: false,
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
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
        id: 'yourMedia',
        type: 'subsection',
        subsectionIntent: 'pill',
        name: 'Your Media',
        description: '',
        showInSimpleMode: false,
        subOptions: [
          {
            id: 'enabled',
            name: 'Enabled',
            description:
              'Show media you already have in your library via catalogs',
            type: 'boolean',
            default: false,
          },
          {
            id: 'legacyMode',
            name: 'Legacy Mode',
            description:
              'Meteor will match items in your catalogs to movies/shows and combine duplicate entries together. Enable this to disable this behaviour, this removes covers, descriptions, and other metadata from the results,  use this if you encounter issues with items not being matched correctly, or if you simply prefer no metadata',
            type: 'boolean',
            default: false,
          },
          {
            id: 'sources',
            name: 'Sources',
            description:
              'The types of content to use as sources for Your Media  results',
            type: 'multi-select',
            options: [
              { label: 'Torrents', value: 'torrent' },
              { label: 'WebDLs', value: 'webdl' },
              { label: 'Usenet', value: 'usenet' },
            ],
            default: ['torrent'],
          },
          {
            id: 'showStreams',
            name: 'Show Streams',
            description:
              'Show streams for media you already have in your library together with regular search results.',
            type: 'boolean',
            default: false,
          },
        ],
      },
      {
        id: 'usenet',
        type: 'subsection',
        subsectionIntent: 'pill',
        name: 'Usenet',
        description: '',
        showInSimpleMode: false,
        subOptions: [
          {
            id: 'usenetAlerts',
            name: 'TorBox Pro Only',
            description: 'Requires TorBox Pro subscription',
            type: 'alert',
            intent: 'info',
          },
          {
            id: 'enabled',
            name: 'Enabled',
            description: 'Enable Usenet results',
            type: 'boolean',
            default: false,
          },
          {
            id: 'customSearchEngines',
            name: 'Custom Search Engines',
            description:
              'Enable the use of custom user search engines that you have added to your TorBox account',
            type: 'boolean',
            default: false,
            showInSimpleMode: false,
          },
        ],
      },
      {
        id: 'includeP2P',
        name: 'Include P2P',
        description: 'Include P2P results, even if a debrid service is enabled',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'removeTrash',
        name: 'Remove Trash',
        description: 'Remove trash from results',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'When using multiple services, use a different Meteor addon for each service, rather than using one instance for all services',
        type: 'boolean',
        default: false,
        required: false,
        showInSimpleMode: false,
      },
    ];

    return {
      ID: 'meteor',
      NAME: 'Meteor',
      LOGO: `https://meteorfortheweebs.midnightignite.me/static/icon.png`,
      URL: Env.METEOR_URL[0],
      TIMEOUT: Env.DEFAULT_METEOR_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_METEOR_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION: 'Meteor is a Stremio addon for torrent and debrid streaming',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.P2P_STREAM_TYPE,
        constants.DEBRID_STREAM_TYPE,
        constants.USENET_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    if (options?.url?.endsWith('/manifest.json')) {
      return [this.generateAddon(userData, options, [])];
    }

    const usableServices = this.getUsableServices(userData, options.services);
    if (!usableServices || usableServices.length === 0) {
      return [this.generateAddon(userData, options, [])];
    }

    const additionalP2pAddon =
      options.includeP2P && usableServices.length > 0
        ? this.generateAddon(userData, options, [])
        : null;

    let addons: Addon[] = [];

    if (options.useMultipleInstances) {
      const instanceOptions = { ...options, includeP2P: false };
      usableServices.forEach((service) => {
        addons.push(
          this.generateAddon(userData, instanceOptions, [service.id])
        );
      });
    } else {
      addons.push(
        this.generateAddon(
          userData,
          options,
          usableServices.map((s) => s.id)
        )
      );
    }

    if (additionalP2pAddon) {
      addons.push(additionalP2pAddon);
    }

    return addons;
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    services: ServiceId[]
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      displayIdentifier: services
        .map((id) => constants.SERVICE_DETAILS[id].shortName)
        .join(' | '),
      identifier:
        services.length > 0
          ? services.length > 1
            ? 'multi'
            : constants.SERVICE_DETAILS[services[0]].shortName
          : options.url?.endsWith('/manifest.json')
            ? undefined
            : 'p2p',
      manifestUrl: this.generateManifestUrl(userData, options, services),
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
    services: ServiceId[]
  ) {
    let url = options.url || this.METADATA.URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    url = url.replace(/\/$/, '');

    const debridServices: { service: string; apiKey: string }[] = services.map(
      (serviceId) => ({
        service: serviceId,
        apiKey: this.getServiceCredential(serviceId, userData),
      })
    );

    if (services.length === 0) {
      debridServices.push({ service: 'torrent', apiKey: '' });
    }

    const configString = this.base64EncodeJSON(
      {
        debridService:
          debridServices.length === 1 ? debridServices[0].service : undefined,
        debridApiKey:
          debridServices.length === 1 ? debridServices[0].apiKey : undefined,
        debridServices: debridServices.length > 1 ? debridServices : undefined,
        cachedOnly: false,
        removeTrash: options.removeTrash ?? false,
        enableYourMedia: options.yourMedia?.enabled ?? false,
        yourMediaLegacyMode: options.yourMedia?.legacyMode ?? false,
        showYourMediaStreams: options.yourMedia?.showStreams ?? false,
        yourMediaSources: options.yourMedia?.sources ?? ['torrent'],
        enableUsenet: options.usenet?.enabled ?? false,
        usenetCustomEngines: options.usenet?.customSearchEngines ?? false,
        removeSamples: false,
        removeAdult: false,
        exclude3D: false,
        enableSeaDex: false,
        minSeeders: 0,
        maxResults: 0,
        maxResultsPerRes: 0,
        maxSize: 0,
        resolutions: [],
        languages: { preferred: [], required: [], exclude: [] },
        resultFormat: [
          'title',
          'quality',
          'size',
          'audio',
          'seeders',
          'source',
          'sublang',
          'audiolang',
        ],
        sortOrder: [
          'pack',
          'cached',
          'seadex',
          'resolution',
          'size',
          'quality',
          'seeders',
          'language',
        ],
      },
      'urlSafe'
    );

    return `${url}/${configString}/manifest.json`;
  }
}
