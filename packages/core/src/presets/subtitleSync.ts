import { Addon, Option, UserData } from '../db/index.js';
import { Preset } from './preset.js';
import { appConfig, constants } from '../utils/index.js';

const SITE = 'https://subtitlesync.stream';

export class SubtitleSyncPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [constants.SUBTITLES_RESOURCE];

    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'Subtitle Sync',
      },
      {
        // Kept in `url`, the option the Reconfigure button reads and updates. A
        // password, not a url: the link holds the person's sealed keys and works
        // like one, and only password options are left out of exported templates.
        id: 'url',
        name: 'Install link',
        description: `Subtitle Sync is set up on its own page (your languages, subtitle sites and keys), so it cannot be set up from here. Make your link at [subtitlesync.stream](${SITE}), press Copy link, and paste it here.`,
        type: 'password',
        required: true,
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        description:
          'The timeout for this addon. It is passed on to Subtitle Sync, which answers within it.',
        type: 'number',
        required: true,
        default: appConfig.presets.defaultTimeout,
        constraints: {
          min: appConfig.userLimits.timeouts.minTimeout,
          max: appConfig.userLimits.timeouts.maxTimeout,
          forceInUi: false,
        },
      },
      {
        id: 'socials',
        name: '',
        description: '',
        type: 'socials',
        socials: [
          { id: 'website', url: SITE },
          {
            id: 'github',
            url: 'https://github.com/AleksaB98/subtitle-sync-for-stremio',
          },
          { id: 'ko-fi', url: 'https://ko-fi.com/antebellum' },
        ],
      },
    ];

    return {
      ID: 'subtitle-sync',
      NAME: 'Subtitle Sync',
      DESCRIPTION:
        'Subtitles in your languages, timed to the file you are playing, from OpenSubtitles and other sites with your own keys. AI translation with your own key when none exists.',
      LOGO: `${SITE}/web/logo.png`,
      URL: [],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      SUPPORTED_RESOURCES: supportedResources,
      SUPPORTED_STREAM_TYPES: [],
      CATEGORY: constants.PresetCategory.SUBTITLES,
      OPTIONS: options,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    let url: URL;
    try {
      url = new URL(String(options.url ?? ''));
    } catch {
      throw new Error(
        `${options.name} needs your install link from ${SITE}. It ends in /manifest.json`
      );
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.at(-1) !== 'manifest.json') {
      throw new Error(
        `${options.name} needs your install link from ${SITE}. It ends in /manifest.json`
      );
    }
    // The bare /manifest.json holds no settings: it only answers a "set me up" row.
    if (segments.length < 2) {
      throw new Error(
        `${options.name}: that is Subtitle Sync's general link, not yours. Make your own at ${SITE}, press Copy link, and paste it here.`
      );
    }
    return [this.generateAddon(userData, options, url)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>,
    url: URL
  ): Addon {
    const timeout = options.timeout || this.METADATA.TIMEOUT;
    // The manifest URL's query goes out with every resource request, so the
    // addon knows how long it has and answers in time.
    url.searchParams.set('timeout', String(timeout));
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: url.toString(),
      enabled: true,
      resources: this.METADATA.SUPPORTED_RESOURCES,
      timeout,
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
}
