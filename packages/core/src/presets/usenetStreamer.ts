import { baseOptions, Preset } from './preset.js';
import { constants, Env } from '../utils/index.js';
import {
  PresetMetadata,
  Option,
  Addon,
  UserData,
  ParsedStream,
  Stream,
} from '../db/index.js';
import { StreamParser } from '../parser/index.js';

export class UsenetStreamerParser extends StreamParser {
  protected override getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return stream.nzbUrl
      ? constants.STREMIO_USENET_STREAM_TYPE
      : constants.USENET_STREAM_TYPE;
  }

  protected getService(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['service'] | undefined {
    return {
      id: stream.nzbUrl
        ? constants.STREMIO_NNTP_SERVICE
        : constants.NZBDAV_SERVICE,
      cached: true,
    };
  }

  protected getInLibrary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): boolean {
    return stream.description?.includes('⚡ Instant') ?? false;
  }

  protected getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    const status = stream.description?.match(/(🧝|✅|⚠️|🚫)/g)?.[0];
    if (status) return `NZB Health: ${status}`;
  }

  protected getIndexer(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return (stream as any).meta?.indexer;
  }
}

export class UsenetStreamerPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return UsenetStreamerParser;
  }

  static override get METADATA(): PresetMetadata {
    const supportedServices = [
      constants.NZBDAV_SERVICE,
      constants.STREMIO_NNTP_SERVICE,
    ];
    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'Usenet Streamer',
      },
      {
        id: 'manifestUrl',
        name: 'Manifest URL',
        description:
          'The URL to the manifest.json for your self-hosted Usenet Streamer addon. e.g. https://usenet-streamer.example.com/manifest.json or http://usenet-streamer:7000/manifest.json',
        type: 'string',
        required: true,
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        required: true,
        default: Env.DEFAULT_TIMEOUT,
        constraints: {
          min: Env.MIN_TIMEOUT,
          max: Env.MAX_TIMEOUT,
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
            url: 'https://github.com/Sanket9225/UsenetStreamer',
          },
          {
            id: 'buymeacoffee',
            url: 'https://buymeacoffee.com/gaikwadsank',
          },
        ],
      },
    ];

    return {
      ID: 'usenet-streamer',
      NAME: 'Usenet Streamer',
      DESCRIPTION:
        'Usenet-powered instant streams for Stremio via Prowlarr and NZBDav',
      LOGO: `https://raw.githubusercontent.com/Sanket9225/UsenetStreamer/refs/heads/master/assets/icon.png`,
      URL: Env.EASYNEWS_URL,
      TIMEOUT: Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      SUPPORTED_RESOURCES: supportedResources,
      SUPPORTED_STREAM_TYPES: [constants.USENET_STREAM_TYPE],
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
