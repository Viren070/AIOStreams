import { Addon, Option, UserData } from '../db/index.js';
import { appConfig, constants } from '../utils/index.js';
import { BuiltinAddonPreset } from './builtin.js';
import { StremThruPreset } from './stremthru.js';

export class CauldronPreset extends BuiltinAddonPreset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'Cauldron',
      },
      {
        id: 'baseUrl',
        name: 'Cauldron URL',
        description: 'The base URL of your Cauldron instance',
        type: 'url',
        required: true,
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        required: true,
        default: appConfig.presets.defaultTimeout,
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
          'Optionally override the services that are used. If not specified, enabled supported services will be used.',
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
          'Limits this addon to the selected media types. Leave empty to allow all.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        options: [
          { label: 'Movie', value: 'movie' },
          { label: 'Series', value: 'series' },
          { label: 'Anime', value: 'anime' },
        ],
        default: [],
      },
    ];

    return {
      ID: 'cauldron',
      NAME: 'Cauldron',
      LOGO: '/assets/cauldron_logo.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/cauldron`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: StremThruPreset.supportedServices,
      DESCRIPTION:
        'Searches your Cauldron instance and resolves torrent results through your configured debrid services.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.DEBRID_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      BUILTIN: true,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    const services = this.getUsableServices(userData, options.services, options.name);
    if (!services?.length) {
      throw new Error(
        'Cauldron requires at least one usable debrid service. Enable a supported service and configure its credentials.'
      );
    }

    const config = {
      ...this.getBaseConfig(userData, services.map((service) => service.id)),
      baseUrl: options.baseUrl,
    };

    return [
      {
        name: options.name || this.METADATA.NAME,
        manifestUrl: `${this.DEFAULT_URL}/${this.base64EncodeJSON(config, 'urlSafe')}/manifest.json`,
        identifier: services.length > 1
          ? 'multi'
          : constants.SERVICE_DETAILS[services[0].id].shortName,
        displayIdentifier: services
          .map((service) => constants.SERVICE_DETAILS[service.id].shortName)
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
        headers: {
          'User-Agent': this.METADATA.USER_AGENT,
        },
      },
    ];
  }
}
