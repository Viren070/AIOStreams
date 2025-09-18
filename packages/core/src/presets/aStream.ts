import {
  Addon,
  Option,
  ParsedStream,
  ParsedFile,
  Stream,
  UserData,
} from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import {
  constants,
  Env,
  HTTP_STREAM_TYPE,
  LIVE_STREAM_TYPE,
} from '../utils/index.js';
import { FileParser, StreamParser } from '../parser/index.js';

class AStreamStreamParser extends StreamParser {
  protected override getParsedFile(
    stream: Stream,
    parsedStream: ParsedStream
  ): ParsedFile | undefined {
    const parsed =
      typeof stream.language === 'string'
        ? FileParser.parse(stream.language)
        : undefined;
    if (!parsed) {
      return undefined;
    }
    return {
      ...parsed,
      title: undefined,
    };
  }
  protected override getIndexer(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    const indexer = super.getIndexer(stream, currentParsedStream);
    if (indexer && typeof indexer === 'string') {
      try {
        return new URL(indexer).hostname;
      } catch {}
    }
    return indexer;
  }
  protected override getFilename(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    return undefined;
  }
  protected override getMessage(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    if (stream.language === 'vostfr') return 'VOSTFR';
  }
  protected getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return constants.HTTP_STREAM_TYPE;
  }
}

export class AStreamPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return AStreamStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'AStream',
        supportedResources,
        Env.DEFAULT_ASTREAM_TIMEOUT
      ),
      {
        id: 'language',
        name: 'Language',
        description: 'Language of the streams',
        type: 'select',
        options: [
          { label: 'Tout / Both', value: 'Tout' },
          { label: 'VOSTFR / French Subtitles Only', value: 'VOSTFR' },
          { label: 'VF / French Dub Only', value: 'VF' },
        ],
        default: 'Tout',
      },
      {
        id: 'tmdbEnabled',
        name: 'Activate TMDB Metadata (Recommended)',
        description:
          'Replaces images and descriptions with TMDB images (Requires a TMDB API Key to be provided in the services menu)',
        type: 'boolean',
        default: true,
      },
      {
        id: 'tmdbEpisodeMapping',
        name: 'TMDB Episode Mapping (Recommended)',
        description:
          'Use TMDB titles and descriptions instead of AStream ones (Requires a TMDB API Key to be provided in the services menu)',
        type: 'boolean',
        default: true,
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'github',
            url: 'https://github.com/Dydhzo/astream',
          },
        ],
      },
    ];

    return {
      ID: 'astream',
      NAME: 'AStream',
      LOGO: `https://raw.githubusercontent.com/Dydhzo/astream/refs/heads/main/astream/assets/astream-logo.jpg`,
      URL: Env.ASTREAM_URL,
      TIMEOUT: Env.DEFAULT_ASTREAM_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_ASTREAM_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: "Addon non officiel pour accéder au contenu d'Anime-Sama",
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [HTTP_STREAM_TYPE],
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
      library: false,
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
  ): string {
    if (options.url?.endsWith('/manifest.json')) {
      return options.url;
    }
    const url = (options.url || this.METADATA.URL).replace(/\/$/, '');

    if (
      (options.tmdbEnabled || options.tmdbEpisodeMapping) &&
      !userData.tmdbApiKey
    ) {
      throw new Error(
        `${this.METADATA.NAME} requires a TMDB API Key to use TMDB features. Please provide it in the services menu. `
      );
    }

    const config = {
      language: options.language || 'Tout',
      languageOrder: 'VF,VOSTFR',
      tmdbApiKey: userData.tmdbApiKey,
      tmdbEnabled: options.tmdbEnabled,
      tmdbEpisodeMapping: options.tmdbEpisodeMapping,
    };

    return `${url}/${this.base64EncodeJSON(config)}/manifest.json`;
  }
}
