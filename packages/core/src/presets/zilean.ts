import { Option, UserData } from '../db/index.js';
import { Env, constants } from '../utils/index.js';
import { baseOptions } from './preset.js';
import { StremThruPreset } from './stremthru.js';
import { TorznabPreset } from './torznab.js';

export class ZileanPreset extends TorznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      ...baseOptions(
        'Zilean',
        supportedResources,
        Env.BUILTIN_ZILEAN_TIMEOUT || Env.DEFAULT_TIMEOUT
      ).filter((option) => option.id !== 'url' && option.id !== 'resources'),
      {
        id: 'url',
        name: 'URL',
        description: 'Optionally override the URL of the Zilean instance',
        type: 'url',
        required: false,
      },
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
        showInNoobMode: false,
        options: StremThruPreset.supportedServices.map((service) => ({
          value: service,
          label: constants.SERVICE_DETAILS[service].name,
        })),
        default: undefined,
        emptyIsUndefined: true,
      },
    ];

    return {
      ID: 'zilean',
      NAME: 'Zilean',
      LOGO: '/assets/zilean_logo.jpg',
      URL: Env.BUILTIN_ZILEAN_URL,
      TIMEOUT: Env.BUILTIN_ZILEAN_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION: 'Directly search a Zilean instance.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.DEBRID_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  protected static override generateManifestUrl(
    userData: UserData,
    services: constants.ServiceId[],
    options: Record<string, any>
  ): string {
    const zileanUrl = (options.url || this.METADATA.URL).replace(/\/$/, '');

    const config = {
      ...this.getBaseConfig(userData, services),
      url: `${zileanUrl}/torznab`,
      apiPath: '/api',
    };

    const configString = this.base64EncodeJSON(config);
    return `${Env.INTERNAL_URL}/builtins/torznab/${configString}/manifest.json`;
  }
}
