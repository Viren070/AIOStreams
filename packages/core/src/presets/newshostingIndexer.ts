import { Addon, Option, UserData } from '../db/index.js';
import { BuiltinAddonPreset } from './builtin.js';
import type { PresetGenerationContext } from './preset.js';
import {
  appConfig,
  constants,
  encryptString,
  issueConfigProxyGrant,
  ServiceId,
} from '../utils/index.js';
import { NewshostingPrivateConfigSchema } from '../builtins/newshosting-indexer/addon.js';

const SUPPORTED_SERVICES = [
  constants.TORBOX_SERVICE,
  constants.NZBDAV_SERVICE,
  constants.ALTMOUNT_SERVICE,
  constants.STREMIO_NNTP_SERVICE,
  constants.STREMTHRU_NEWZ_SERVICE,
  constants.AIOSTREAMS_SERVICE,
] as ServiceId[];

export class NewshostingIndexerPreset extends BuiltinAddonPreset {
  static override get METADATA() {
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this native Newshosting indexer.',
        type: 'string',
        required: true,
        default: 'Newshosting as an Indexer',
      },
      {
        id: 'username',
        name: 'Newshosting Username',
        description:
          'Your Newshosting login. It is encrypted inside this AIOStreams configuration.',
        type: 'string',
        required: true,
      },
      {
        id: 'password',
        name: 'Newshosting Password',
        description:
          'Your Newshosting password. It is encrypted and is never passed to the selected Usenet service.',
        type: 'password',
        required: true,
      },
      {
        id: 'maxResults',
        name: 'Maximum Results',
        description:
          'Maximum number of matched, filtered Newshosting results returned per title.',
        type: 'number',
        required: false,
        default: 24,
        constraints: { min: 1, max: 40, forceInUi: false },
      },
      {
        id: 'timeout',
        name: 'Addon Timeout (ms)',
        description:
          'Total time AIOStreams allows for metadata, Newshosting searches, availability checks, and formatting.',
        type: 'number',
        required: false,
        default: Math.min(45_000, appConfig.userLimits.timeouts.maxTimeout),
        constraints: {
          min: appConfig.userLimits.timeouts.minTimeout,
          max: appConfig.userLimits.timeouts.maxTimeout,
          forceInUi: false,
        },
      },
      {
        id: 'searchTimeout',
        name: 'Search Timeout (ms)',
        description: 'Timeout for each direct Newshosting search operation.',
        type: 'number',
        required: false,
        default: 8_000,
        constraints: {
          min: appConfig.userLimits.timeouts.minTimeout,
          max: appConfig.userLimits.timeouts.maxTimeout,
          forceInUi: false,
        },
      },
      {
        id: 'nzbTimeout',
        name: 'NZB Creation Timeout (ms)',
        description:
          'Timeout for fetching file details and creating an NZB after a result is selected.',
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
        id: 'maxNzbFiles',
        name: 'Maximum Files per NZB',
        description:
          'Safety ceiling for Newshosting group file-detail requests.',
        type: 'number',
        required: false,
        showInSimpleMode: false,
        default: 32,
        constraints: { min: 1, max: 500, forceInUi: false },
      },
      {
        id: 'connection',
        name: 'Advanced Connection',
        description:
          'Defaults match the proven Newshosting desktop protocol. Change these only if Newshosting changes its service endpoint.',
        type: 'subsection',
        subsectionIntent: 'pill',
        showInSimpleMode: false,
        subOptions: [
          {
            id: 'host',
            name: 'TLS Server Name',
            description: 'TLS server name used by the Newshosting protocol.',
            type: 'string',
            default: 'srv.aboutusenet.com',
          },
          {
            id: 'ip',
            name: 'Server Address',
            description: 'Network address used by the Newshosting protocol.',
            type: 'string',
            default: '81.171.93.8',
          },
          {
            id: 'port',
            name: 'Server Port',
            description: 'TLS port used by the Newshosting protocol.',
            type: 'number',
            default: 5598,
            constraints: { min: 1, max: 65_535, forceInUi: false },
          },
        ],
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
          'Newshosting supplies search results and NZBs. Selected AIOStreams Usenet services perform availability checks and playback.',
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
      {
        id: 'resultPassthrough',
        name: 'Always Keep Results',
        description:
          'Prevent Newshosting results from being removed by final filtering, deduplication, or result limits.',
        type: 'boolean',
        required: false,
        default: false,
        showInSimpleMode: false,
      },
    ];

    return {
      ID: 'newshosting-indexer',
      NAME: 'Newshosting as an Indexer',
      LOGO: '',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/newshosting-indexer`],
      TIMEOUT: Math.min(45_000, appConfig.userLimits.timeouts.maxTimeout),
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES,
      DESCRIPTION:
        'Search Newshosting directly with your own login, apply native release matching and ranking, then use the resulting NZBs with any configured AIOStreams Usenet service.',
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
    if (!context?.presetInstanceId) {
      throw new Error(
        `${this.METADATA.NAME} could not resolve its per-configuration proxy identity.`
      );
    }

    const connection = options.connection || {};
    const proxyGrant = issueConfigProxyGrant(
      context.presetInstanceId,
      'newshosting-nzb',
      new URL(appConfig.bootstrap.baseUrl).origin
    );
    const privateConfig = NewshostingPrivateConfigSchema.parse({
      username: options.username,
      password: options.password,
      host: connection.host || 'srv.aboutusenet.com',
      ip: connection.ip || '81.171.93.8',
      port: connection.port ?? 5598,
      maxNzbFiles: options.maxNzbFiles ?? 32,
      nzbTimeout: options.nzbTimeout ?? 30_000,
      proxyAuth: proxyGrant,
    });
    const encryptedNzbConfig = encryptString(JSON.stringify(privateConfig));
    if (!encryptedNzbConfig.success || !encryptedNzbConfig.data) {
      throw new Error('Failed to encrypt the Newshosting NZB configuration.');
    }

    const services = usableServices.map((service) => service.id);
    const config = {
      ...this.getBaseConfig(userData, services),
      ...privateConfig,
      maxResults: options.maxResults ?? 24,
      searchTimeout: options.searchTimeout ?? 8_000,
      proxyAuth: proxyGrant,
      nzbConfig: encryptedNzbConfig.data,
    };
    const encrypted = encryptString(JSON.stringify(config));
    if (!encrypted.success || !encrypted.data) {
      throw new Error('Failed to encrypt the Newshosting addon configuration.');
    }

    return [
      {
        name: options.name || this.METADATA.NAME,
        manifestUrl: `${this.DEFAULT_URL}/${encrypted.data}/manifest.json`,
        identifier: 'newshosting_nzb',
        displayIdentifier: services
          .map((id) => constants.SERVICE_DETAILS[id].shortName)
          .join(' | '),
        enabled: true,
        resources: options.resources || undefined,
        mediaTypes: options.mediaTypes || [],
        timeout: Math.min(
          appConfig.userLimits.timeouts.maxTimeout,
          Math.max(
            options.timeout || this.METADATA.TIMEOUT,
            (options.searchTimeout ?? 8_000) * 4 + 5_000
          )
        ),
        preset: {
          id: '',
          type: this.METADATA.ID,
          options,
        },
        formatPassthrough: false,
        resultPassthrough: options.resultPassthrough ?? false,
        headers: { 'User-Agent': this.METADATA.USER_AGENT },
      },
    ];
  }
}
