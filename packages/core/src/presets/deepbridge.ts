import { Addon, Option, UserData } from '../db/index.js';
import { Preset } from './preset.js';
import { appConfig, constants } from '../utils/index.js';

const DEEPBRID_LOGO = '/assets/deepbridge_logo.png';

export class DeepBridgePreset extends Preset {
  static override get METADATA() {
    const supportedResources = [constants.STREAM_RESOURCE];
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'DeepBridge',
      },
      {
        id: 'url',
        name: 'DeepBridge URL',
        description:
          'Paste your DeepBridge root URL or generated manifest URL.',
        type: 'url',
        required: true,
        default: appConfig.presets.deepbridge.url[0] || undefined,
      },
      {
        id: 'resources',
        name: 'Resources',
        description: 'Optionally override the resources to use',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        default: supportedResources,
        options: supportedResources.map((resource) => ({
          label: constants.RESOURCE_LABELS[resource],
          value: resource,
        })),
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'github',
            url: 'https://github.com/Cxsmo-ai/Deepbridge',
          },
        ],
      },
    ];

    return {
      ID: 'deepbridge',
      NAME: 'DeepBridge',
      LOGO: DEEPBRID_LOGO,
      URL: appConfig.presets.deepbridge.url,
      TIMEOUT:
        appConfig.presets.deepbridge.defaultTimeout ??
        appConfig.userLimits.timeouts.maxTimeout,
      USER_AGENT:
        appConfig.presets.deepbridge.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Deepbrid official results plus Usenet indexer results through DeepBridge.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [
        constants.USENET_STREAM_TYPE,
        constants.DEBRID_STREAM_TYPE,
        constants.HTTP_STREAM_TYPE,
      ],
      SUPPORTED_RESOURCES: supportedResources,
      CATEGORY: constants.PresetCategory.STREAMS,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: this.generateManifestUrl(options),
      enabled: true,
      mediaTypes: ['movie', 'series'],
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout:
        appConfig.presets.deepbridge.defaultTimeout ??
        appConfig.userLimits.timeouts.maxTimeout,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options,
      },
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }

  private static generateManifestUrl(options: Record<string, any>): string {
    const input = (options.url || this.DEFAULT_URL || '').trim();
    if (!input) {
      throw new Error('DeepBridge URL is required.');
    }

    let url: URL;
    try {
      url = new URL(input.replace(/^stremio:\/\//i, 'https://'));
    } catch {
      throw new Error('DeepBridge URL must be a valid URL.');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('DeepBridge URL must use http or https.');
    }

    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    if (!url.pathname.endsWith('/manifest.json')) {
      url.pathname = `${url.pathname || ''}/manifest.json`;
    }

    return url.toString();
  }
}
