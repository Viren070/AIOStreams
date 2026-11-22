import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { appConfig, RESOURCES } from '../utils/index.js';
import { constants } from '../utils/index.js';
import {
  formatPassthroughOption,
  libraryAddonOption,
  mediaTypesOption,
  nameOption,
  pinPositionOption,
  resultPassthroughOption,
  timeoutOption,
} from './options.js';

export class CustomPreset extends Preset {
  static override get METADATA() {
    const options: Option[] = [
      nameOption('Custom Addon'),
      {
        id: 'manifestUrl',
        name: 'Manifest URL',
        description: 'Provide the Manifest URL for this custom addon.',
        type: 'url',
        required: true,
      },
      { ...timeoutOption(), required: false },
      {
        id: 'resources',
        name: 'Resources',
        description:
          'Optionally override the resources that are fetched from this addon ',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        default: undefined,
        options: RESOURCES.map((resource) => ({
          label: constants.RESOURCE_LABELS[resource],
          value: resource,
        })),
      },
      mediaTypesOption(),
      pinPositionOption(),
      libraryAddonOption(),
      formatPassthroughOption(),
      resultPassthroughOption(),
    ];

    return {
      ID: 'custom',
      NAME: 'Custom',
      LOGO: '',
      URL: [],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Add your own addon by providing its Manifest URL.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: [],
      CATEGORY: constants.PresetCategory.MISC,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    let manifestUrl = options.manifestUrl;
    try {
      manifestUrl = new URL(manifestUrl);
    } catch (error) {
      throw new Error(
        `${options.name} has an invalid Manifest URL. It must be a valid link to a manifest.json`
      );
    }
    if (!manifestUrl.pathname.endsWith('/manifest.json')) {
      throw new Error(
        `${options.name} has an invalid Manifest URL. It must be a valid link to a manifest.json`
      );
    }

    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: options.manifestUrl,
      enabled: true,
      library: options.libraryAddon ?? false,
      resources: options.resources || undefined,
      mediaTypes: options.mediaTypes || [],
      timeout: options.timeout || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options: options,
      },
      formatPassthrough:
        options.formatPassthrough ?? options.streamPassthrough ?? false,
      resultPassthrough: options.resultPassthrough ?? false,
      pinPosition: options.pinPosition || undefined,
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }
}
