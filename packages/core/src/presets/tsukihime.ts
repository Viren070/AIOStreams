import { Option, UserData } from '../db/index.js';
import { appConfig, constants } from '../utils/index.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';

export class TsukihimePreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'TsukiHime',
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        required: true,
        default:
          appConfig.builtins.tsukihime.defaultTimeout ??
          appConfig.presets.defaultTimeout,
        constraints: {
          min: appConfig.userLimits.timeouts.minTimeout,
          max: appConfig.userLimits.timeouts.maxTimeout,
          forceInUi: false,
        },
      },
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: StremThruPreset.supportedServices.map((service) => ({
          value: service,
          label: constants.SERVICE_DETAILS[service].name,
        })),
        default: undefined,
        emptyIsUndefined: true,
      },
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits this addon to the selected media types for streams. TsukiHime is anime-only, so this is pre-configured to only allow anime.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: [{ label: 'Anime', value: 'anime' }],
        default: ['anime'],
      },
      {
        id: 'useMultipleInstances',
        name: 'Use Multiple Instances',
        description:
          'TsukiHime supports multiple services in one instance of the addon - which is used by default. If this is enabled, then the addon will be created for each service.',
        type: 'boolean',
        default: false,
        showInSimpleMode: false,
      },
    ];

    return {
      ID: 'tsukihime',
      NAME: 'TsukiHime',
      LOGO: 'https://tsukihime.org/favicon.svg',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/tsukihime`],
      TIMEOUT:
        appConfig.builtins.tsukihime.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'An anime-only public torrent indexer via the TsukiHime API, resolving releases by MAL/AniDB id with a text-search fallback.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.DEBRID_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
      CATEGORY: constants.PresetCategory.STREAMS,
    };
  }

  protected static override generateManifestUrl(
    userData: UserData,
    services: constants.ServiceId[],
    options: Record<string, any>
  ): string {
    return `${appConfig.bootstrap.internalUrl}/builtins/tsukihime/${this.base64EncodeJSON(
      this.getBaseConfig(userData, services),
      'urlSafe'
    )}/manifest.json`;
  }
}
