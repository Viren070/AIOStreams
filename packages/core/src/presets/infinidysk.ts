import {
  Addon,
  Option,
  ParsedStream,
  PresetMetadata,
  Stream,
  UserData,
} from '../db/index.js';
import { StreamParser } from '../parser/index.js';
import {
  appConfig,
  constants,
  createLogger,
  normaliseLanguage,
} from '../utils/index.js';
import {
  getFailoverOrderEndpoint,
  getInfiniDyskFailoverId,
  getInfiniDyskIndexer,
  getInfiniDyskInLibrary,
  getInfiniDyskMessage,
  getInfiniDyskProvidedLanguages,
  mergeInfiniDyskLanguages,
  parseInfiniDyskManifestUrl,
  reportFailoverOrder,
} from './infinidysk-helpers.js';
import { Preset } from './preset.js';

const logger = createLogger('infinidysk');

export class InfiniDyskParser extends StreamParser {
  protected override getExtras(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): ParsedStream['extra'] {
    const failoverId = getInfiniDyskFailoverId(stream);
    return failoverId ? { failoverId } : undefined;
  }

  protected override getStreamType(
    _stream: Stream,
    _service: ParsedStream['service'],
    _currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return constants.USENET_STREAM_TYPE;
  }

  protected override getService(
    _stream: Stream,
    _currentParsedStream: ParsedStream
  ): ParsedStream['service'] {
    return {
      id: constants.NZBDAV_SERVICE,
      cached: true,
    };
  }

  protected override getIndexer(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): string | undefined {
    return getInfiniDyskIndexer(stream);
  }

  protected override getInLibrary(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): boolean {
    return getInfiniDyskInLibrary(stream);
  }

  protected override getMessage(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): string | undefined {
    return getInfiniDyskMessage(stream);
  }

  protected override getLanguages(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string[] {
    return mergeInfiniDyskLanguages(
      super.getLanguages(stream, currentParsedStream),
      getInfiniDyskProvidedLanguages(stream),
      normaliseLanguage
    );
  }
}

export class InfiniDyskPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return InfiniDyskParser;
  }

  static override get METADATA(): PresetMetadata {
    const supportedServices = [constants.NZBDAV_SERVICE];
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'InfiniDysk',
      },
      {
        id: 'manifestUrl',
        name: 'Manifest URL',
        description:
          'The manifest.json URL for your InfiniDysk search profile addon.',
        type: 'url',
        required: true,
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        required: true,
        default: appConfig.presets.defaultTimeout,
        constraints: {
          min: appConfig.userLimits.timeouts.minTimeout,
          max: appConfig.userLimits.timeouts.maxTimeout,
          forceInUi: false,
        },
      },
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits this addon to the selected media types for streams. Leave empty to allow all.',
        type: 'multi-select',
        required: false,
        options: [
          { label: 'Movie', value: 'movie' },
          { label: 'Series', value: 'series' },
          { label: 'Anime', value: 'anime' },
        ],
        default: [],
        showInSimpleMode: false,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'github',
            url: 'https://github.com/infinidysk/infinidysk',
          },
        ],
      },
    ];

    return {
      ID: 'infinidysk',
      NAME: 'InfiniDysk',
      DESCRIPTION:
        'Direct Usenet streams from your self-hosted InfiniDysk search profile.',
      LOGO: 'https://raw.githubusercontent.com/infinidysk/infinidysk/main/docs/assets/logo.png',
      URL: [],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: supportedServices,
      SUPPORTED_RESOURCES: supportedResources,
      SUPPORTED_STREAM_TYPES: [constants.USENET_STREAM_TYPE],
      CATEGORY: constants.PresetCategory.STREAMS,
      OPTIONS: options,
    };
  }

  static override async generateAddons(
    userData: UserData,
    options: Record<string, unknown>
  ): Promise<Addon[]> {
    parseInfiniDyskManifestUrl(options.name, options.manifestUrl);
    return [this.generateAddon(userData, options)];
  }

  static override onStreamsReady(streams: ParsedStream[]): void {
    const byManifest = new Map<string, ParsedStream[]>();
    for (const stream of streams) {
      const manifestUrl = stream.addon.manifestUrl;
      if (!manifestUrl) continue;
      const list = byManifest.get(manifestUrl) ?? [];
      list.push(stream);
      byManifest.set(manifestUrl, list);
    }

    for (const [manifestUrl, list] of byManifest) {
      const endpoint = getFailoverOrderEndpoint(manifestUrl);
      if (!endpoint) {
        logger.debug(
          'Skipped InfiniDysk failover reporting for an invalid manifest'
        );
        continue;
      }
      reportFailoverOrder(list, endpoint, this.METADATA.USER_AGENT, {
        onFailure: () => {
          logger.debug('Failed to report InfiniDysk failover order');
        },
      });
    }
  }

  private static generateAddon(
    _userData: UserData,
    options: Record<string, unknown>
  ): Addon {
    return {
      name:
        (typeof options.name === 'string' && options.name) ||
        this.METADATA.NAME,
      manifestUrl:
        (typeof options.manifestUrl === 'string' && options.manifestUrl) || '',
      enabled: true,
      mediaTypes: (options.mediaTypes as Addon['mediaTypes']) || [],
      resources:
        (options.resources as Addon['resources']) ||
        this.METADATA.SUPPORTED_RESOURCES,
      timeout: (options.timeout as number) || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options,
      },
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }
}
