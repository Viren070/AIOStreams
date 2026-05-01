import { Addon, Option, UserData } from '../db/index.js';
import { constants, createLogger, Env, ServiceId } from '../utils/index.js';
import { baseOptions, Preset } from './preset.js';

const logger = createLogger('core');

export class YastreamPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.SUBTITLES_RESOURCE,
    ];

    const options: Option[] = [
      ...baseOptions(
        'yastream',
        supportedResources,
        Env.DEFAULT_YASTREAM_TIMEOUT
      ),
      {
        id: 'kisskhCatalogs',
        name: 'Kisskh Catalogs | Multi',
        description: 'The catalogs to use for Kisskh',
        type: 'multi-select',
        required: false,
        default: ['kisskh.series.Korean'],
        options: [
          {
            value: 'kisskh.series.Korean',
            label: 'Korean Series',
          },
          {
            value: 'kisskh.movie.Korean',
            label: 'Korean Movies',
          },
          {
            value: 'kisskh.series.Chinese',
            label: 'Chinese Series',
          },
          {
            value: 'kisskh.movie.Chinese',
            label: 'Chinese Movies',
          },
          {
            value: 'kisskh.series.US',
            label: 'US Series',
          },
          {
            value: 'kisskh.movie.US',
            label: 'US Movies',
          },
          {
            value: 'kisskh.series.Thai',
            label: 'Thai Series',
          },
          {
            value: 'kisskh.movie.Thai',
            label: 'Thai Movies',
          },
          {
            value: 'kisskh.series.Philippine',
            label: 'Philippine Series',
          },
          {
            value: 'kisskh.movie.Philippine',
            label: 'Philippine Movies',
          },
          {
            value: 'kisskh.series.Japanese',
            label: 'Japanese Series',
          },
          {
            value: 'kisskh.movie.Japanese',
            label: 'Japanese Movies',
          },
          {
            value: 'kisskh.series.Hongkong',
            label: 'Hongkong Series',
          },
          {
            value: 'kisskh.movie.Hongkong',
            label: 'Hongkong Movies',
          },
          {
            value: 'kisskh.series.Taiwanese',
            label: 'Taiwanese Series',
          },
          {
            value: 'kisskh.movie.Taiwanese',
            label: 'Taiwanese Movies',
          },
        ],
      },
      {
        id: 'onetouchtvCatalogs',
        name: 'Onetouchtv Catalogs | Multi',
        description: 'The catalogs to use for Ottv',
        type: 'multi-select',
        required: false,
        default: ['onetouchtv.series.Korean'],
        options: [
          {
            value: 'onetouchtv.series.Popular',
            label: 'Popular Series',
          },
          {
            value: 'onetouchtv.series.Korean',
            label: 'Korean Series',
          },
          {
            value: 'onetouchtv.series.Chinese',
            label: 'Chinese Series',
          },
          {
            value: 'onetouchtv.series.Thai',
            label: 'Thai Series',
          },
        ],
      },
      {
        id: 'idramaCatalogs',
        name: 'iDrama Catalogs | Khmer',
        description: 'The catalogs to use for iDrama',
        type: 'boolean',
        required: false,
      },
      {
        id: 'kisskhStream',
        name: 'Kisskh Stream and Subtitles | Multi',
        description: 'Get stream and subtitles from kisskh',
        type: 'boolean',
        required: false,
        default: true,
      },
      {
        id: 'onetouchtvStream',
        name: 'Onetouchtv Stream and Subtitles | Multi',
        description: 'Get stream and subtitles from onetouchtv',
        type: 'boolean',
        required: false,
        default: true,
      },
      {
        id: 'idramaStream',
        name: 'iDrama Stream | Khmer',
        description: 'Get stream from iDrama',
        type: 'boolean',
        required: false,
        default: false,
      },
      {
        id: 'kkphimStream',
        name: 'kkphim Stream | Vietnamese',
        description: 'Get stream from kkphim',
        type: 'boolean',
        required: false,
        default: false,
      },
      {
        id: 'ophimStream',
        name: 'ophim Stream | Vietnamese',
        description: 'Get stream and subtitles from ophim',
        type: 'boolean',
        required: false,
        default: false,
      },
      {
        id: 'nsfw',
        name: 'Show Adult/NSFW poster',
        description: 'Show adult/nsfw poster if enabled',
        type: 'boolean',
        required: false,
        default: false,
      },
      {
        id: 'info',
        name: 'Show detail stream information',
        description:
          'Show resolution, time, size for stream (take longer to load)',
        type: 'boolean',
        required: false,
        default: false,
      },
      {
        id: 'poster',
        name: 'Use custom poster with ratings',
        description: 'Show custom poster with ratings',
        type: 'select',
        required: false,
        default: 'rpdb',
        options: [
          { label: 'Rating Poster RPDB', value: 'rpdb' },
          { label: 'Easy ratings ERDB', value: 'erdb' },
          { label: 'Extended ratings XRDB', value: 'xrdb' },
        ],
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          { id: 'website', url: 'https://yastream.tamthai.de' },
          { id: 'discord', url: 'https://discord.gg/fnXwYn7wBf' },
          { id: 'github', url: 'https://github.com/hoangtamthai/yastream' },
          { id: 'ko-fi', url: 'https://ko-fi.com/hoangtamthai' },
        ],
      },
    ];

    return {
      ID: 'yastream',
      NAME: 'yastream',
      LOGO: `${Env.YASTREAM_URL}/img/yas.png`,
      URL: Env.YASTREAM_URL,
      TIMEOUT: Env.DEFAULT_YASTREAM_TIMEOUT || Env.DEFAULT_TIMEOUT,
      USER_AGENT: Env.DEFAULT_YASTREAM_USER_AGENT || Env.DEFAULT_USER_AGENT,
      DESCRIPTION:
        'Stream Asian Dramas, Series and Movies directly from multiple sources. Powered by TMDB and TVDB for metadata.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [constants.HTTP_STREAM_TYPE],
      SUPPORTED_SERVICES: [],
      SUPPORTED_RESOURCES: supportedResources,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [this.generateAddon(options)];
  }

  private static generateAddon(options: Record<string, any>): Addon {
    const url = this.generateManifestUrl(options);
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: url,
      enabled: true,
      resources: options.resources,
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

  private static generateManifestUrl(options: Record<string, any>) {
    const url = (options.url || this.METADATA.URL).replace(/\/$/, '');
    if (url.endsWith('/manifest.json')) {
      return url;
    }

    const encodedUserData = this.generateEncodedConfig(options);
    return `${url}/${encodedUserData}/manifest.json`;
  }

  private static generateEncodedConfig(options: Record<string, any>) {
    enum Provider {
      KISSKH = 'kisskh',
      IDRAMA = 'idrama',
      KKPHIM = 'kkphim',
      OPHIM = 'ophim',
      ONETOUCHTV = 'onetouchtv',
    }
    interface UserConfig {
      catalogs: string[];
      catalog: Provider[];
      stream: Provider[];
      nsfw: boolean;
      info: boolean;
      poster: 'rpdb' | 'erdb' | 'xrdb';
    }
    const kisskhCatalogs = Array.isArray(options.kisskhCatalogs)
      ? options.kisskhCatalogs
      : [];
    const onetouchtvCatalogs = Array.isArray(options.onetouchtvCatalogs)
      ? options.onetouchtvCatalogs
      : [];
    const userConfig: UserConfig = {
      catalogs: [...kisskhCatalogs, ...onetouchtvCatalogs],
      stream: [],
      catalog: [],
      nsfw: options.nsfw,
      info: options.info,
      poster: options.poster,
    };
    // catalogs
    if (kisskhCatalogs.length > 0) {
      userConfig.catalogs.push('kisskh.series.Search');
      userConfig.catalogs.push('kisskh.movie.Search');
      userConfig.catalog.push(Provider.KISSKH);
    }
    if (onetouchtvCatalogs.length > 0) {
      userConfig.catalogs.push('onetouchtv.series.Search');
      userConfig.catalog.push(Provider.ONETOUCHTV);
    }
    if (options.idramaCatalogs) {
      userConfig.catalogs.push('idrama.series.Search');
      userConfig.catalogs.push('idrama.series.iDrama');
      userConfig.catalog.push(Provider.IDRAMA);
    }
    // stream
    if (options.kisskhStream) {
      userConfig.stream.push(Provider.KISSKH);
    }
    if (options.onetouchtvStream) {
      userConfig.stream.push(Provider.ONETOUCHTV);
    }
    if (options.idramaStream) {
      userConfig.stream.push(Provider.IDRAMA);
    }
    if (options.kkphimStream) {
      userConfig.stream.push(Provider.KKPHIM);
    }
    if (options.ophimStream) {
      userConfig.stream.push(Provider.OPHIM);
    }
    const encodedConfig = this.base64EncodeJSON(userConfig, 'default');

    return encodedConfig;
  }
}
