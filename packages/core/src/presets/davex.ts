import { Preset } from './preset.js';
import {
  constants,
  appConfig,
  createLogger,
  makeRequest,
} from '../utils/index.js';
import {
  PresetMetadata,
  Option,
  Addon,
  UserData,
  ParsedStream,
  Stream,
} from '../db/index.js';
import { StreamParser } from '../parser/index.js';

const logger = createLogger('davex');

const FAILOVER_ORDER_PATH = '/failover_order';

export class DavexParser extends StreamParser {
  protected override getExtras(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): ParsedStream['extra'] {
    const failoverId = (stream as Stream & { failoverId?: string }).failoverId;
    if (failoverId == null) return undefined;
    return { failoverId };
  }

  protected override getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return constants.USENET_STREAM_TYPE;
  }

  protected getService(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['service'] | undefined {
    return {
      id: constants.NZBDAV_SERVICE,
      cached: true,
    };
  }

  protected getIndexer(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return (stream as any).meta?.indexer;
  }

  // NOTE: davex's adapter does not currently emit library ("already added") or
  // health markers in the stream output
}

export class DavexPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return DavexParser;
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
        default: 'davex',
      },
      {
        id: 'manifestUrl',
        name: 'Manifest URL',
        description:
          'The URL to the manifest.json for your davex search profile addon adapter. e.g. https://davex.example.com/adapters/addon/<token>/manifest.json',
        type: 'string',
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
          forceInUi: false, // large ranges don't work well
        },
      },
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
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
            url: 'https://github.com/qooode/nzbdavex',
          },
        ],
      },
    ];

    return {
      ID: 'davex',
      NAME: 'davex',
      DESCRIPTION:
        'Usenet streams from your davex search profile addon adapter.',
      LOGO: `https://raw.githubusercontent.com/qooode/nzbdavex/main/frontend/public/logo.png`,
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

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    let manifestUrl = options.manifestUrl;
    try {
      manifestUrl = new URL(manifestUrl);
    } catch (error) {
      throw new Error(
        `${options.name} has an invalid Manifest URL. It must be a valid link to a manifest.json`
      );
    }
    if (!manifestUrl.pathname.endsWith('/manifest.json')) {
      throw new Error(
        `${options.name} has an invalid Manifest URL. It must be a valid link to a manifest.json`
      );
    }
    return [this.generateAddon(userData, options)];
  }

  static override onStreamsReady(streams: ParsedStream[]): void {
    if (streams.length === 0) return;
    const byManifest = new Map<string, ParsedStream[]>();
    for (const s of streams) {
      const key = s.addon.manifestUrl ?? '';
      const list = byManifest.get(key) ?? [];
      list.push(s);
      byManifest.set(key, list);
    }
    for (const [, list] of byManifest) {
      const baseUrl =
        (list[0].addon.preset.options?.manifestUrl as string)
          ?.replace(/\/manifest\.json.*$/i, '')
          ?.replace(/\/+$/, '') ??
        (() => {
          const u = new URL(list[0].addon.manifestUrl ?? '');
          u.pathname = u.pathname.replace(/\/manifest\.json$/i, '') || '/';
          return u.toString().replace(/\/+$/, '');
        })();
      this.reportFailoverOrder(list, baseUrl);
    }
  }

  private static reportFailoverOrder(
    streams: ParsedStream[],
    baseUrl: string
  ): void {
    if (streams.length === 0) return;
    const url = `${baseUrl.replace(/\/+$/, '')}${FAILOVER_ORDER_PATH}`;
    const body = {
      streams: streams.map((s) => ({
        name: s.filename ?? s.originalName,
        failoverId:
          (typeof s.extra?.failoverId === 'string'
            ? s.extra.failoverId
            : undefined) ?? s.id,
      })),
    };
    logger.debug({ body, url }, `reporting failover order to davex`);
    makeRequest(url, {
      method: 'POST',
      timeout: 5000,
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': this.METADATA.USER_AGENT,
      },
    }).catch((err) => {
      logger.debug({ err, url }, `failed to report failover order to davex`);
    });
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: options.manifestUrl || '',
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
}
