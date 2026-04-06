import {
  Addon,
  Option,
  UserData,
  Resource,
  ParsedStream,
  Stream,
} from '../db/index.js';
import { baseOptions, Preset } from './preset.js';
import { Env } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';

class HdHubStreamParser extends StreamParser {
  protected get indexerRegex(): RegExp | undefined {
    return /(?:^\s*\[(HLS Stream)\]|^\s*(.+?)\s*\|\s*4KHDHub\s*$)/im;
  }
  protected getIndexer(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): string | undefined {
    const regex = this.indexerRegex;
    if (!regex) return undefined;
    const match = stream.description?.match(regex);
    if (match) return (match[1] ?? match[2])?.trim();
    return undefined;
  }
  protected getFilename(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    const filename = super.getFilename(stream, currentParsedStream);
    if (filename) {
      return filename
        .replace(/^\[HLS Stream\]\s*/i, '')
        .replace(/.*\[💾\s*\d+(\.\d+)?\s*(GB|MB|TB)\]\s*/, '');
    }
    return filename;
  }
}

export class HdHubPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return HdHubStreamParser;
  }

  static override get METADATA() {
    const supportedServices: ServiceId[] = [constants.TORBOX_SERVICE];

    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions('HdHub', supportedResources, Env.DEFAULT_HDHUB_TIMEOUT, [
        Env.HDHUB_URL,
      ]),
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        default: [],
        options: [
          {
            label: 'Movie',
            value: 'movie',
          },
          {
            label: 'Series',
            value: 'series',
          },
          {
            label: 'Anime',
            value: 'anime',
          },
        ],
      },
      {
        id: 'tb_only',
        name: 'TorBox Only',
        description: 'Only show TorBox streams (hide free CDN streams)',
        type: 'boolean',
        required: false,
        default: false,
      },
    ];

    return {
      ID: 'hdhub',
      NAME: 'HdHub',
      LOGO: 'https://hdhub.thevolecitor.qzz.io/logo.png',
      URL: Env.HDHUB_URL,
      TIMEOUT: Env.DEFAULT_HDHUB_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_HDHUB_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION:
        'High-performance HdHub scraper with TorBox passthrough and hybrid CDN support.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.HTTP_STREAM_TYPE,
        constants.DEBRID_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    const services = this.getUsableServices(userData);
    if (services?.find((service) => service.id === constants.TORBOX_SERVICE)) {
      return [
        this.generateAddon(
          options,
          this.getServiceCredential(constants.TORBOX_SERVICE, userData)
        ),
      ];
    }
    return [this.generateAddon(options)];
  }

  private static generateAddon(
    options: Record<string, any>,
    torboxKey?: string
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      displayIdentifier: torboxKey
        ? constants.SERVICE_DETAILS[constants.TORBOX_SERVICE].shortName
        : undefined,
      manifestUrl: this.generateManifestUrl(options, torboxKey),
      enabled: true,
      mediaTypes: options.mediaTypes,
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
    options: Record<string, any>,
    torboxKey?: string
  ) {
    let url = options.url || this.METADATA.URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    url = url.replace(/\/$/, '');

    const config = {
      torbox: torboxKey || 'unset',
      qualities: '2160p,1080p,720p,480p',
      sort: 'desc',
      tb_only: options.tb_only || false,
    };

    const configString = this.base64EncodeJSON(config, 'urlSafe');

    return `${url}/${configString}/manifest.json`;
  }
}
