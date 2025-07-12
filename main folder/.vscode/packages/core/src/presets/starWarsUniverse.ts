import { Addon, Option, UserData } from '../db';
import { Preset, baseOptions } from './preset';
import { constants, Env } from '../utils';

export class StarWarsUniversePreset extends Preset {
  private static catalogs = [
    {
      label: 'Movies & Series Chronological',
      value: 'sw-movies-series-chronological',
    },
    {
      label: 'Movies & Series Release',
      value: 'sw-movies-series-release',
    },
    {
      label: 'Skywalker Saga',
      value: 'sw-skywalker-saga',
    },
    {
      label: 'Anthology Films',
      value: 'sw-anthology-films',
    },
    {
      label: 'Live-Action Series',
      value: 'sw-live-action-series',
    },
    {
      label: 'Animated Series',
      value: 'sw-animated-series',
    },
    {
      label: 'Micro-Series & Shorts',
      value: 'sw-micro-series-shorts',
    },
    {
      label: 'High Republic Era',
      value: 'sw-high-republic-era',
    },
    {
      label: 'Empire Era',
      value: 'sw-empire-era',
    },
    {
      label: 'New Republic Era',
      value: 'sw-new-republic-era',
    },
    {
      label: 'Bounty Hunters & Underworld',
      value: 'sw-bounty-hunters-underworld',
    },
    {
      label: 'Jedi & Sith Lore',
      value: 'sw-jedi-sith-lore',
    },
    {
      label: 'Droids & Creatures',
      value: 'sw-droids-creatures',
    },
  ];
  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'Star Wars Universe',
        supportedResources,
        Env.DEFAULT_STAR_WARS_UNIVERSE_TIMEOUT
      ).filter((option) => option.id !== 'url'),
      {
        id: 'catalogs',
        name: 'Catalogs',
        description: 'The catalogs to display',
        type: 'multi-select',
        required: true,
        options: this.catalogs,
        default: this.catalogs.map((catalog) => catalog.value),
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          { id: 'github', url: 'https://github.com/tapframe/addon-star-wars' },
          { id: 'ko-fi', url: 'https://ko-fi.com/tapframe' },
        ],
      },
    ];

    return {
      ID: 'star-wars-universe',
      NAME: 'Star Wars Universe',
      LOGO: 'https://www.freeiconspng.com/uploads/logo-star-wars-png-4.png',
      URL: Env.DEFAULT_STAR_WARS_UNIVERSE_URL,
      TIMEOUT: Env.DEFAULT_STAR_WARS_UNIVERSE_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_STAR_WARS_UNIVERSE_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Explore the Star Wars Universe by sagas, series, eras, and more!',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
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
    const config =
      options.catalogs.length !== this.catalogs.length
        ? options.catalogs.join('%2C')
        : '';
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: `${Env.DEFAULT_STAR_WARS_UNIVERSE_URL}/${config ? 'catalog/' + config + '/' : ''}manifest.json`,
      enabled: true,
      library: false,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      presetType: this.METADATA.ID,
      presetInstanceId: '',
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }
}
