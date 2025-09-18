import {
  Addon,
  Option,
  UserData,
  Resource,
  ParsedStream,
} from '../db/index.js';
import { baseOptions, Preset } from './preset.js';
import { Env } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';
import { Stream } from '../db/index.js';

class TorboxStreamParser extends StreamParser {
  override getSeeders(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    return (stream as any).seeders && (stream as any).seeders >= 0
      ? (stream as any).seeders
      : undefined;
  }
  override get ageRegex() {
    return /\|\sAge:\s([0-9]+[dmyh])/i;
  }
  override get indexerRegex() {
    return /Source:\s*([^\n]+)/;
  }
  override getInfoHash(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return (stream as any).hash;
  }
  override getInLibrary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): boolean {
    return (stream as any).is_your_media || stream.name?.includes('Your Media');
  }
  protected override getService(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['service'] | undefined {
    return {
      id: constants.TORBOX_SERVICE,
      cached: (stream as any).is_cached ?? true,
    };
  }

  protected override getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    if (stream.description?.includes('Click play to start')) {
      currentParsedStream.filename = undefined;
      return 'Click play to start streaming your media';
    }
    return undefined;
  }

  protected override getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    if ((stream as any).type === 'usenet') {
      return constants.USENET_STREAM_TYPE;
    }
    const type = stream.description?.match(/Type:\s*([^\n\s]+)/)?.[1];
    if (type) {
      if (type.includes('Torrent')) {
        return constants.DEBRID_STREAM_TYPE;
      } else if (type.includes('Usenet')) {
        return constants.USENET_STREAM_TYPE;
      }
    }
    return super.getStreamType(stream, service, currentParsedStream);
  }
}

export class TorboxAddonPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return TorboxStreamParser;
  }

  static override get METADATA() {
    const supportedServices: ServiceId[] = [constants.TORBOX_SERVICE];

    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.META_RESOURCE,
      constants.CATALOG_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions('TorBox', supportedResources, Env.DEFAULT_TORBOX_TIMEOUT),
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [{ id: 'website', url: 'https://torbox.app' }],
      },
    ];

    return {
      ID: 'torbox',
      NAME: 'TorBox',
      LOGO: 'https://torbox.app/android-chrome-512x512.png',
      URL: Env.TORBOX_STREMIO_URL,
      TIMEOUT: Env.DEFAULT_TORBOX_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_TORBOX_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION:
        'Provides torrent and usenet streams for users of TorBox.app',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
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
    const torboxApiKey = this.getServiceCredential(
      constants.TORBOX_SERVICE,
      userData
    );
    if (!torboxApiKey) {
      throw new Error(
        `${this.METADATA.NAME} requires the Torbox service to be enabled.`
      );
    }

    return `${url}/${torboxApiKey}/manifest.json`;
  }
}
