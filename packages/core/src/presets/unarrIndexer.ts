import { Addon, Option, UserData } from '../db/index.js';
import { BuiltinAddonPreset } from './builtin.js';
import {
  appConfig,
  constants,
  encryptString,
  ServiceId,
} from '../utils/index.js';

const SUPPORTED_SERVICES = [
  constants.TORBOX_SERVICE,
  constants.NZBDAV_SERVICE,
  constants.ALTMOUNT_SERVICE,
  constants.STREMIO_NNTP_SERVICE,
  constants.STREMTHRU_NEWZ_SERVICE,
  constants.AIOSTREAMS_SERVICE,
] as ServiceId[];

export class UnarrIndexerPreset extends BuiltinAddonPreset {
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
        id: 'apiUrl',
        name: 'Unarr API URL',
        description:
          'The official Unarr API host. This mode accepts HTTPS unarr.app hosts only.',
        type: 'url',
        required: true,
        default: 'https://unarr.app',
      },
      {
        id: 'apiKey',
        name: 'Unarr API Key',
        description:
          'Use an Unarr agent API key (tc_…), not your Unarr email or website password.',
        type: 'password',
        required: true,
      },
      {
        id: 'proxyAuth',
        name: 'AIOStreams Proxy Auth',
        description:
          'A username:password entry allowed by AIOSTREAMS_AUTH. It encrypts and authenticates NZB retrieval so the Unarr API key is never sent to a playback client.',
        type: 'password',
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
    options: Record<string, any>
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
    if (!options.apiKey) {
      throw new Error(`${this.METADATA.NAME} requires an Unarr agent API key.`);
    }
    if (!options.proxyAuth) {
      throw new Error(`${this.METADATA.NAME} requires AIOStreams proxy auth.`);
    }

    const services = usableServices.map((service) => service.id);
    const config = {
      ...this.getBaseConfig(userData, services),
      apiUrl: options.apiUrl || 'https://unarr.app',
      apiKey: options.apiKey,
      proxyAuth: options.proxyAuth,
      maxResults: options.maxResults ?? 30,
      timeout: options.timeout ?? 30_000,
      enforceUnarrQuota: options.enforceUnarrQuota ?? true,
    };
    const encrypted = encryptString(JSON.stringify(config));
    if (!encrypted.success || !encrypted.data) {
      throw new Error('Failed to encrypt the Unarr addon configuration.');
    }

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
          options,
        },
        formatPassthrough: false,
        resultPassthrough: false,
        headers: { 'User-Agent': this.METADATA.USER_AGENT },
      },
    ];
  }
}
