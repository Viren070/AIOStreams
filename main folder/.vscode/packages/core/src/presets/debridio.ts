import { Addon, Option, UserData, Resource, Stream } from '../db';
import { Preset, baseOptions } from './preset';
import { Env, SERVICE_DETAILS } from '../utils';
import { constants, ServiceId } from '../utils';
import { StreamParser } from '../parser';

export const debridioSocialOption: Option = {
  id: 'socials',
  name: '',
  description: '',
  type: 'socials',
  socials: [{ id: 'website', url: 'https://debridio.com' }],
};

export class DebridioPreset extends Preset {
  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.ALLEDEBRID_SERVICE,
      constants.DEBRIDLINK_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.TORBOX_SERVICE,
      constants.EASYDEBRID_SERVICE,
    ];
    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Debridio',
        supportedResources,
        Env.DEFAULT_DEBRIDIO_TIMEOUT
      ),
      {
        id: 'debridioApiKey',
        name: 'Debridio API Key',
        description:
          'Your Debridio API Key, located at your [account settings](https://debridio.com/account)',
        type: 'password',
        required: true,
      },
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
        options: supportedServices.map((service) => ({
          value: service,
          label: constants.SERVICE_DETAILS[service].name,
        })),
        default: undefined,
        emptyIsUndefined: true,
      },
      debridioSocialOption,
    ];

    return {
      ID: 'debridio',
      NAME: 'Debridio',
      LOGO: 'https://res.cloudinary.com/adobotec/image/upload/w_120,h_120/v1735925306/debridio/logo.png.png',
      URL: Env.DEBRIDIO_URL,
      TIMEOUT: Env.DEFAULT_DEBRIDIO_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_DEBRIDIO_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION: 'Torrent streaming using Debrid providers.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.DEBRID_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    if (options?.url?.endsWith('/manifest.json')) {
      return [this.generateAddon(userData, options)];
    }

    if (!options.debridioApiKey) {
      throw new Error(
        `${this.METADATA.NAME} requires a Debridio API Key, please provide one in the configuration`
      );
    }

    const usableServices = this.getUsableServices(userData, options.services);

    // if no services are usable, return a single addon with no services
    if (!usableServices || usableServices.length === 0) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one of the following services to be enabled: ${this.METADATA.SUPPORTED_SERVICES.join(
          ', '
        )}`
      );
    }

    return usableServices.map((service) =>
      this.generateAddon(userData, options, service.id)
    );
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    service?: ServiceId
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      displayIdentifier: service
        ? `${constants.SERVICE_DETAILS[service].shortName}`
        : 'custom',
      identifier: service
        ? `${constants.SERVICE_DETAILS[service].shortName}`
        : 'custom',
      manifestUrl: this.generateManifestUrl(userData, options, service),
      enabled: true,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      presetType: this.METADATA.ID,
      presetInstanceId: '',
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }

  private static generateManifestUrl(
    userData: UserData,
    options: Record<string, any>,
    service?: ServiceId
  ) {
    const url = options?.url || this.METADATA.URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    if (!service) {
      throw new Error(
        `${this.METADATA.NAME} requires at least one of the following services to be enabled: ${this.METADATA.SUPPORTED_SERVICES.join(
          ', '
        )}`
      );
    }

    const configString = this.base64EncodeJSON({
      api_key: options.debridioApiKey,
      provider: service,
      providerKey: this.getServiceCredential(service, userData),
      disableUncached: false,
      maxSize: '',
      maxReturnPerQuality: '',
      resolutions: ['4k', '1440p', '1080p', '720p', '480p', '360p', 'unknown'],
      excludedQualities: [],
    });

    return `${url}${configString ? '/' + configString : ''}/manifest.json`;
  }
}
