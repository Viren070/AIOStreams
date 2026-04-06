import { Addon, Option, UserData, ParsedStream, Stream } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { StreamParser } from '../parser/index.js';
import { Env, createLogger, makeRequest } from '../utils/index.js';
import { constants } from '../utils/index.js';

const logger = createLogger('streamnzb');

const FAILOVER_ORDER_PATH = '/failover_order';

class StreamNZBStreamParser extends StreamParser {
  protected override getExtras(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): ParsedStream['extra'] {
    const failoverId = (stream as Stream & { failoverId?: string }).failoverId;
    if (failoverId == null) return undefined;
    return { failoverId };
  }

  protected getMessage(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): string | undefined {
    const cached = (stream.behaviorHints as { cached?: boolean } | undefined)
      ?.cached;
    if (cached === true) return 'AvailNZB 💚';
  }

  protected override getService(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['service'] | undefined {
    const base = super.getService(stream, currentParsedStream);
    return base
      ? { ...base, cached: true }
      : { id: constants.STREMIO_NNTP_SERVICE, cached: true };
  }

  protected getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return 'usenet';
  }
}

export class StreamNZBPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return StreamNZBStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      ...baseOptions(
        'StreamNZB',
        supportedResources,
        Env.DEFAULT_TIMEOUT
      ).filter((option) => option.id !== 'url'),
      {
        id: 'url',
        name: 'Manifest URL',
        description: 'Manifest URL to your StreamNZB instance',
        type: 'url',
        required: true,
      },
      {
        id: 'socials',
        type: 'socials',
        name: '',
        description: '',
        socials: [
          {
            id: 'donate',
            url: 'https://buymeacoffee.com/gaisberg',
          },
        ],
      },
    ];

    return {
      ID: 'streamnzb',
      NAME: 'StreamNZB',
      LOGO: 'https://cdn.discordapp.com/icons/1470288400157380710/6f397b4a2e9561dc7ad43526588cfd67.png',
      URL: '',
      TIMEOUT: Env.DEFAULT_TIMEOUT,
      USER_AGENT: 'AIOStreams',
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Stream via nntp without any additional services.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.USENET_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      CATEGORY: constants.PresetCategory.STREAMS,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, unknown>
  ): Promise<Addon[]> {
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
        (list[0].addon.preset.options?.url as string)
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
    logger.debug(
      `Reporting failover order to StreamNZB: ${JSON.stringify(body)}`
    );
    makeRequest(url, {
      method: 'POST',
      timeout: 5000,
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AIOStreams',
      },
    }).catch((err) => {
      logger.debug(
        `Failed to report failover order to StreamNZB: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, unknown>
  ): Addon {
    return {
      name: (options.name as string) || this.METADATA.NAME,
      manifestUrl: (options.url as string) || '',
      enabled: true,
      mediaTypes: (options.mediaTypes as Addon['mediaTypes']) || [],
      resources:
        (options.resources as Addon['resources']) ||
        this.METADATA.SUPPORTED_RESOURCES,
      timeout: (options.timeout as number) || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options: options as Record<string, unknown>,
      },
      headers: {
        'User-Agent': 'AIOStreams',
      },
    };
  }
}
