import { Addon, Option, ParsedStream, Stream, UserData } from '../db/index.js';
import { BuiltinAddonPreset, BuiltinStreamParser } from './builtin.js';
import type { PresetGenerationContext } from './preset.js';
import {
  appConfig,
  constants,
  encryptString,
  issueConfigProxyGrant,
  ServiceId,
} from '../utils/index.js';
import { validateUnarrApiUrl } from '../builtins/unarr-indexer/addon.js';

const SUPPORTED_SERVICES = [
  constants.TORBOX_SERVICE,
  constants.NZBDAV_SERVICE,
  constants.ALTMOUNT_SERVICE,
  constants.STREMIO_NNTP_SERVICE,
  constants.STREMTHRU_NEWZ_SERVICE,
  constants.AIOSTREAMS_SERVICE,
] as ServiceId[];

type UnarrFormattingOptions = {
  useAioFormatter?: boolean;
  showEpisodeAndPackSizes?: boolean;
  showCacheStatus?: boolean;
  showUnarr?: boolean;
  showGrabs?: boolean;
  showCategory?: boolean;
  showGroup?: boolean;
};

type UnarrStreamMetadata = {
  grabs?: number;
  category?: string;
  group?: string;
  publishedAt?: string;
  attributes?: Record<string, string>;
};

export function issueUnarrConfigProxyGrant(
  presetInstanceId: string | undefined,
  apiUrl: string
): string {
  if (!presetInstanceId) {
    throw new Error(
      'TorrentClaw Unarr (Index Only) could not resolve its per-config proxy identity.'
    );
  }
  const validatedApiUrl = validateUnarrApiUrl(apiUrl);
  return issueConfigProxyGrant(
    presetInstanceId,
    'unarr-nzb',
    new URL(validatedApiUrl).origin
  );
}

export class UnarrIndexerStreamParser extends BuiltinStreamParser {
  private get formatting(): UnarrFormattingOptions {
    return (this.addon.preset.options?.formatting ??
      {}) as UnarrFormattingOptions;
  }

  private metadata(stream: Stream): UnarrStreamMetadata {
    const value = (stream as Record<string, unknown>).unarr;
    return value && typeof value === 'object'
      ? (value as UnarrStreamMetadata)
      : {};
  }

  protected override getIndexer(): string {
    return 'TorrentClaw';
  }

  protected override getFolderSize(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): number | undefined {
    if (this.formatting.showEpisodeAndPackSizes === false) return undefined;
    return super.getFolderSize(stream, currentParsedStream);
  }

  protected override getReleaseGroup(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): string | undefined {
    if (this.formatting.showGroup === false) return undefined;
    return (
      this.metadata(stream).group ||
      super.getReleaseGroup(stream, currentParsedStream)
    );
  }

  protected override getExtras(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): ParsedStream['extra'] {
    const metadata = this.metadata(stream);
    const badges: string[] = [];
    if (this.formatting.showUnarr !== false) badges.push('Unarr');
    if (
      this.formatting.showGrabs !== false &&
      typeof metadata.grabs === 'number' &&
      metadata.grabs > 0
    ) {
      badges.push(`${metadata.grabs.toLocaleString('en-US')} grabs`);
    }
    if (this.formatting.showCategory !== false && metadata.category) {
      badges.push(metadata.category);
    }

    let status: string | undefined;
    if (this.formatting.showCacheStatus !== false) {
      if (currentParsedStream.library) status = '🗃️ Library';
      else if (currentParsedStream.service?.cached === true)
        status = '⚡ Cached';
      else if (currentParsedStream.service?.cached === false)
        status = '⏳ Uncached';
    }

    const suffix = [
      badges.length ? `🦞 ${badges.join(' · ')}` : undefined,
      status,
    ].filter((line): line is string => Boolean(line));

    return {
      ...(super.getExtras(stream, currentParsedStream) || {}),
      torrentClaw: {
        unarr: true,
        score: undefined,
        trueSpec: false,
      },
      unarr: metadata,
      formattingSuffix: suffix,
    };
  }
}

