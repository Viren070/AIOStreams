import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { Env, RESOURCES } from '../utils/index.js';
import { constants } from '../utils/index.js';

type ForceToTopOption = 'streams' | 'catalogs' | 'both' | 'none';

export class CustomPreset extends Preset {
  static override get METADATA() {
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'Custom Addon',
      },
      {
        id: 'manifestUrl',
        name: 'Manifest URL',
        description: 'Provide the Manifest URL for this custom addon.',
        type: 'url',
        required: true,
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description: 'The timeout for this addon',
        type: 'number',
        default: Env.DEFAULT_TIMEOUT,
        constraints: {
          min: Env.MIN_TIMEOUT,
          max: Env.MAX_TIMEOUT,
          forceInUi: false,
        },
      },
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
      {
        id: 'mediaTypes',
        name: 'Media Types',
        description:
          'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: false,
        default: [],
        options: [
          {
            label: 'Movie',
            value: 'movie',
          },
          {
            label: 'Series',
            value: 'series',
          },
          {
            label: 'Anime',
            value: 'anime',
          },
        ],
      },
      {
        id: 'libraryAddon',
        name: 'Library Addon',
        description:
          'Whether to mark this addon as a library addon. This will result in all streams from this addon being marked as library streams.',
        type: 'boolean',
        required: false,
        default: false,
      },
      {
        id: 'formatPassthrough',
        name: 'Format Passthrough',
        description:
          'Whether to pass through the stream formatting. This means your formatting will not be applied and original stream formatting is retained.',
        type: 'boolean',
      },
      {
        id: 'resultPassthrough',
        name: 'Result Passthrough',
        description:
          'If enabled, all results from this addon will never be filtered out and always included in the final stream list.',
        type: 'boolean',
        required: false,
        default: false,
      },
      {
        id: 'forceToTop',
        name: 'Force to Top',
        description:
          'Choose whether streams and/or catalogs from this addon should be pinned to the top.',
        type: 'select',
        required: false,
        default: 'none',
        options: [
          { label: 'Neither', value: 'none' },
          { label: 'Streams only', value: 'streams' },
          { label: 'Catalogs only', value: 'catalogs' },
          { label: 'Streams and catalogs', value: 'both' },
        ],
      },
    ];

    return {
      ID: 'custom',
      NAME: 'Custom',
      LOGO: '',
      URL: '',
      TIMEOUT: Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_USER_AGENT,
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
    const forceToTop = this.normalizeForceToTop(options.forceToTop);

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
      forceToTop,
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }

  private static normalizeForceToTop(
    forceToTop: any
  ): ForceToTopOption {
    if (forceToTop === 'streams' || forceToTop === 'catalogs') {
      return forceToTop;
    }
    if (forceToTop === 'both') {
      return 'both';
    }
    if (forceToTop === 'none' || forceToTop === false || forceToTop === undefined) {
      return 'none';
    }
    if (forceToTop === true) {
      return 'streams';
    }
    return 'none';
  }
}
