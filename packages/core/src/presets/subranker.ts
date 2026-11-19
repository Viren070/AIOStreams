/**
 * SubRanker has no public instance — it is self-hosted — so unlike most
 * presets the URL is supplied by the user. Rather than adding a second `url`
 * option, this overrides the one `baseOptions` already provides, making it
 * required and visible in simple mode.
 *
 * Settings travel in a base64url segment on the path, so a single instance can
 * serve several people with different preferences.
 */
import { Addon, Option, UserData } from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants, SUBTITLES_RESOURCE } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';

export class SubRankerPreset extends Preset {
  static override get METADATA() {
    const supportedResources = [SUBTITLES_RESOURCE];

    const options: Option[] = [
      ...baseOptions(
        'SubRanker',
        supportedResources,
        appConfig.presets.defaultTimeout
      ).map((option) =>
        option.id === 'url'
          ? {
              ...option,
              name: 'SubRanker URL',
              description:
                'The address of your SubRanker instance, for example https://subs.example.com. SubRanker is self-hosted: see https://github.com/iarhamanwaar/subranker.',
              required: true,
              showInSimpleMode: true,
            }
          : option
      ),
      {
        id: 'upstreams',
        type: 'string',
        name: 'Subtitle addons to rank',
        description:
          'Comma-separated addon URLs, without /manifest.json. SubRanker queries them together and merges the results. Leave this empty to use whatever the instance was started with.',
        required: false,
      },
      {
        id: 'maxResults',
        type: 'number',
        name: 'Maximum results',
        description:
          'How many subtitles to return. 0 returns all of them. A short list is easier to use on clients that label every row identically.',
        default: 0,
        required: false,
        // No min: their schema requires min >= 1, and 0 is meaningful here
        // (return everything), so only the upper bound is expressible.
        constraints: { max: 50 },
      },
      {
        id: 'autoShift',
        type: 'boolean',
        name: 'Fix timing',
        description:
          'Serve a corrected file when a subtitle runs late or drifts against the release being played.',
        default: true,
        required: false,
      },
      {
        id: 'fixOverlaps',
        type: 'boolean',
        name: 'Separate overlapping lines',
        description:
          'Merge cues that share screen time, so two speakers are not drawn on top of each other.',
        default: true,
        required: false,
      },
      {
        id: 'removeHearingImpaired',
        type: 'boolean',
        name: 'Remove sound descriptions',
        description:
          'Strip [DOOR CREAKS] and speaker labels, which turns an SDH track into an ordinary subtitle.',
        default: false,
        required: false,
      },
      {
        id: 'fixOcr',
        type: 'boolean',
        name: 'Repair scanning errors',
        description:
          'Fix characters that optical recognition confuses, such as l for I.',
        default: true,
        required: false,
      },
      {
        id: 'demoteForced',
        type: 'boolean',
        name: 'Push signs-only tracks down',
        description: 'Rank forced tracks below full subtitles.',
        default: true,
        required: false,
      },
    ];

    return {
      ID: 'subranker',
      NAME: 'SubRanker',
      LOGO: 'https://raw.githubusercontent.com/iarhamanwaar/subranker/main/docs/logo.svg',
      URL: [],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Ranks subtitles from your other subtitle addons against the release being played, drops dead links, and repairs timing, encoding and overlapping lines. Self-hosted.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: supportedResources,
      CATEGORY: constants.PresetCategory.SUBTITLES,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    // Self-hosted, so there is no default to fall back to. Failing here with
    // a clear message beats generating a manifest URL of 'undefined/...'.
    if (!options.url) {
      throw new Error(
        `${options.name} needs the URL of your SubRanker instance. SubRanker is self-hosted: see https://github.com/iarhamanwaar/subranker`
      );
    }
    try {
      new URL(options.url);
    } catch {
      throw new Error(
        `${options.name} has an invalid SubRanker URL. It must be a full address, such as https://subs.example.com`
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
      manifestUrl: this.generateManifestUrl(options),
      enabled: true,
      library: false,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
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

  private static generateManifestUrl(options: Record<string, any>): string {
    // A URL that already carries a config segment was produced by SubRanker's
    // own setup page and is complete, so it is used untouched. Anything else
    // is treated as the instance root, including a bare manifest URL: pasting
    // one should not silently discard the options set here.
    if (/\/[cr]\/[^/]+\//.test(options.url)) {
      return options.url;
    }

    const host = options.url
      .replace(/\/manifest\.json$/, '')
      .replace(/\/+$/, '');

    const upstreams = String(options.upstreams ?? '')
      .split(',')
      .map((u) =>
        u
          .trim()
          .replace(/\/manifest\.json$/, '')
          .replace(/\/+$/, '')
      )
      .filter((u) => /^https?:\/\//.test(u));

    // With no upstreams given, defer to the instance's own configuration
    // rather than sending an empty list, which the instance would reject.
    if (upstreams.length === 0) {
      return `${host}/manifest.json`;
    }

    const config = {
      upstreams,
      maxResults: Number(options.maxResults) || 0,
      autoShift: options.autoShift !== false,
      fixOverlaps: options.fixOverlaps !== false,
      removeHearingImpaired: options.removeHearingImpaired === true,
      fixOcr: options.fixOcr !== false,
      demoteForced: options.demoteForced !== false,
    };

    const segment = Buffer.from(JSON.stringify(config), 'utf8').toString(
      'base64url'
    );
    return `${host}/c/${segment}/manifest.json`;
  }
}
