import { PresetMetadata } from '../db/index.js';
import { EasynewsPreset } from './easynews.js';
import { constants, Env } from '../utils/index.js';
import { baseOptions } from './preset.js';

export class EasynewsPlusPreset extends EasynewsPreset {
  static override get METADATA(): PresetMetadata {
    return {
      ...super.METADATA,
      ID: 'easynewsPlus',
      NAME: 'Easynews+',
      DESCRIPTION:
        'Easynews+ provides content from Easynews & includes a search catalog',
      URL: Env.EASYNEWS_PLUS_URL,
      TIMEOUT: Env.DEFAULT_EASYNEWS_PLUS_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_EASYNEWS_PLUS_USER_AGENT || Env.DEFAULT_USER_AGENT,
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
          Env.DEFAULT_EASYNEWS_PLUS_TIMEOUT || Env.DEFAULT_TIMEOUT
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
