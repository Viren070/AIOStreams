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
import { constants, normaliseLanguage, ServiceId } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import {
  StreamParser,
  FileParser,
  getLanguagesAfterMarker,
  getRegexForTextAfterEmojis,
} from '../parser/index.js';
import { arrayMerge } from '../parser/merge.js';

// Meteor-only tokens (`lat` is Latin in ISO 639-2, not Latino).
const LANGUAGE_ALIASES: Record<string, string> = {
  dual: 'Dual Audio',
  dub: 'Dubbed',
  lat: 'Latino',
};

/** Text after `marker` on its line, e.g. `2160p | remux` after `📺`. */
function lineAfter(
  description: string | null | undefined,
  marker: string
): string {
  return (
    description?.match(getRegexForTextAfterEmojis([marker]))?.[1]?.trim() ?? ''
  );
}

/** Lower-case codes after `marker`, e.g. `['en', 'ja', 'dual']` after `🌐`. */
function codesAfter(
  description: string | null | undefined,
  marker: string
): string[] {
  return lineAfter(description, marker)
    .toLowerCase()
    .split(/[\s,]+/);
}

/** Languages after `marker`: codes, or flags on self-configured URLs. */
function languagesAfter(
  description: string | null | undefined,
  marker: string
): string[] {
  const flags = getLanguagesAfterMarker(description, marker);
  if (flags?.length) return flags;
  const languages = codesAfter(description, marker).map(
    (code) => LANGUAGE_ALIASES[code] ?? normaliseLanguage(code)
  );
  return [...new Set(languages)].filter((l): l is string => !!l);
}

class MeteorStreamParser extends StreamParser {
  protected get indexerEmojis(): string[] {
    return ['🔗'];
  }

  protected getInLibrary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): boolean {
    return stream.name?.includes('📫') ?? false;
  }

  // Meteor's "no results" placeholder, not a stream.
  protected override shouldSkip(stream: Stream): boolean {
    return stream.externalUrl?.includes('/status/video/no_results') ?? false;
  }

  protected override getTorrentFile(stream: Stream): string | undefined {
    return stream.behaviorHints?.filename ?? undefined;
  }

  // Merged with the filename's, as Meteor may only guess them.
  protected override getLanguages(stream: Stream): string[] {
    return languagesAfter(stream.description, '🌐');
  }

  // Merge in the 📺 video and 🔊 audio lines; the filename wins on scalars.
  protected override getParsedFile(
    stream: Stream,
    parsedStream: ParsedStream
  ): ParsedFile | undefined {
    const parsedFile = super.getParsedFile(stream, parsedStream);
    const specs = [
      lineAfter(stream.description, '📺'),
      lineAfter(stream.description, '🔊'),
    ]
      .join(' ')
      .trim();
    if (!parsedFile || !specs) return parsedFile;

    const parsedSpecs = FileParser.parse(specs);
    parsedFile.resolution ||= parsedSpecs.resolution;
    parsedFile.quality ||= parsedSpecs.quality;
    parsedFile.encode ||= parsedSpecs.encode;
    parsedFile.visualTags = arrayMerge(
      parsedFile.visualTags,
      parsedSpecs.visualTags
    );
    parsedFile.audioTags = arrayMerge(
      parsedFile.audioTags,
      parsedSpecs.audioTags
    );
    parsedFile.audioChannels = arrayMerge(
      parsedFile.audioChannels,
      parsedSpecs.audioChannels
    );
    return parsedFile;
  }

  protected getParsedFileMergeOverrides(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): Partial<ParsedFile> {
    const overrides: Partial<ParsedFile> = {};

    const audioCodes = codesAfter(stream.description, '🌐');
    if (audioCodes.includes('dub')) overrides.dubbed = true;
    if (audioCodes.includes('sub')) overrides.subbed = true;

    const audioLangs = languagesAfter(stream.description, '🌐');
    const subtitleLangs = languagesAfter(stream.description, '💬');
    if (subtitleLangs.length > 0) overrides.subtitles = subtitleLangs;
    if (audioLangs.length > 0 || subtitleLangs.length > 0) {
      overrides.mediaInfoQuality = 'addon';
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
      constants.TORRIN_SERVICE,
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
        appConfig.presets.meteor.defaultTimeout ??
          appConfig.presets.defaultTimeout,
        appConfig.presets.meteor.url ?? undefined
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
      URL: appConfig.presets.meteor.url,
      TIMEOUT:
        appConfig.presets.meteor.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.meteor.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION: 'Meteor is a Stremio addon for torrent and debrid streaming',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.P2P_STREAM_TYPE,
        constants.DEBRID_STREAM_TYPE,
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

    const usableServices = this.getUsableServices(
      userData,
      options.services,
      options.name
    );
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
    let url = options.url || this.DEFAULT_URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    url = url.replace(/\/$/, '');

    const debridServices = services.map((serviceId) => ({
      name: serviceId,
      apiKey: this.getServiceCredential(serviceId, userData),
    }));

    const configString = this.base64EncodeJSON(
      {
        services: debridServices.length > 0 ? debridServices : undefined,
        allowP2P: debridServices.length === 0,
        cachedOnly: false,
        skipReleaseFilter: true,
        removeTrash: options.removeTrash ?? false,
        removeSamples: false,
        allowAdult: true,
        exclude3D: false,
        enableSeaDex: false,
        showYourMedia: options.yourMedia?.enabled ?? false,
        hideYourMediaStreams: !options.yourMedia?.showStreams,
        yourMediaSources: options.yourMedia?.sources ?? ['torrent'],
        yourMediaLegacyMode: options.yourMedia?.legacyMode ?? false,
        minSeeders: 0,
        maxResults: 0,
        maxPerResolution: 0,
        resolutions: [],
        preferredLangs: [],
        languages: [],
        excludedLangs: [],
        excludedSources: [],
        // MeteorStreamParser reads these lines in this format
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
        languageFormat: 'codes',
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
