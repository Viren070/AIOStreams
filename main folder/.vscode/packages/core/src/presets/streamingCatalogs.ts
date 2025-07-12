import { Addon, Option, UserData } from '../db';
import { Preset, baseOptions } from './preset';
import { constants, Env } from '../utils';

export class StreamingCatalogsPreset extends Preset {
  // amp,atp,hbm,sst,vil,cpd,nlz,blv,zee,hay,clv,gop,hst,cru,mgl,cts,hlu,pmp,pcp,dnp,nfk,nfx
  // Amazon Prime, Apple TV+, HBO Max, Sky Showtime, Videoland, Canal+, NLZIET
  // BluTV, Zee5, Hayu, Clarovideo, Globoplay, Hotstar, Cruncyroll, Magellan TV, Curiosity Stream,
  // Hulu, Paramount Plus, Peacock Premium, Disney+, Netflix Kids, Netflix
  private static catalogs = [
    {
      label: 'Amazon Prime',
      value: 'amp',
    },
    {
      label: 'Apple TV+',
      value: 'atp',
    },
    {
      label: 'HBO Max',
      value: 'hbm',
    },
    {
      label: 'Sky Showtime',
      value: 'sst',
    },
    {
      label: 'Videoland',
      value: 'vil',
    },
    {
      label: 'Canal+',
      value: 'cpd',
    },
    {
      label: 'NLZIET',
      value: 'nlz',
    },
    {
      label: 'BluTV',
      value: 'blv',
    },
    {
      label: 'Zee5',
      value: 'zee',
    },
    {
      label: 'Hayu',
      value: 'hay',
    },
    {
      label: 'Clarovideo',
      value: 'clv',
    },
    {
      label: 'Globoplay',
      value: 'gop',
    },
    {
      label: 'Hotstar',
      value: 'hst',
    },
    {
      label: 'Cruncyroll',
      value: 'cru',
    },
    {
      label: 'Magellan TV',
      value: 'mgl',
    },
    {
      label: 'Curiosity Stream',
      value: 'cts',
    },
    {
      label: 'Hulu',
      value: 'hlu',
    },
    {
      label: 'Paramount Plus',
      value: 'pmp',
    },
    {
      label: 'Peacock Premium',
      value: 'pcp',
    },
    {
      label: 'Disney+',
      value: 'dnp',
    },
    {
      label: 'Netflix Kids',
      value: 'nfk',
    },
    {
      label: 'Netflix',
      value: 'nfx',
    },
    {
      label: 'Discovery+',
      value: 'dpe',
    },
  ];
  static override get METADATA() {
    const supportedResources = [constants.CATALOG_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'Streaming Catalogs',
        supportedResources,
        Env.DEFAULT_STREAMING_CATALOGS_TIMEOUT
      ).filter((option) => option.id !== 'url'),
      {
        id: 'catalogs',
        name: 'Catalogs',
        description: 'The catalogs to display',
        type: 'multi-select',
        required: true,
        options: this.catalogs,
        default: ['nfx', 'hbm', 'dnp', 'amp', 'atp'],
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          {
            id: 'github',
            url: 'https://github.com/rleroi/Stremio-Streaming-Catalogs-Addon',
          },
          { id: 'ko-fi', url: 'https://ko-fi.com/rab1t' },
        ],
      },
    ];

    return {
      ID: 'streaming-catalogs',
      NAME: 'Streaming Catalogs',
      LOGO: `https://play-lh.googleusercontent.com/TBRwjS_qfJCSj1m7zZB93FnpJM5fSpMA_wUlFDLxWAb45T9RmwBvQd5cWR5viJJOhkI`,
      URL: Env.STREAMING_CATALOGS_URL,
      TIMEOUT: Env.DEFAULT_STREAMING_CATALOGS_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT:
        Env.DEFAULT_STREAMING_CATALOGS_USER_AGENT || Env.DEFAULT_USER_AGENT,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Catalogs for your favourite streaming services!',
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
    const config = Buffer.from(options.catalogs.join(',')).toString('base64');
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: `${Env.STREAMING_CATALOGS_URL}/${config}/manifest.json`,
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
