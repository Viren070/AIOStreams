import { PresetMetadata } from '../db/index.js';
import { EasynewsPreset } from './easynews.js';
import { constants } from '../utils/index.js';
import { baseOptions } from './preset.js';
import { config as appConfig } from '../config/index.js';
import { mediaTypesOption, socialsOption } from './options.js';

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
        socialsOption([
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
        ]),
        mediaTypesOption(),
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
