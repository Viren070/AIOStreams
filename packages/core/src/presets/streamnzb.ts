import { Addon, Option, UserData, ParsedStream, Stream } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { StreamParser } from '../parser/index.js';
import { Env } from '../utils/index.js';
import { constants, toUrlSafeBase64 } from '../utils/index.js';

class StreamNZBStreamParser extends StreamParser {
  protected override getService(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['service'] | undefined {
    const base = super.getService(stream, currentParsedStream);
    const cached = (stream.behaviorHints as { cached?: boolean } | undefined)
      ?.cached;
    if (cached === true) {
      return base
        ? { ...base, cached: true }
        : { id: constants.STREMIO_NNTP_SERVICE, cached: true };
    }
    if (cached === false) {
      return base
        ? { ...base, cached: false }
        : { id: constants.STREMIO_NNTP_SERVICE, cached: false };
    }
    return base;
  }

  protected getStreamType(
    stream: Stream,
    service: ParsedStream['service'],
    currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return 'usenet';
  }
}

const STREAM_PREFERENCE_KEYS: readonly (keyof UserData)[] = [
  'sortCriteria',
  'includedResolutions',
  'excludedResolutions',
  'requiredResolutions',
  'preferredResolutions',
  'includedQualities',
  'excludedQualities',
  'requiredQualities',
  'preferredQualities',
  'includedLanguages',
  'excludedLanguages',
  'requiredLanguages',
  'preferredLanguages',
  'includedVisualTags',
  'excludedVisualTags',
  'requiredVisualTags',
  'preferredVisualTags',
  'includedAudioTags',
  'excludedAudioTags',
  'requiredAudioTags',
  'preferredAudioTags',
  'includedAudioChannels',
  'excludedAudioChannels',
  'requiredAudioChannels',
  'preferredAudioChannels',
  'includedStreamTypes',
  'excludedStreamTypes',
  'requiredStreamTypes',
  'preferredStreamTypes',
  'includedEncodes',
  'excludedEncodes',
  'requiredEncodes',
  'preferredEncodes',
  'includedRegexPatterns',
  'excludedRegexPatterns',
  'requiredRegexPatterns',
  'preferredRegexPatterns',
  'rankedRegexPatterns',
  'includedStreamExpressions',
  'excludedStreamExpressions',
  'requiredStreamExpressions',
  'preferredStreamExpressions',
  'rankedStreamExpressions',
  'includedReleaseGroups',
  'excludedReleaseGroups',
  'requiredReleaseGroups',
  'preferredReleaseGroups',
  'includedKeywords',
  'excludedKeywords',
  'requiredKeywords',
  'preferredKeywords',
];

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
        name: 'Instance URL',
        description:
          'Base URL of your StreamNZB instance (e.g. https://streamnzb.example.com)',
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
      USER_AGENT: Env.AIOSTREAMS_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Stream via nntp without any additional services, availability checks, failover supports aiostreams builtins.',
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

  private static generateManifestUrl(
    options: Record<string, unknown>,
    userData: UserData
  ): string {
    const raw = (options.url as string) || '';
    if (!raw) return '';
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\/+$/, '');
    if (pathname.endsWith('/manifest.json')) {
      url.pathname = pathname;
    } else {
      url.pathname = pathname ? `${pathname}/manifest.json` : '/manifest.json';
    }
    const configQuery = this.buildConfigQuery(userData);
    if (configQuery) {
      url.search += (url.search ? '&' : '') + configQuery;
    }
    return url.toString();
  }

  private static buildConfigQuery(userData: UserData): string | undefined {
    const payload: Record<string, unknown> = {};
    for (const key of STREAM_PREFERENCE_KEYS) {
      const value = userData[key as keyof UserData];
      if (value !== undefined && value !== null) {
        payload[key as string] = value;
      }
    }
    if (Object.keys(payload).length === 0) return undefined;
    const encoded = toUrlSafeBase64(JSON.stringify(payload));
    return `config=${encoded}`;
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, unknown>
  ): Addon {
    return {
      name: (options.name as string) || this.METADATA.NAME,
      manifestUrl: this.generateManifestUrl(options, userData),
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
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }
}
