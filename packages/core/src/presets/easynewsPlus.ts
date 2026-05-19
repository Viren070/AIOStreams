import { PresetMetadata } from '../db/index.js';
import { EasynewsPreset } from './easynews.js';
import { constants } from '../utils/index.js';
import { baseOptions } from './preset.js';
import { config as appConfig } from '../config/index.js';

export class EasynewsPlusPreset extends EasynewsPreset {
  static override get METADATA(): PresetMetadata {
    return {
      ...super.METADATA,
      ID: 'easynewsPlus',
      NAME: 'Easynews+',
      DESCRIPTION:
        'Easynews+ provides content from Easynews & includes a search catalog',
      URL: appConfig.presets.easynewsPlus.url,
      TIMEOUT:
        appConfig.presets.easynewsPlus.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.easynewsPlus.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_RESOURCES: [
        ...super.METADATA.SUPPORTED_RESOURCES,
        constants.CATALOG_RESOURCE,
        constants.META_RESOURCE,
      ],
      OPTIONS: [
        ...baseOptions(
          'Easynews+',
          [
            ...super.METADATA.SUPPORTED_RESOURCES,
            constants.CATALOG_RESOURCE,
            constants.META_RESOURCE,
          ],
          appConfig.presets.easynewsPlus.defaultTimeout ??
            appConfig.presets.defaultTimeout
        ),
        {
          id: 'socials',
          name: '',
          description: '',
          type: 'socials',
          socials: [
            {
              id: 'github',
              url: 'https://github.com/sleeyax/stremio-easynews-addon',
            },
            {
              id: 'patreon',
              url: 'https://patreon.com/sleeyax',
            },
            {
              id: 'buymeacoffee',
              url: 'https://buymeacoffee.com/sleeyax',
            },
          ],
        },
        {
          id: 'mediaTypes',
          name: 'Media Types',
          description:
            'Limits this addon to the selected media types for streams. For example, selecting "Movie" means this addon will only be used for movie streams (if the addon supports them). Leave empty to allow all.',
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
      ],
    };
  }

  protected static override generateConfig(
    easynewsCredentials: {
      username: string;
      password: string;
    },
    options: Record<string, any>
  ): string {
    return this.urlEncodeJSON({
      username: easynewsCredentials.username,
      password: easynewsCredentials.password,
      sort1: 'Size',
      sort1Direction: 'Descending',
      sort2: 'Relevance',
      sort2Direction: 'Descending',
      sort3: 'Date & Time',
      sort3Direction: 'Descending',
    });
  }
}
