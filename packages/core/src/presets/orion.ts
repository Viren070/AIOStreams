import {
  Addon,
  Option,
  UserData,
  Resource,
  ParsedStream,
  Stream,
} from '../db/index.js';
import { baseOptions, Preset } from './preset.js';
import { Env } from '../utils/index.js';
import { constants, ServiceId } from '../utils/index.js';
import { StreamParser } from '../parser/index.js';

class OrionStreamParser extends StreamParser {
  protected override raiseErrorIfNecessary(
    stream: Stream,
    currentParsedStream: ParsedStream
  ): void {
    if (stream.title?.includes('ERROR')) {
      throw new Error(stream.title);
    }
  }
}

export class OrionPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return OrionStreamParser;
  }

  static override get METADATA() {
    const supportedServices: ServiceId[] = [
      constants.REALDEBRID_SERVICE,
      constants.PREMIUMIZE_SERVICE,
      constants.ALLDEBRID_SERVICE,
      // constants.TORBOX_SERVICE,
      constants.DEBRIDLINK_SERVICE,
      constants.OFFCLOUD_SERVICE,
    ];

    const supportedResources = [constants.STREAM_RESOURCE];

    const options: Option[] = [
      ...baseOptions('Orion', supportedResources, Env.DEFAULT_ORION_TIMEOUT),
      {
        id: 'orionApiKey',
        name: 'Orion API Key',
        description:
          'The API key for the Orion addon, obtain it from the [Orion Panel](https://panel.orionoid.com)',
        type: 'password',
        required: true,
      },
      {
        id: 'showP2P',
        name: 'Show P2P',
        description: 'Show P2P results, even if a debrid service is enabled',
        type: 'boolean',
        default: false,
        showInNoobMode: false,
      },
      {
        id: 'linkLimit',
        name: 'Link Limit',
        description: 'The maximum number of links to fetch from Orion.',
        type: 'number',
        default: 10,
        constraints: {
          max: 50,
          min: 1,
        },
      },
      {
        id: 'services',
        name: 'Services',
        description:
          'Optionally override the services that are used. If not specified, then the services that are enabled and supported will be used.',
        type: 'multi-select',
        required: false,
        showInNoobMode: false,
        options: supportedServices.map((service) => ({
          value: service,
          label: constants.SERVICE_DETAILS[service].name,
        })),
        default: undefined,
        emptyIsUndefined: true,
      },
    ];

    return {
      ID: 'orion',
      NAME: 'Orion',
      LOGO: 'https://orionoid.com/web/images/logo/logo256.png',
      URL: Env.ORION_STREMIO_ADDON_URL,
      TIMEOUT: Env.DEFAULT_ORION_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_ORION_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: supportedServices,
      DESCRIPTION: "Stremio's fastest Torrent/Debrid addon",
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.P2P_STREAM_TYPE,
        constants.DEBRID_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    // url can either be something like https://torrentio.com/ or it can be a custom manifest url.
    // if it is a custom manifest url, return a single addon with the custom manifest url.
    if (options?.url?.endsWith('/manifest.json')) {
      return [this.generateAddon(userData, options, [])];
    }

    const usableServices = this.getUsableServices(userData, options.services);
    // if no services are usable, use p2p
    if (!usableServices || usableServices.length === 0) {
      return [this.generateAddon(userData, options, [])];
    }

    let addons: Addon[] = [
      this.generateAddon(
        userData,
        options,
        usableServices.map((service) => service.id)
      ),
    ];

    return addons;
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    serviceIds: ServiceId[]
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      identifier:
        serviceIds.length > 0
          ? serviceIds.length > 1
            ? 'multi'
            : constants.SERVICE_DETAILS[serviceIds[0]].shortName
          : 'P2P',
      displayIdentifier:
        serviceIds.length > 0
          ? serviceIds
              .map((id) => constants.SERVICE_DETAILS[id].shortName)
              .join(', ')
          : 'P2P',
      manifestUrl: this.generateManifestUrl(userData, options, serviceIds),
      enabled: true,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options: options,
      },
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }

  private static generateManifestUrl(
    userData: UserData,
    options: Record<string, any>,
    serviceIds: ServiceId[]
  ) {
    let url = options.url || this.METADATA.URL;
    if (url.endsWith('/manifest.json')) {
      return url;
    }
    url = url.replace(/\/$/, '');
    const configString = this.base64EncodeJSON({
      api: options.orionApiKey,
      linkLimit: options.linkLimit.toString(),
      sortValue: 'best',
      audiochannels: '1,2,6,8',
      videoquality:
        'hd8k,hd6k,hd4k,hd2k,hd1080,hd720,sd,scr1080,scr720,scr,cam1080,cam720,cam',
      listOpt:
        serviceIds.length > 0
          ? options.showP2P
            ? 'both'
            : 'debrid'
          : 'torrent',
      debridservices: serviceIds,
      audiolanguages: [],
      additionalParameters: '',
    });

    return `${url}${configString ? '/' + configString : ''}/manifest.json`;
  }
}
