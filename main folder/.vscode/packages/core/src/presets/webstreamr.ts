import {
  Addon,
  Option,
  UserData,
  Resource,
  Stream,
  ParsedStream,
  PresetMinimalMetadata,
  PresetMetadata,
} from '../db';
import { Preset, baseOptions } from './preset';
import { Env, SERVICE_DETAILS } from '../utils';
import { constants, ServiceId } from '../utils';
import { FileParser, StreamParser } from '../parser';

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

  protected override getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    const messageRegex = this.getRegexForTextAfterEmojis(['🐢']);

    let messages = [stream.description?.match(messageRegex)?.[1]];
    if (stream.name?.includes('external')) {
      messages.push('External');
    }
    return messages.join(' | ');
  }

  protected override getFilename(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    let filename = undefined;
    const resolution = stream.name?.match(/\d+p?/i)?.[0];
    if (stream.description?.split('\n')?.[0]?.includes('📂')) {
      filename = stream.description
        ?.split('\n')?.[0]
        ?.replace('📂', '')
        ?.trim();
    }

    const str = `${filename ? filename + ' ' : ''}${resolution ? resolution : ''}`;
    return str ? str : undefined;
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
        label: '🇺🇸 English (Soaper, VidSrc)',
        value: 'en',
      },
      {
        label: '🇩🇪 German (KinoGer, MeineCloud, StreamKiste)',
        value: 'de',
      },
      {
        label: '🇪🇸 Castilian Spanish (CineHDPlus, Cuevana, VerHdLink)',
        value: 'es',
      },
      {
        label: '🇫🇷 French (Frembed, FrenchCloud)',
        value: 'fr',
      },
      {
        label: '🇮🇹 Italian (Eurostreaming, MostraGuarda)',
        value: 'it',
      },
      {
        label: '🇲🇽 Latin American Spanish (CineHDPlus, Cuevana, VerHdLink)',
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
        default: ['en'],
      },
      {
        id: 'includeExternalUrls',
        name: 'Include External URLs',
        description: 'Include external URLs in results',
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
      streamPassthrough: false,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      presetType: this.METADATA.ID,
      presetInstanceId: '',
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
      options.includeExternalUrls ?? undefined, // ensure its removed if false
    ].filter(Boolean);

    const config = this.urlEncodeJSON({
      ...checkedOptions.reduce((acc, option) => {
        acc[option] = 'on';
        return acc;
      }, {}),
    });

    return `${url}${config ? '/' + config : ''}/manifest.json`;
  }
}
