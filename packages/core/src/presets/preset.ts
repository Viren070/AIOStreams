import {
  Option,
  Resource,
  Stream,
  ParsedStream,
  UserData,
  PresetMetadata,
  Addon,
} from '../db/index.js';
import { StreamParser } from '../parser/index.js';
import { Env, ServiceId, constants } from '../utils/index.js';
/**
 *
 * What modifications are needed for each preset:
 *
 * comet: apply FORCE_COMET_HOSTNAME, FORCE_COMET_PORT, FORCE_COMET_PROTOCOl to stream urls if they are defined
 * dmm cast:  need to split title by newline, replace trailing dashes, excluding lines with box emoji, and
 *           then joining the array back together.
 * easynews,easynews+,easynews++: need to set type as usenet
 * jackettio: apply FORCE_JACKETTIO_HOSTNAME, FORCE_JACKETTIO_PORT, FORCE_JACKETTIO_PROTOCOL to stream urls if they are defined
 * mediafusion: need to add hint for folder name, 📁 emoji, and split on arrow, take last index.
 * stremio-jacektt: need to inspect stream urls to extract service info.
 * stremthruStore: need to mark each stream as 'inLibrary' and unset any parsed 'indexer'
 * torbox: need to use different regex for probably everything.
 * torrentio: extract folder name from first line
 */

// name: z.string().min(1),
// enabled: z.boolean().optional(),
// baseUrl: z.string().url().optional(),
// timeout: z.number().min(1).optional(),
// resources: ResourceList.optional(),

export const baseOptions = (
  name: string,
  resources: Resource[],
  timeout: number = Env.DEFAULT_TIMEOUT,
  baseUrls?: readonly string[]
): Option[] => {
  const urlOption: Option = {
    id: 'url',
    name: 'URL',
    description:
      'Optionally override either the manifest generated, or override the base url used when generating the manifests',
    type: 'url',
    required: false,
    showInNoobMode: false,
    default: undefined,
  };
  if (baseUrls && baseUrls.length > 1) {
    urlOption.default = 'undefined';
    urlOption.type = 'select-with-custom';
    urlOption.options = [
      {
        label: baseUrls[0],
        value: 'undefined',
      },
      ...baseUrls.slice(1).map((url) => ({
        label: url,
        value: url,
      })),
    ];
    urlOption.showInNoobMode = true;
  }
  return [
    {
      id: 'name',
      name: 'Name',
      description: 'What to call this addon',
      type: 'string',
      required: true,
      default: name,
    },
    {
      id: 'timeout',
      name: 'Timeout',
      description: 'The timeout for this addon',
      type: 'number',
      required: true,
      default: timeout,
      constraints: {
        min: Env.MIN_TIMEOUT,
        max: Env.MAX_TIMEOUT,
        forceInUi: false, // large ranges don't work well
      },
    },
    {
      id: 'resources',
      name: 'Resources',
      description: 'Optionally override the resources to use ',
      type: 'multi-select',
      required: false,
      showInNoobMode: false,
      default: resources,
      options: resources.map((resource) => ({
        label: resource,
        value: resource,
      })),
    },
    urlOption,
  ];
};

export interface CacheKeyRequestOptions {
  resource: Resource | 'manifest';
  type: string;
  id: string;
  options: Record<string, any>;
  extras?: string;
}

export abstract class Preset {
  static get METADATA(): PresetMetadata {
    throw new Error('METADATA must be implemented by derived classes');
  }

  static getParser(): typeof StreamParser {
    return StreamParser;
  }

  static getCacheKey(options: CacheKeyRequestOptions): string | undefined {
    return undefined;
  }

  /**
   * Creates a preset from a preset id.
   * @param presetId - The id of the preset to create.
   * @returns The preset.
   */