export class UnarrIndexerPreset extends BuiltinAddonPreset {
  static override getParser() {
    return UnarrIndexerStreamParser;
  }

  static override get METADATA() {
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this index-only addon.',
        type: 'string',
        required: true,
        default: 'TorrentClaw Unarr (Index Only)',
      },
      {
        id: 'unarrAuth',
        name: 'Connect Unarr',
        description:
          'Connect with a single-use `unarr-authkey-…` or validate an existing `tc_…` API key. Your Unarr email/password is never entered into AIOStreams.',
        type: 'unarr-auth',
        required: true,
      },
      {
        id: 'enforceUnarrQuota',
        name: 'Enforce Unarr Usage Ceiling',
        description:
          'Use the lower of Unarr’s reported remaining allowance and the local 200 GiB monthly TorrentClaw allowance.',
        type: 'boolean',
        required: false,
        default: true,
      },
      {
        id: 'maxResults',
        name: 'Maximum Results',
        description:
          'Limit index results per title. Lower values reduce metadata grabs and service checks during heavy use.',
        type: 'number',
        required: false,
        default: 30,
        constraints: { min: 1, max: 100, forceInUi: false },
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'Timeout for Unarr search and usage requests.',
        type: 'number',
        required: false,
        default: 30_000,
        constraints: {
          min: appConfig.userLimits.timeouts.minTimeout,
          max: appConfig.userLimits.timeouts.maxTimeout,
          forceInUi: false,
        },
      },
      {
        id: 'formatting',
        name: 'TorrentClaw Formatting',
        description:
          'Use TorrentClaw-style suffixes while preserving truthful Usenet service and library state.',
        type: 'subsection',
        subsectionIntent: 'pill',
        subOptions: [
          {
            id: 'useAioFormatter',
            name: 'Use AIOStreams Formatter',
            description:
              'Apply your normal AIOStreams formatter and append TorrentClaw/Unarr badges.',
            type: 'boolean',
            default: true,
          },
          {
            id: 'showEpisodeAndPackSizes',
            name: 'Episode + Season Pack Sizes',
            description:
              'Show selected-file size and full NZB/season-pack size when they differ.',
            type: 'boolean',
            default: true,
          },
          {
            id: 'showCacheStatus',
            name: 'Cache / Library Status',
            description:
              'Show Cached, Uncached, or Library using the selected Usenet service’s real status.',
            type: 'boolean',
            default: true,
          },
          {
            id: 'showUnarr',
            name: 'Unarr Indicator',
            description: 'Append an Unarr source badge.',
            type: 'boolean',
            default: true,
          },
          {
            id: 'showGrabs',
            name: 'Grab Count',
            description:
              'Show Unarr’s result popularity/grab count when available.',
            type: 'boolean',
            default: true,
          },
          {
            id: 'showCategory',
            name: 'Usenet Category',
            description: 'Show the category supplied by Unarr.',
            type: 'boolean',
            default: true,
          },
          {
            id: 'showGroup',
            name: 'Release Group',
            description: 'Preserve Unarr’s release-group field.',
            type: 'boolean',
            default: true,
          },
        ],
      },
      {
        id: 'pinPosition',
        name: 'Pin Position',
        description:
          'Optionally pin TorrentClaw/Unarr results in the final list.',
        type: 'select',
        required: false,
        default: undefined,
        options: [
          { label: 'None', value: undefined },
          { label: 'Top', value: 'top' },
          { label: 'Bottom', value: 'bottom' },
        ],
        showInSimpleMode: false,
      },
      {
        id: 'resultPassthrough',
        name: 'Always Keep Results',
        description:
          'Prevent TorrentClaw/Unarr results from being removed by final result filtering.',
        type: 'boolean',
        required: false,
        default: false,
        showInSimpleMode: false,
      },
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description: 'Leave empty for movies, series, and anime.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        default: [],
        options: [
          { label: 'Movie', value: 'movie' },
          { label: 'Series', value: 'series' },
          { label: 'Anime', value: 'anime' },
        ],
      },
      {
        id: 'services',
        name: 'Usenet Services',
        description:
          'Unarr only indexes and supplies NZBs. Every selected AIOStreams Usenet service remains responsible for checking and playback.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: SUPPORTED_SERVICES.map((service) => ({
          value: service,
          label: constants.SERVICE_DETAILS[service].name,
        })),
        default: undefined,
        emptyIsUndefined: true,
      },
    ];

    return {
      ID: 'unarr-indexer',
      NAME: 'TorrentClaw Unarr (Index Only)',
      LOGO: '',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/unarr-indexer`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES,
      DESCRIPTION:
        'Search TorrentClaw/Unarr for NZBs without running the Unarr downloader, then use AIOStreams Usenet services with a shared 200 GiB monthly reservation ceiling.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.USENET_STREAM_TYPE],
      SUPPORTED_RESOURCES: [constants.STREAM_RESOURCE],
      BUILTIN: true,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>,
    context?: PresetGenerationContext
  ): Promise<Addon[]> {
    const usableServices = this.getUsableServices(
      userData,
      options.services,
      options.name
    );
    if (!usableServices?.length) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one configured Usenet service.`
      );
    }

    const auth = options.unarrAuth as
      | { apiUrl?: string; apiKey?: string }
      | undefined;
    const apiKey = auth?.apiKey || options.apiKey;
    const apiUrl = auth?.apiUrl || options.apiUrl || 'https://unarr.app';
    if (!apiKey?.startsWith('tc_')) {
      throw new Error(
        `${this.METADATA.NAME} requires a connected Unarr account. Use Connect Unarr before saving.`
      );
    }

    const validatedApiUrl = validateUnarrApiUrl(apiUrl);
    const proxyGrant = issueUnarrConfigProxyGrant(
      context?.presetInstanceId,
      validatedApiUrl
    );

    const services = usableServices.map((service) => service.id);
    const config = {
      ...this.getBaseConfig(userData, services),
      apiUrl: validatedApiUrl,
      apiKey,
      proxyAuth: proxyGrant,
      maxResults: options.maxResults ?? 30,
      timeout: options.timeout ?? 30_000,
      enforceUnarrQuota: options.enforceUnarrQuota ?? true,
    };
    const encrypted = encryptString(JSON.stringify(config));
    if (!encrypted.success || !encrypted.data) {
      throw new Error('Failed to encrypt the Unarr addon configuration.');
    }

    const persistedOptions = {
      ...options,
      unarrAuth: {
        ...(auth || {}),
        apiUrl: validatedApiUrl,
        apiKey,
      },
      apiKey: undefined,
      apiUrl: undefined,
      proxyAuth: undefined,
    };

    return [
      {
        name: options.name || this.METADATA.NAME,
        manifestUrl: `${this.DEFAULT_URL}/${encrypted.data}/manifest.json`,
        identifier: 'unarr_nzb',
        displayIdentifier: services
          .map((id) => constants.SERVICE_DETAILS[id].shortName)
          .join(' | '),
        enabled: true,
        resources: options.resources || undefined,
        mediaTypes: options.mediaTypes || [],
        timeout: options.timeout || this.METADATA.TIMEOUT,
        preset: {
          id: '',
          type: this.METADATA.ID,
          options: persistedOptions,
        },
        formatPassthrough: options.formatting?.useAioFormatter === false,
        resultPassthrough: options.resultPassthrough ?? false,
        pinPosition: options.pinPosition || undefined,
        headers: { 'User-Agent': this.METADATA.USER_AGENT },
      },
    ];
  }
}
