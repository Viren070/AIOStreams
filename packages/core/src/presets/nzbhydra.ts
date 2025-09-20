import { NewznabPreset } from './newznab.js';
import { constants, ServiceId } from '../utils/index.js';
import { Option, UserData } from '../db/index.js';
import { Env } from '../utils/index.js';

export class NZBHydraPreset extends NewznabPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'NZBHydra',
      },
      {
        id: 'timeout',
        name: 'Timeout',
        description: 'The timeout for this addon',
        type: 'number',
        default: Env.BUILTIN_NZBHYDRA_TIMEOUT,
        constraints: {
          min: Env.MIN_TIMEOUT,
          max: Env.MAX_TIMEOUT,
        },
      },

      ...(Env.BUILTIN_NZBHYDRA_URL && Env.BUILTIN_NZBHYDRA_API_KEY
        ? [
            {
              id: 'notRequiredNote',
              name: '',
              description:
                'This instance has a preconfigured NZBHydra instance. You do not need to set the NZBHydra URL and API Key below. ',
              type: 'alert',
              intent: 'info',
            } as const,
          ]
        : []),
      {
        id: 'nzbhydraUrl',
        name: 'NZBHydra URL',
        description: 'Provide the URL to the NZBHydra endpoint ',
        type: 'url',
        required: !Env.BUILTIN_NZBHYDRA_URL || !Env.BUILTIN_NZBHYDRA_API_KEY,
      },
      {
        id: 'nzbhydraApiKey',
        name: 'API Key',
        description:
          'The password for the NZBHydra API. This is used to authenticate with the NZBHydra endpoint.',
        type: 'password',
        required: !Env.BUILTIN_NZBHYDRA_URL || !Env.BUILTIN_NZBHYDRA_API_KEY,
      },
    ];

    return {
      ID: 'nzbhydra',
      NAME: 'NZBHydra',
      LOGO: 'https://raw.githubusercontent.com/theotherp/nzbhydra2/refs/heads/master/core/ui-src/img/logo.png',
      URL: `${Env.INTERNAL_URL}/builtins/newznab`,
      TIMEOUT: Env.BUILTIN_NZBHYDRA_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [constants.TORBOX_SERVICE],
      DESCRIPTION:
        'Directly search a NZBHydra instance for results with your services.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.USENET_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  protected static generateManifestUrl(
    userData: UserData,
    services: ServiceId[],
    options: Record<string, any>
  ) {
    let nzbhydraUrl = undefined;
    let nzbhydraApiKey = undefined;

    if (options.nzbhydraUrl || options.nzbhydraApiKey) {
      nzbhydraUrl = options.nzbhydraUrl;
      nzbhydraApiKey = options.nzbhydraApiKey;
    } else {
      nzbhydraUrl = Env.BUILTIN_NZBHYDRA_URL;
      nzbhydraApiKey = Env.BUILTIN_NZBHYDRA_API_KEY;
    }

    if (!nzbhydraUrl || !nzbhydraApiKey) {
      throw new Error('NZBHydra URL and API Key are required');
    }

    const config = {
      ...this.getBaseConfig(userData, services),
      url: nzbhydraUrl,
      apiPath: options.apiPath,
      apiKey: nzbhydraApiKey,
      forceQuerySearch: true,
    };

    const configString = this.base64EncodeJSON(config);
    return `${this.METADATA.URL}/${configString}/manifest.json`;
  }
}