  static generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    throw new Error('generateAddons must be implemented by derived classes');
  }

  // Utility functions for generating config strings
  /**
   * Encodes a JSON object into a base64 encoded string.
   * @param json - The JSON object to encode.
   * @returns The base64 encoded string.
   */
  protected static base64EncodeJSON(
    json: any,
    urlEncode: boolean = false, // url encode the string
    makeUrlSafe: boolean = false // replace + with -, / with _ and = with nothing
  ) {
    let encoded = Buffer.from(JSON.stringify(json)).toString('base64');
    if (makeUrlSafe) {
      encoded = encoded
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    } else if (urlEncode) {
      encoded = encodeURIComponent(encoded);
    }
    return encoded;
  }

  protected static urlEncodeJSON(json: any) {
    return encodeURIComponent(JSON.stringify(json));
  }

  /**
   * Transforms key-value pairs into a url encoded string
   * @param options - The key-value pair object to encode.
   * @returns The encoded string.
   */
  protected static urlEncodeKeyValuePairs(
    options: Record<string, string> | string[][],
    separator: string = '|',
    encode: boolean = true
  ) {
    const string = (Array.isArray(options) ? options : Object.entries(options))
      .map(([key, value]) => `${key}=${value}`)
      .join(separator);
    return encode ? encodeURIComponent(string) : string;
  }

  protected static getUsableServices(
    userData: UserData,
    specifiedServices?: ServiceId[]
  ) {
    let usableServices = userData.services?.filter(
      (service) =>
        this.METADATA.SUPPORTED_SERVICES.includes(service.id) && service.enabled
    );

    if (specifiedServices) {
      // Validate specified services exist and are enabled
      for (const service of specifiedServices) {
        const userService = userData.services?.find((s) => s.id === service);
        const meta = Object.values(constants.SERVICE_DETAILS).find(
          (s) => s.id === service
        );
        if (!userService || !userService.enabled || !userService.credentials) {
          throw new Error(
            `You have specified ${meta?.name || service} in your configuration, but it is not enabled or has missing credentials`
          );
        }
      }
      // Filter to only specified services
      usableServices = usableServices?.filter((service) =>
        specifiedServices.includes(service.id)
      );
    }

    return usableServices;
  }

  protected static getServiceCredential(
    serviceId: ServiceId,
    userData: UserData,
    specialCases?: Partial<Record<ServiceId, (credentials: any) => any>>
  ) {
    const service = constants.SERVICE_DETAILS[serviceId];
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }

    const serviceCredentials = userData.services?.find(
      (service) => service.id === serviceId
    )?.credentials;

    if (!serviceCredentials) {
      throw new Error(`No credentials found for service ${serviceId}`);
    }

    // Handle special cases if provided
    if (specialCases?.[serviceId]) {
      return specialCases[serviceId](serviceCredentials);
    }

    // handle seedr
    if (serviceId === constants.SEEDR_SERVICE) {
      if (serviceCredentials.encodedToken) {
        return serviceCredentials.encodedToken;
      }
      throw new Error(
        `Missing encoded token for ${serviceId}. Please add an encoded token using MediaFusion`
      );
    }
    // handle easynews
    if (serviceId === constants.EASYNEWS_SERVICE) {
      if (!serviceCredentials.username || !serviceCredentials.password) {
        throw new Error(
          `Missing username or password for ${serviceId}. Please add a username and password.`
        );
      }
      return {
        username: serviceCredentials.username,
        password: serviceCredentials.password,
      };
    }
    if (serviceId === constants.PIKPAK_SERVICE) {
      if (!serviceCredentials.email || !serviceCredentials.password) {
        throw new Error(
          `Missing email or password for ${serviceId}. Please add an email and password.`
        );
      }
      return {
        email: serviceCredentials.email,
        password: serviceCredentials.password,
      };
    }
    // Default case - API key
    const { apiKey } = serviceCredentials;
    if (!apiKey) {
      throw new Error(
        `Missing credentials for ${serviceId}. Please add an API key.`
      );
    }
    return apiKey;
  }
}
