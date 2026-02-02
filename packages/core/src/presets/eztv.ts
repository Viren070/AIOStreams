import { Option, UserData } from '../db/index.js';
import { Env, constants } from '../utils/index.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';

export class EztvPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'EZTV',
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        required: true,
        default: Env.BUILTIN_DEFAULT_EZTV_TIMEOUT || Env.DEFAULT_TIMEOUT,
        constraints: {
          min: Env.MIN_TIMEOUT,
          max: Env.MAX_TIMEOUT,
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
          'EZTV only supports TV series. This option is ignored for other types.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: [{ label: 'Series', value: 'series' }],
        default: ['series'],
      },
    ];

    return {
      ID: 'eztv',
      NAME: 'EZTV',
      LOGO: '/assets/eztv_logo.png',
      URL: `${Env.INTERNAL_URL}/builtins/eztv`,
      TIMEOUT: Env.BUILTIN_DEFAULT_EZTV_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'TV series only. Fetches torrents from EZTVx by IMDB ID and filters by season and episode.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.DEBRID_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  protected static override generateManifestUrl(
    userData: UserData,
    services: constants.ServiceId[],
    options: Record<string, unknown>
  ): string {
    return `${Env.INTERNAL_URL}/builtins/eztv/${this.base64EncodeJSON(
      this.getBaseConfig(userData, services),
      'urlSafe'
    )}/manifest.json`;
  }
}
