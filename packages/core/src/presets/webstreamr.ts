import {
  Addon,
  Option,
  UserData,
  Resource,
  Stream,
  ParsedStream,
  PresetMinimalMetadata,
  PresetMetadata,
  ParsedFile,
} from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { Env, SERVICE_DETAILS } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { FileParser, StreamParser } from '../parser/index.js';

class WebStreamrStreamParser extends StreamParser {
  protected get indexerEmojis(): string[] {
    return ['🔗'];
  }

  protected override getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    const type = super.getStreamType(stream, service, currentParsedStream);
    if (type === 'live') {
      return 'http';
    }
    return type;
  }

  protected override getError(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['error'] | undefined {
    const indexer = this.getIndexer(stream, currentParsedStream);
    const errorRegex = this.getRegexForTextAfterEmojis([
      '❌',
      '⏳',
      '🐢',
      '🚦',
      '⚠️',
    ]);
    const error = stream.description?.match(errorRegex)?.[1]?.trim();
    if (error === 'external') {
      return undefined;
    }
    if (error) {
      return {
        title: `WebStreamr | ${indexer ?? 'Error'}`,
        description: error,
      };
    }
    return undefined;
  }

  protected override getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    const messageRegex = this.getRegexForTextAfterEmojis(['⚠️']);
    return (
      stream.name?.match(messageRegex)?.[1] ||
      stream.description?.match(messageRegex)?.[1]
    );
  }

  protected override getFilename(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    let filename = undefined;
    const resolution = stream.name?.match(/\d+p?/i)?.[0];
    if (!stream.description?.split('\n')?.[0]?.includes('🔗')) {
      filename = stream.description?.split('\n')?.[0]?.trim();
    }

    const str = `${filename ? filename + ' ' : ''}${resolution ? resolution : ''}`;
    return str ? str : undefined;
  }

  protected getParsedFile(
    stream: Stream,
    parsedStream: ParsedStream
  ): ParsedFile | undefined {
    const parsedFile = super.getParsedFile(stream, parsedStream);
    if (!parsedFile) return;

    const getClosestResolution = (resolution: string) => {
      return `${constants.RESOLUTIONS.map((r) => Number(r.replace('p', '')))
        .filter((n) => !isNaN(n))
        .reduce((prev, curr) => {
          return Math.abs(curr - Number(resolution)) <
            Math.abs(prev - Number(resolution))
            ? curr
            : prev;
        })}p`;
    };

    const resolution = stream.name?.match(/(\d+)p/i)?.[1];
    parsedFile.resolution = resolution
      ? getClosestResolution(resolution)
      : undefined;

    return parsedFile;
  }
}

export class WebStreamrPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return WebStreamrStreamParser;
  }

  static override get METADATA(): PresetMetadata {
    const supportedResources = [constants.STREAM_RESOURCE];

    const providers = [
      {
        label: '🌐 Multi (4KHDHub, VixSrc)',
        value: 'multi',
      },
      {
        label: '🇺🇸 English (PrimeWire, Soaper, VidSrc, XPrime)',
        value: 'en',
      },
      {
        label:
          '🇩🇪 German (Einschalten, KinoGer, MegaKino, MeineCloud, StreamKiste)',
        value: 'de',
      },
      {
        label:
          '🇪🇸 Castilian Spanish (CineHDPlus, Cuevana, HomeCine, VerHdLink)',
        value: 'es',
      },
      {
        label: '🇫🇷 French (Frembed, FrenchCloud, Movix)',
        value: 'fr',
      },
      {
        label: '🇮🇹 Italian (Eurostreaming, MostraGuarda, VixSrc)',
        value: 'it',
      },
      {
        label:
          '🇲🇽 Latin American Spanish (CineHDPlus, Cuevana, HomeCine, VerHdLink)',
        value: 'mx',
      },
    ];
    const options: Option[] = [
      ...baseOptions(
        'WebStreamr',
        supportedResources,
        Env.DEFAULT_WEBSTREAMR_TIMEOUT
      ),
      {
        id: 'providers',
        name: 'Providers',
        description: 'Select the providers to use',
        type: 'multi-select',
        options: providers,
        default: ['multi', 'en'],
      },
      {
        id: 'includeExternalUrls',
        name: 'Include External URLs',
        description: 'Include external URLs in results',
        type: 'boolean',
        default: false,
      },
      {
        id: 'showErrors',
        name: 'Show Errors',
        description: 'Show errors from WebStreamr',
        type: 'boolean',
        default: false,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          { id: 'github', url: 'https://github.com/webstreamr/webstreamr' },
        ],
      },
    ];

    return {
      ID: 'webstreamr',
      NAME: 'WebStreamr',
      URL: Env.WEBSTREAMR_URL,
      TIMEOUT: Env.DEFAULT_WEBSTREAMR_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_WEBSTREAMR_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Provides HTTP URLs from streaming websites.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.HTTP_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: this.generateManifestUrl(userData, options),
      enabled: true,
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
    options: Record<string, any>
  ) {
    let url = options.url || this.METADATA.URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }

    url = url.replace(/\/$/, '');

    const checkedOptions = [
      ...(options.providers || []),
      options.includeExternalUrls ? 'includeExternalUrls' : undefined,
      options.showErrors ? 'showErrors' : undefined,
    ].filter(Boolean);

    let config = {
      ...checkedOptions.reduce((acc, option) => {
        acc[option] = 'on';
        return acc;
      }, {}),
    };

    if (
      userData.proxy?.enabled &&
      userData.proxy.id === 'mediaflow' &&
      userData.proxy.credentials
    ) {
      config.mediaFlowProxyUrl = userData.proxy.url;
      config.mediaFlowProxyPassword = userData.proxy.credentials;
    }

    config = this.urlEncodeJSON(config);

    return `${url}${config ? '/' + config : ''}/manifest.json`;
  }
}
